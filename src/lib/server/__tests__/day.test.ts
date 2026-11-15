import { describe, expect, it } from "vitest";

import { emptyDayState, normalizeDayState } from "@/lib/game-data/day-state";
import type { DayNomination, DayState, Seat } from "@/lib/game-data/types";
import { closeDay, currentThreshold } from "@/lib/server/day";

const NOW = "2026-11-16T09:00:00.000Z";

function seat(seatIndex: number, overrides: Partial<Seat> = {}): Seat {
  return {
    id: `seat-${seatIndex}`,
    seatIndex,
    playerName: `Player ${seatIndex + 1}`,
    claimedByPlayer: true,
    roleId: "chef",
    alignment: "good",
    alive: true,
    ghostVoteAvailable: true,
    isTraveller: false,
    joinedAt: NOW,
    ...overrides,
  };
}

const table = (count: number, overrides: Record<number, Partial<Seat>> = {}) =>
  Array.from({ length: count }, (_, index) =>
    seat(index, overrides[index] ?? {}),
  );

function nomination(
  id: string,
  nominator: number,
  nominee: number,
  voters: number[],
): DayNomination {
  return {
    id,
    nominatorSeatIndex: nominator,
    nomineeSeatIndex: nominee,
    voterSeatIndexes: voters,
  };
}

const stateWith = (nominations: DayNomination[]): DayState => ({
  ...emptyDayState(1),
  nominations,
});

describe("closeDay", () => {
  it("executes a nominee who reaches the threshold", () => {
    const closed = closeDay({
      seats: table(8),
      dayState: stateWith([nomination("n1", 6, 7, [1, 3, 6, 5])]),
      now: NOW,
    });

    expect(closed.dayState.closed).toEqual({
      executedSeatIndex: 7,
      reason: "most-votes",
      ghostVotesSpent: [],
      tallies: [
        {
          nominationId: "n1",
          voteCount: 4,
          threshold: 4,
          qualified: true,
        },
      ],
      closedAt: NOW,
    });
    expect(closed.problems).toEqual([]);
  });

  it("leaves life and death to the grimoire", () => {
    const seats = table(8);
    const closed = closeDay({
      seats,
      dayState: stateWith([nomination("n1", 6, 7, [1, 3, 6, 5])]),
      now: NOW,
    });

    // Nothing is killed here; the Storyteller taps the seat.
    expect(closed.seats.map((entry) => entry.alive)).toEqual(
      seats.map(() => true),
    );
  });

  it("spends a ghost vote that was raised", () => {
    const closed = closeDay({
      seats: table(8, { 3: { alive: false } }),
      dayState: stateWith([nomination("n1", 6, 7, [1, 2, 3, 5])]),
      now: NOW,
    });

    expect(closed.dayState.closed?.executedSeatIndex).toBe(7);
    expect(closed.dayState.closed?.ghostVotesSpent).toEqual([3]);
    expect(closed.seats[3]?.ghostVoteAvailable).toBe(false);
  });

  it("drops a nomination with a dead nominator and says why", () => {
    const closed = closeDay({
      seats: table(8, { 6: { alive: false } }),
      dayState: stateWith([nomination("n1", 6, 7, [1, 2, 3, 4])]),
      now: NOW,
    });

    expect(closed.dayState.closed?.executedSeatIndex).toBeNull();
    expect(closed.dayState.closed?.reason).toBe("no-nominations");
    expect(closed.problems).toEqual([
      { nominationId: "n1", problems: ["A dead player cannot nominate"] },
    ]);
  });

  it("drops a self-nomination", () => {
    const closed = closeDay({
      seats: table(6),
      dayState: stateWith([nomination("n1", 2, 2, [1, 2, 3])]),
      now: NOW,
    });

    expect(closed.dayState.closed?.reason).toBe("no-nominations");
    expect(closed.problems[0]?.problems).toContain(
      "A player cannot nominate themselves",
    );
  });

  it("executes nobody on a tie", () => {
    const closed = closeDay({
      seats: table(8),
      dayState: stateWith([
        nomination("n1", 6, 7, [1, 2, 3, 4]),
        nomination("n2", 5, 1, [5, 6, 7, 0]),
      ]),
      now: NOW,
    });

    expect(closed.dayState.closed?.reason).toBe("tie");
    expect(closed.dayState.closed?.executedSeatIndex).toBeNull();
  });

  it("records a day with no nominations", () => {
    const closed = closeDay({
      seats: table(6),
      dayState: emptyDayState(1),
      now: NOW,
    });

    expect(closed.dayState.closed).toEqual({
      executedSeatIndex: null,
      reason: "no-nominations",
      ghostVotesSpent: [],
      tallies: [],
      closedAt: NOW,
    });
  });

  it("is idempotent for the same input", () => {
    const params = {
      seats: table(8),
      dayState: stateWith([nomination("n1", 6, 7, [1, 3, 6, 5])]),
      now: NOW,
    };
    expect(closeDay(params)).toEqual(closeDay(params));
  });
});

describe("currentThreshold", () => {
  it("follows the living, not the seated", () => {
    expect(currentThreshold(table(8))).toBe(4);
    expect(
      currentThreshold(table(8, { 0: { alive: false }, 1: { alive: false } })),
    ).toBe(3);
  });
});

describe("normalizeDayState", () => {
  it("returns an empty day for junk", () => {
    for (const value of [null, undefined, "nope", 42, []]) {
      expect(normalizeDayState(value, 3)).toEqual({
        dayNumber: 3,
        nominations: [],
        closed: null,
      });
    }
  });

  it("drops nominations with impossible seats but keeps the rest", () => {
    const state = normalizeDayState(
      {
        dayNumber: 2,
        nominations: [
          {
            id: "a",
            nominatorSeatIndex: 0,
            nomineeSeatIndex: 1,
            voterSeatIndexes: [2, 99],
          },
          {
            id: "b",
            nominatorSeatIndex: -1,
            nomineeSeatIndex: 1,
            voterSeatIndexes: [],
          },
        ],
      },
      1,
    );

    expect(state.nominations).toEqual([
      {
        id: "a",
        nominatorSeatIndex: 0,
        nomineeSeatIndex: 1,
        voterSeatIndexes: [2],
      },
    ]);
    expect(state.dayNumber).toBe(2);
  });

  it("keeps a closure it recognises and discards one it does not", () => {
    const good = normalizeDayState(
      {
        dayNumber: 1,
        nominations: [],
        closed: {
          executedSeatIndex: 3,
          reason: "most-votes",
          ghostVotesSpent: [4],
          tallies: [
            {
              nominationId: "n1",
              voteCount: 5,
              threshold: 4,
              qualified: true,
            },
          ],
          closedAt: NOW,
        },
      },
      1,
    );
    expect(good.closed?.executedSeatIndex).toBe(3);
    expect(good.closed?.ghostVotesSpent).toEqual([4]);

    const bad = normalizeDayState(
      { dayNumber: 1, nominations: [], closed: { reason: "made-up" } },
      1,
    );
    expect(bad.closed).toBeNull();
  });
});
