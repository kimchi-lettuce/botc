import type {
  DayClosure,
  DayNomination,
  DayOutcomeReason,
  DayState,
} from "@/lib/game-data/types";

/**
 * The day is stored as one JSONB document on the game row (`games.day_state`),
 * the same way seats and tokens are patched wholesale. Normalising on the way
 * out of the database means a malformed or older document cannot crash a game
 * mid-night.
 */

const outcomes: readonly DayOutcomeReason[] = [
  "most-votes",
  "below-threshold",
  "tie",
  "no-nominations",
];

export function emptyDayState(dayNumber: number): DayState {
  return { dayNumber, nominations: [], closed: null };
}

const isSeatIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < 20;

export function normalizeDayState(value: unknown, dayNumber: number): DayState {
  if (!value || typeof value !== "object") return emptyDayState(dayNumber);
  const candidate = value as Partial<DayState>;

  const nominations: DayNomination[] = Array.isArray(candidate.nominations)
    ? candidate.nominations.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const nomination = entry as Partial<DayNomination>;
        if (
          !isSeatIndex(nomination.nominatorSeatIndex) ||
          !isSeatIndex(nomination.nomineeSeatIndex)
        ) {
          return [];
        }
        return [
          {
            id:
              typeof nomination.id === "string" && nomination.id
                ? nomination.id
                : `nomination-${index}`,
            nominatorSeatIndex: nomination.nominatorSeatIndex,
            nomineeSeatIndex: nomination.nomineeSeatIndex,
            voterSeatIndexes: Array.isArray(nomination.voterSeatIndexes)
              ? nomination.voterSeatIndexes.filter(isSeatIndex)
              : [],
          },
        ];
      })
    : [];

  return {
    dayNumber:
      typeof candidate.dayNumber === "number" &&
      Number.isInteger(candidate.dayNumber) &&
      candidate.dayNumber > 0
        ? candidate.dayNumber
        : dayNumber,
    nominations,
    closed: normalizeClosure(candidate.closed),
  };
}

function normalizeClosure(value: unknown): DayClosure | null {
  if (!value || typeof value !== "object") return null;
  const closure = value as Partial<DayClosure>;
  if (!closure.reason || !outcomes.includes(closure.reason)) return null;

  return {
    executedSeatIndex: isSeatIndex(closure.executedSeatIndex)
      ? closure.executedSeatIndex
      : null,
    reason: closure.reason,
    ghostVotesSpent: Array.isArray(closure.ghostVotesSpent)
      ? closure.ghostVotesSpent.filter(isSeatIndex)
      : [],
    tallies: Array.isArray(closure.tallies)
      ? closure.tallies.flatMap((tally) =>
          tally && typeof tally === "object"
            ? [
                {
                  voteCount: Number(tally.voteCount ?? 0),
                  threshold: Number(tally.threshold ?? 0),
                  qualified: Boolean(tally.qualified),
                },
              ]
            : [],
        )
      : [],
    closedAt:
      typeof closure.closedAt === "string"
        ? closure.closedAt
        : new Date(0).toISOString(),
  };
}

export function dayStateIsOpen(state: DayState): boolean {
  return state.closed === null;
}
