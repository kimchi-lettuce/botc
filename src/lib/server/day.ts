import type { DayState, Seat } from "@/lib/game-data/types";
import {
  checkDayNominations,
  countAlive,
  resolveDay,
  voteThreshold,
} from "@/lib/engine/vote";

/**
 * Ending a day: run the table's nominations through the rules and freeze the
 * result. Server-side because it is arithmetic the rules own, not something the
 * Storyteller's phone should be trusted to compute.
 *
 * Deliberately does **not** kill the executed player. Whether a seat is alive is
 * the grimoire's business — the Storyteller taps it, and other deaths (a Slayer
 * shot, a night kill that has not been applied yet) land in the same place. What
 * this does apply is the one thing that is purely bookkeeping: ghost votes that
 * were raised are now spent.
 */

export type DayCloseResult = {
  dayState: DayState;
  seats: Seat[];
  /** Problems found while resolving, for the Storyteller's screen. */
  problems: { nominationId: string; problems: string[] }[];
};

export function closeDay(params: {
  seats: readonly Seat[];
  dayState: DayState;
  now: string;
}): DayCloseResult {
  const { seats, dayState, now } = params;

  const checked = checkDayNominations(
    seats,
    dayState.nominations.map((nomination) => ({
      nominatorSeatIndex: nomination.nominatorSeatIndex,
      nomineeSeatIndex: nomination.nomineeSeatIndex,
      voterSeatIndexes: nomination.voterSeatIndexes,
    })),
  );

  // Report refusals against the nomination the Storyteller recorded, so a
  // "not counted" line can name it. Rejections carry their index, so the
  // nominations that survive keep their original order.
  const rejectedIndexes = new Set(checked.rejected.map(({ index }) => index));
  const problems: DayCloseResult["problems"] = checked.rejected.map(
    ({ index, problems }) => ({
      nominationId: dayState.nominations[index]!.id,
      problems,
    }),
  );
  const legal = dayState.nominations.filter(
    (_, index) => !rejectedIndexes.has(index),
  );

  // Illegal nominations are dropped rather than tallied, so a dead player's
  // nomination cannot execute anybody.
  const result = resolveDay({
    seats,
    nominations: legal.map((nomination) => ({
      nominatorSeatIndex: nomination.nominatorSeatIndex,
      nomineeSeatIndex: nomination.nomineeSeatIndex,
      voterSeatIndexes: nomination.voterSeatIndexes,
    })),
  });

  const spent = new Set(result.ghostVotesSpent);

  return {
    dayState: {
      ...dayState,
      closed: {
        executedSeatIndex: result.outcome.executed,
        reason: result.outcome.reason,
        ghostVotesSpent: result.ghostVotesSpent,
        tallies: result.tallies.map((tally, index) => ({
          nominationId: legal[index]?.id ?? "",
          voteCount: tally.voteCount,
          threshold: tally.threshold,
          qualified: tally.qualified,
        })),
        closedAt: now,
      },
    },
    seats: seats.map((seat) =>
      spent.has(seat.seatIndex) && seat.ghostVoteAvailable
        ? { ...seat, ghostVoteAvailable: false }
        : seat,
    ),
    problems,
  };
}

/** The threshold the Storyteller should be showing while votes are counted. */
export function currentThreshold(seats: readonly Seat[]): number {
  return voteThreshold(countAlive(seats));
}
