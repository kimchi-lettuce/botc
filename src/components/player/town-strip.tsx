import { Skull } from "lucide-react";

import { describeDayOutcome } from "@/lib/game-data/day-state";
import type {
  DayState,
  Phase,
  PlayerSeatView,
  Seat,
} from "@/lib/game-data/types";
import { cn } from "@/lib/utils";

/**
 * What a player actually needs from the town: who is still alive, who is dead,
 * and which seat is which. A horizontal strip instead of the Storyteller's
 * spread-out circle, which reads badly on a phone screen.
 *
 * Shown only at phone widths (see src/styles/town-strip.css); the circle stays
 * for tablet, laptop and landscape, where the spatial view is useful.
 */
export function TownStrip({
  seats,
  ownSeat,
  game,
  day,
}: {
  seats: PlayerSeatView[];
  ownSeat: Seat;
  game: { phase: Phase; dayNumber: number };
  day?: DayState;
}) {
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const occupied = ordered.filter((seat) => seat.occupied);
  const dead = occupied.filter((seat) => !seat.alive).length;
  const alive = occupied.length - dead;

  const nameOf = (seatIndex: number) =>
    ordered.find((seat) => seat.seatIndex === seatIndex)?.playerName ??
    `Seat ${seatIndex + 1}`;

  // The phone's one-line answer to "what happened today?". The full list lives
  // behind the Day tab; this is what a glance needs.
  const daySummary = day?.closed
    ? describeDayOutcome(day.closed, nameOf)
    : day && day.nominations.length > 0
      ? `${day.nominations.length} ${
          day.nominations.length === 1 ? "nomination" : "nominations"
        } today`
      : null;

  const phaseLabel =
    game.phase === "day"
      ? `Day ${game.dayNumber}`
      : game.phase === "night"
        ? `Night ${game.dayNumber}`
        : "Setup";

  return (
    <section className="town-strip" aria-label="Town">
      <h2 className="town-strip-heading">
        <span>{phaseLabel}</span>
        <span>
          {alive} alive
          {dead > 0 ? ` · ${dead} dead` : null}
        </span>
      </h2>
      {daySummary ? <p className="town-strip-day">{daySummary}</p> : null}
      <ul className="town-strip-seats">
        {ordered.map((seat) => {
          const isOwn = seat.id === ownSeat.id;
          const label = seat.occupied
            ? `${seat.playerName ?? `Seat ${seat.seatIndex + 1}`}${isOwn ? " (you)" : ""}, seat ${seat.seatIndex + 1}, ${seat.alive ? "alive" : "dead"}`
            : `Seat ${seat.seatIndex + 1}, open`;

          return (
            <li key={seat.id}>
              <span
                className={cn(
                  "town-strip-chip",
                  isOwn && "is-own",
                  !seat.occupied && "is-open",
                  seat.occupied && !seat.alive && "is-dead",
                )}
                aria-label={label}
              >
                <span className="town-strip-index" aria-hidden="true">
                  {seat.seatIndex + 1}
                </span>
                <span className="town-strip-name" aria-hidden="true">
                  {seat.occupied
                    ? (seat.playerName ?? `Seat ${seat.seatIndex + 1}`)
                    : "Open"}
                </span>
                {seat.occupied && !seat.alive ? (
                  <Skull className="town-strip-icon" aria-hidden="true" />
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
