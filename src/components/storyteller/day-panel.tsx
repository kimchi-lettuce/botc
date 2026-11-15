"use client";

import { Check, Moon, Trash2, X } from "lucide-react";
import { useState } from "react";

import { describeDayOutcome } from "@/lib/game-data/day-state";
import { voteThreshold } from "@/lib/engine/vote";
import type {
  DayNominationProblem,
  DayState,
  Seat,
} from "@/lib/game-data/types";
import { cn } from "@/lib/utils";

/**
 * The day: nominations, hands, and the execution.
 *
 * Three taps make a nomination — who nominates, who is nominated, who raised a
 * hand — and the server does the arithmetic when the Storyteller ends the day
 * (`POST /api/day`). Nothing here decides an outcome; it only records what the
 * table did.
 *
 * Dead seats are only offered as voters while their ghost vote is unspent,
 * because that is the rule the engine will apply when the day is counted. The
 * server stays authoritative: this is a guard rail, not the guard.
 */
export function DayPanel({
  seats,
  dayState,
  problems,
  saving,
  onChange,
  onCloseDay,
  onStartNight,
}: {
  seats: Seat[];
  dayState: DayState;
  problems: DayNominationProblem[];
  saving: boolean;
  onChange: (next: DayState) => void;
  onCloseDay: () => void;
  onStartNight: () => void;
}) {
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const living = ordered.filter((seat) => seat.alive);
  const threshold = voteThreshold(living.length);

  const [nominator, setNominator] = useState<number | null>(null);
  const [nominee, setNominee] = useState<number | null>(null);
  const [voters, setVoters] = useState<number[]>([]);

  const closed = dayState.closed;
  const nameOf = (seatIndex: number) =>
    ordered.find((seat) => seat.seatIndex === seatIndex)?.playerName ??
    `Seat ${seatIndex + 1}`;

  const resetForm = () => {
    setNominator(null);
    setNominee(null);
    setVoters([]);
  };

  const toggleVoter = (seatIndex: number) =>
    setVoters((current) =>
      current.includes(seatIndex)
        ? current.filter((value) => value !== seatIndex)
        : [...current, seatIndex],
    );

  const record = () => {
    if (nominator === null || nominee === null) return;
    // Deterministic ids keep the panel testable and the day document diffable;
    // seats are referenced by index anyway.
    const highestId = dayState.nominations.reduce((highest, entry) => {
      const suffix = Number(/(\d+)$/.exec(entry.id)?.[1] ?? 0);
      return Number.isFinite(suffix) ? Math.max(highest, suffix) : highest;
    }, 0);
    onChange({
      ...dayState,
      nominations: [
        ...dayState.nominations,
        {
          id: `nomination-${highestId + 1}`,
          nominatorSeatIndex: nominator,
          nomineeSeatIndex: nominee,
          voterSeatIndexes: [...voters].sort((a, b) => a - b),
        },
      ],
    });
    resetForm();
  };

  const remove = (id: string) =>
    onChange({
      ...dayState,
      nominations: dayState.nominations.filter((entry) => entry.id !== id),
    });

  return (
    <div className="day-panel" data-testid="day-panel">
      <header className="day-panel-header">
        <h3 className="day-panel-heading">Day {dayState.dayNumber}</h3>
        <p className="day-panel-threshold">
          {living.length} living · {threshold} hands{" "}
          {threshold === 1 ? "executes" : "execute"}
        </p>
      </header>

      {closed ? (
        <section
          className="day-panel-outcome"
          data-testid="day-panel-outcome"
          aria-label="Result"
        >
          <strong className="day-panel-outcome-verdict">
            {describeDayOutcome(closed, nameOf)}
          </strong>

          {closed.ghostVotesSpent.length > 0 ? (
            <p className="day-panel-note">
              Ghost votes spent:{" "}
              {closed.ghostVotesSpent
                .map((seatIndex) => nameOf(seatIndex))
                .join(", ")}
            </p>
          ) : null}

          <ul className="day-panel-tallies">
            {closed.tallies.map((tally, index) => (
              <li key={index}>
                Nomination {index + 1}: {tally.voteCount} of {tally.threshold}{" "}
                needed — {tally.qualified ? "passed" : "short"}
              </li>
            ))}
          </ul>

          {problems.length > 0 ? (
            <div className="day-panel-problems" role="status">
              <span className="day-panel-problems-heading">Not counted</span>
              <ul>
                {problems.map((problem) => (
                  <li key={problem.nominationId}>
                    {problem.nominationId === "unknown"
                      ? problem.problems.join(", ")
                      : `${describeProblem(problem, dayState, nameOf)}: ${problem.problems.join(", ")}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            className="day-panel-primary"
            disabled={saving}
            onClick={onStartNight}
          >
            <Moon className="size-4" aria-hidden="true" />
            Start night {dayState.dayNumber + 1}
          </button>
        </section>
      ) : (
        <>
          <section className="day-panel-section">
            <h4 className="day-panel-label">Nominations today</h4>
            {dayState.nominations.length === 0 ? (
              <p className="day-panel-empty">Nobody has been nominated yet.</p>
            ) : (
              <ul className="day-panel-nominations">
                {dayState.nominations.map((entry) => {
                  const count = entry.voterSeatIndexes.length;
                  return (
                    <li key={entry.id} className="day-panel-nomination">
                      <div className="day-panel-nomination-copy">
                        <strong>
                          {nameOf(entry.nominatorSeatIndex)} nominated{" "}
                          {nameOf(entry.nomineeSeatIndex)}
                        </strong>
                        <span
                          className={cn(
                            "day-panel-nomination-count",
                            count >= threshold && "is-qualified",
                          )}
                        >
                          {count} of {threshold} hands
                          {count >= threshold ? " — would execute" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove nomination of ${nameOf(entry.nomineeSeatIndex)}`}
                        className="day-panel-icon-button"
                        onClick={() => remove(entry.id)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="day-panel-section">
            <h4 className="day-panel-label">Record a nomination</h4>

            <SeatChoice
              testId="day-nominator"
              label="Who nominates?"
              seats={living}
              value={nominator}
              onChange={setNominator}
            />
            <SeatChoice
              testId="day-nominee"
              label="Who is nominated?"
              seats={living.filter((seat) => seat.seatIndex !== nominator)}
              value={nominee}
              onChange={setNominee}
            />

            <div className="day-panel-hands" data-testid="day-hands">
              <span className="day-panel-hands-label">
                Who raised a hand? ({voters.length} of {threshold} needed)
              </span>
              <div className="day-panel-chips">
                {ordered.map((seat) => {
                  const selected = voters.includes(seat.seatIndex);
                  const spentGhostVote =
                    !seat.alive && !seat.ghostVoteAvailable;
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${seat.playerName}${
                        seat.alive
                          ? ""
                          : spentGhostVote
                            ? " (dead, ghost vote already spent)"
                            : " (dead, ghost vote)"
                      }`}
                      disabled={spentGhostVote}
                      className={cn(
                        "day-panel-chip",
                        selected && "is-selected",
                        spentGhostVote && "is-disabled",
                      )}
                      onClick={() => toggleVoter(seat.seatIndex)}
                    >
                      {selected ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : null}
                      {seat.seatIndex + 1}. {seat.playerName}
                      {seat.alive ? null : (
                        <span className="day-panel-chip-tag">
                          {spentGhostVote ? "no ghost vote" : "ghost"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="day-panel-secondary"
              disabled={nominator === null || nominee === null || saving}
              onClick={record}
            >
              Add nomination
            </button>
          </section>

          <button
            type="button"
            className="day-panel-primary"
            disabled={saving}
            onClick={onCloseDay}
          >
            <X className="size-4" aria-hidden="true" />
            {saving ? "Counting…" : "End the day and count"}
          </button>
        </>
      )}
    </div>
  );
}

function SeatChoice({
  label,
  testId,
  seats,
  value,
  onChange,
}: {
  label: string;
  testId: string;
  seats: Seat[];
  value: number | null;
  onChange: (seatIndex: number | null) => void;
}) {
  return (
    <div className="day-panel-choice" data-testid={testId}>
      <span className="day-panel-hands-label">{label}</span>
      <div className="day-panel-chips">
        {seats.map((seat) => (
          <button
            key={seat.id}
            type="button"
            aria-pressed={value === seat.seatIndex}
            className={cn(
              "day-panel-chip",
              value === seat.seatIndex && "is-selected",
            )}
            onClick={() =>
              onChange(value === seat.seatIndex ? null : seat.seatIndex)
            }
          >
            {seat.seatIndex + 1}. {seat.playerName}
          </button>
        ))}
      </div>
    </div>
  );
}

function describeProblem(
  problem: DayNominationProblem,
  dayState: DayState,
  nameOf: (seatIndex: number) => string,
): string {
  const nomination = dayState.nominations.find(
    (entry) => entry.id === problem.nominationId,
  );
  if (!nomination) return "Nomination";
  return `${nameOf(nomination.nominatorSeatIndex)} nominating ${nameOf(nomination.nomineeSeatIndex)}`;
}
