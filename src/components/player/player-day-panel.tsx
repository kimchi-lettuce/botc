"use client";

import { describeDayOutcome } from "@/lib/game-data/day-state";
import type { DayState, PlayerSeatView } from "@/lib/game-data/types";
import { voteThreshold } from "@/lib/engine/vote";
import { cn } from "@/lib/utils";

/**
 * What a player needs to know about the day: what was nominated, how many hands
 * went up, and — once the Storyteller counts it — who is executed.
 *
 * Read-only on purpose. The day is recorded by the Storyteller's device and the
 * arithmetic runs on the server; a player tapping this is only catching up.
 */
export function PlayerDayPanel({
  seats,
  day,
}: {
  seats: PlayerSeatView[];
  day: DayState;
}) {
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const nameOf = (seatIndex: number) =>
    ordered.find((seat) => seat.seatIndex === seatIndex)?.playerName ??
    `Seat ${seatIndex + 1}`;
  const living = ordered.filter((seat) => seat.alive && seat.occupied).length;
  const threshold = voteThreshold(living);

  const closed = day.closed;

  return (
    <div className="player-day-panel" data-testid="player-day-panel">
      <header className="player-day-header">
        <h3>Day {day.dayNumber}</h3>
        <p>
          {living} living · {threshold} hands to execute
        </p>
      </header>

      {closed ? (
        <p className="player-day-verdict" data-testid="player-day-verdict">
          {describeDayOutcome(closed, nameOf)}
        </p>
      ) : null}

      {day.nominations.length === 0 ? (
        <p className="player-day-empty">
          {closed ? "Nobody was nominated." : "Nobody has been nominated yet."}
        </p>
      ) : (
        <ul className="player-day-nominations">
          {day.nominations.map((nomination) => {
            const hands = nomination.voterSeatIndexes.length;
            const tally = closed?.tallies.find(
              (entry) => entry.nominationId === nomination.id,
            );
            // A nomination can be recorded and then refused by the rules (a
            // second nomination by the same player, a dead nominator). The
            // Storyteller's panel lists those as "not counted"; say the same
            // thing here rather than showing a count that never mattered.
            const counted = !closed || tally !== undefined;
            const qualified = tally?.qualified ?? hands >= threshold;
            return (
              <li key={nomination.id} className="player-day-nomination">
                <span className="player-day-nomination-who">
                  <strong>{nameOf(nomination.nominatorSeatIndex)}</strong>{" "}
                  nominated{" "}
                  <strong>{nameOf(nomination.nomineeSeatIndex)}</strong>
                </span>
                <span
                  className={cn(
                    "player-day-nomination-hands",
                    counted && qualified && "is-qualified",
                  )}
                >
                  {describeHands({ hands, closed: Boolean(closed), tally })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {closed && closed.ghostVotesSpent.length > 0 ? (
        <p className="player-day-note">
          Ghost votes spent:{" "}
          {closed.ghostVotesSpent
            .map((seatIndex) => nameOf(seatIndex))
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function describeHands({
  hands,
  closed,
  tally,
}: {
  hands: number;
  closed: boolean;
  tally?: { qualified: boolean };
}): string {
  if (!closed) return `${hands} ${hands === 1 ? "hand" : "hands"}`;
  if (!tally) return "not counted";
  const count = `${hands} ${hands === 1 ? "hand" : "hands"}`;
  return `${count} — ${tally.qualified ? "passed" : "short"}`;
}
