import { describe, expect, it } from "vitest";

import {
  checkDayNominations,
  countAlive,
  nominationProblems,
  resolveDay,
  voteThreshold,
  type Nomination,
  type VoteSeat,
} from "@/lib/engine/vote";

/** A table of `count` living seats, zero-indexed, all with ghost votes unused. */
function table(count: number, dead: number[] = []): VoteSeat[] {
  const deadSeats = new Set(dead);
  return Array.from({ length: count }, (_, seatIndex) => ({
    seatIndex,
    alive: !deadSeats.has(seatIndex),
    ghostVoteAvailable: true,
  }));
}

describe("voteThreshold", () => {
  it("is half the living players, rounded up", () => {
    expect(voteThreshold(8)).toBe(4);
    expect(voteThreshold(7)).toBe(4);
    expect(voteThreshold(6)).toBe(3);
    expect(voteThreshold(5)).toBe(3);
    expect(voteThreshold(4)).toBe(2);
    expect(voteThreshold(3)).toBe(2);
    expect(voteThreshold(11)).toBe(6);
  });
});

describe("nominationProblems", () => {
  it("refuses dead nominators and dead nominees", () => {
    const seats = table(8, [0]);

    expect(
      nominationProblems(seats, {
        nominatorSeatIndex: 0,
        nomineeSeatIndex: 2,
        voterSeatIndexes: [],
      }),
    ).toContain("A dead player cannot nominate");

    expect(
      nominationProblems(seats, {
        nominatorSeatIndex: 2,
        nomineeSeatIndex: 0,
        voterSeatIndexes: [],
      }),
    ).toContain("A dead player cannot be nominated");
  });

  it("refuses self-nomination", () => {
    expect(
      nominationProblems(table(5), {
        nominatorSeatIndex: 2,
        nomineeSeatIndex: 2,
        voterSeatIndexes: [],
      }),
    ).toContain("A player cannot nominate themselves");
  });

  it("allows a legal nomination", () => {
    expect(
      nominationProblems(table(5), {
        nominatorSeatIndex: 1,
        nomineeSeatIndex: 3,
        voterSeatIndexes: [],
      }),
    ).toEqual([]);
  });
});

describe("resolveDay", () => {
  it("executes the nominee who reaches the threshold", () => {
    const seats = table(8);
    const result = resolveDay({
      seats,
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [1, 3, 6, 5],
        },
      ],
    });

    expect(countAlive(seats)).toBe(8);
    expect(result.outcome).toEqual({ executed: 7, reason: "most-votes" });
    expect(result.tallies[0]!.threshold).toBe(4);
  });

  it("does not execute below the threshold", () => {
    const result = resolveDay({
      seats: table(8),
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [1, 3, 6],
        },
      ],
    });

    expect(result.outcome).toEqual({
      executed: null,
      reason: "below-threshold",
    });
  });

  it("executes nobody when the top vote is tied", () => {
    const result = resolveDay({
      seats: table(8),
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [1, 2, 3, 4],
        },
        {
          nominatorSeatIndex: 5,
          nomineeSeatIndex: 1,
          voterSeatIndexes: [6, 7, 5, 0],
        },
      ],
    });

    expect(result.outcome).toEqual({ executed: null, reason: "tie" });
  });

  it("spends a ghost vote, and counts it", () => {
    const seats = table(8, [3]);
    const result = resolveDay({
      seats,
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [1, 2, 3, 5],
        },
      ],
    });

    expect(result.tallies[0]!.voteCount).toBe(4);
    expect(result.tallies[0]!.ghostVotesSpent).toEqual([3]);
    expect(result.outcome).toEqual({ executed: 7, reason: "most-votes" });
  });

  it("rejects a dead seat that already spent its ghost vote in an earlier round", () => {
    const seats = table(8, [3]);
    const result = resolveDay({
      seats,
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [3],
        },
        {
          nominatorSeatIndex: 5,
          nomineeSeatIndex: 1,
          voterSeatIndexes: [3],
        },
      ],
    });

    expect(result.tallies[0]!.voteCount).toBe(1);
    expect(result.tallies[1]!.voteCount).toBe(0);
    expect(result.tallies[1]!.rejectedVotes).toEqual([3]);
  });

  it("counts a seat once even if it is tapped twice", () => {
    const result = resolveDay({
      seats: table(8),
      nominations: [
        {
          nominatorSeatIndex: 6,
          nomineeSeatIndex: 7,
          voterSeatIndexes: [1, 1, 2, 3, 4],
        },
      ],
    });

    expect(result.tallies[0]!.voteCount).toBe(4);
  });

  it("records no execution when nothing was nominated", () => {
    expect(resolveDay({ seats: table(8), nominations: [] }).outcome).toEqual({
      executed: null,
      reason: "no-nominations",
    });
  });

  it("uses the threshold of the living, not the seated", () => {
    // 8 seats, 3 dead: 5 living, threshold 3.
    const result = resolveDay({
      seats: table(8, [0, 1, 2]),
      nominations: [
        {
          nominatorSeatIndex: 4,
          nomineeSeatIndex: 5,
          voterSeatIndexes: [3, 4, 6],
        },
      ],
    });

    expect(result.tallies[0]!.threshold).toBe(3);
    expect(result.outcome).toEqual({ executed: 5, reason: "most-votes" });
  });

  it("accepts a player's projected seat view without conversion", () => {
    // PlayerSeatView-shaped objects satisfy VoteSeat structurally.
    const seats = [
      { seatIndex: 0, alive: true, ghostVoteAvailable: true, extra: "ignored" },
      {
        seatIndex: 1,
        alive: false,
        ghostVoteAvailable: false,
        extra: "ignored",
      },
      { seatIndex: 2, alive: true, ghostVoteAvailable: true, extra: "ignored" },
    ];
    expect(countAlive(seats)).toBe(2);
    expect(voteThreshold(countAlive(seats))).toBe(1);
  });
});

function bid(
  nominatorSeatIndex: number,
  nomineeSeatIndex: number,
  voterSeatIndexes: number[] = [],
): Nomination {
  return { nominatorSeatIndex, nomineeSeatIndex, voterSeatIndexes };
}

describe("checkDayNominations", () => {
  it("keeps the first nomination by a player and refuses the second", () => {
    const checked = checkDayNominations(table(8), [
      bid(1, 3, [0, 4]),
      bid(1, 5, [0, 4]),
    ]);

    expect(checked.legal).toEqual([bid(1, 3, [0, 4])]);
    expect(checked.rejected).toEqual([
      {
        index: 1,
        problems: ["Each player may nominate only once per day"],
      },
    ]);
  });

  it("refuses a second nomination against the same player", () => {
    const checked = checkDayNominations(table(8), [
      bid(1, 3, [0, 4]),
      bid(2, 3, [0, 4]),
    ]);

    expect(checked.legal).toEqual([bid(1, 3, [0, 4])]);
    expect(checked.rejected[0]?.problems).toEqual([
      "Each player may be nominated only once per day",
    ]);
  });

  it("allows a swap, where each player nominates once against the other", () => {
    const checked = checkDayNominations(table(8), [bid(1, 3), bid(3, 1)]);

    expect(checked.legal).toHaveLength(2);
    expect(checked.rejected).toEqual([]);
  });

  it("does not spend a player's once-per-day on a nomination refused for another reason", () => {
    // Seat 6 is dead: its nomination dies with it, but seat 2 never nominated.
    const checked = checkDayNominations(table(8, [6]), [bid(6, 3), bid(2, 3)]);

    expect(checked.legal).toEqual([bid(2, 3)]);
    expect(checked.rejected).toEqual([
      { index: 0, problems: ["A dead player cannot nominate"] },
    ]);
  });

  it("reports every refusal with the index it came in", () => {
    const checked = checkDayNominations(table(6, [4]), [
      bid(0, 1),
      bid(0, 2),
      bid(3, 2),
      bid(4, 5),
    ]);

    // Seat 3's nomination of seat 2 is the day's first against seat 2, so it
    // stands; the duplicates and the dead nominator carry their original indexes.
    expect(checked.legal).toEqual([bid(0, 1), bid(3, 2)]);
    expect(checked.rejected.map((entry) => entry.index)).toEqual([1, 3]);
  });
});
