/*
 * Voting. The table raises hands; the Storyteller taps which seats voted.
 *
 * Ported from the `clocktower` repository's rules engine
 * (confect/game/engine/vote.ts), which tested these rules at eleven players.
 * Deliberately pure: no React, no Supabase, no `Date.now()`, no randomness. It
 * takes seats in and returns an outcome — the caller persists it.
 *
 * `VoteSeat` is the minimum shape the rules need. Both a full `Seat` (the
 * Storyteller's view) and a `PlayerSeatView` (a player's view) satisfy it, so
 * the same arithmetic can run on either side without conversion.
 *
 * Two rules live here and nowhere else:
 * - the threshold is half the *living* players, rounded up, recomputed every
 *   time rather than remembered;
 * - a dead seat votes once for the whole game, not once per day, so ghost votes
 *   are spent across the day's rounds, in the order they happened.
 */

export type VoteSeat = {
  seatIndex: number;
  alive: boolean;
  ghostVoteAvailable: boolean;
};

export type Nomination = {
  nominatorSeatIndex: number;
  nomineeSeatIndex: number;
  voterSeatIndexes: readonly number[];
};

export type VoteOutcome = {
  voteCount: number;
  threshold: number;
  qualified: boolean;
  /** Every ghost vote spent today, in the order spent, up to this round. */
  ghostVotesSpent: number[];
  /** Votes refused because the seat was dead with no ghost vote left. */
  rejectedVotes: number[];
};

export type DayOutcomeReason =
  | "most-votes"
  | "below-threshold"
  | "tie"
  | "no-nominations";

export type DayOutcome = {
  /** Seat index of the executed player, or null for nobody. */
  executed: number | null;
  reason: DayOutcomeReason;
};

export type DayResult = {
  outcome: DayOutcome;
  tallies: VoteOutcome[];
  ghostVotesSpent: number[];
};

export function countAlive(seats: readonly VoteSeat[]): number {
  return seats.filter((seat) => seat.alive).length;
}

/** Half the living players, rounded up. Verified against the printed board. */
export function voteThreshold(aliveCount: number): number {
  return Math.ceil(aliveCount / 2);
}

/** Rule violations that must be refused before the vote is recorded. */
export function nominationProblems(
  seats: readonly VoteSeat[],
  nomination: Nomination,
): string[] {
  const problems: string[] = [];
  const bySeat = new Map(seats.map((seat) => [seat.seatIndex, seat]));

  const nominator = bySeat.get(nomination.nominatorSeatIndex);
  if (!nominator) {
    problems.push(`No seat ${nomination.nominatorSeatIndex}`);
  } else if (!nominator.alive) {
    problems.push("A dead player cannot nominate");
  }

  const nominee = bySeat.get(nomination.nomineeSeatIndex);
  if (!nominee) {
    problems.push(`No seat ${nomination.nomineeSeatIndex}`);
  } else if (!nominee.alive) {
    problems.push("A dead player cannot be nominated");
  }

  if (nomination.nominatorSeatIndex === nomination.nomineeSeatIndex) {
    // Unresolved, and deliberately unchanged: one rulebook we read
    // (<https://botc.vnamu.com/en/rules>) says self-nomination is allowed, while
    // the official glossary is silent and this engine has always refused it. The
    // same split applies to nominating a dead player, below. Both stay refused
    // until someone with the physical rulebook settles it; see FORK-PLAN.md.
    problems.push("A player cannot nominate themselves");
  }

  return problems;
}

/**
 * Rules that only exist across a whole day, not inside one nomination.
 *
 * "Each player may nominate once per day, and each player may be nominated once
 * per day" — checked in the order the nominations were called, so the first
 * legal one stands and later duplicates are refused. A nomination refused for a
 * different reason does not burn the seat's once-per-day.
 *
 * Sources: the official wiki glossary ("Nomination"), and two independent
 * rulebooks — <https://boct.fly.dev/guide.html> and
 * <https://botc.vnamu.com/en/rules>. Self-nomination and whether a dead player
 * may be nominated are deliberately left to `nominationProblems`, where the
 * sources disagree; see docs/FORK-PLAN.md.
 */
export function checkDayNominations(
  seats: readonly VoteSeat[],
  nominations: readonly Nomination[],
): {
  legal: Nomination[];
  rejected: { index: number; problems: string[] }[];
} {
  const legal: Nomination[] = [];
  const rejected: { index: number; problems: string[] }[] = [];
  const nominators = new Set<number>();
  const nominees = new Set<number>();

  nominations.forEach((nomination, index) => {
    const problems = nominationProblems(seats, nomination);

    if (
      problems.length === 0 &&
      nominators.has(nomination.nominatorSeatIndex)
    ) {
      problems.push("Each player may nominate only once per day");
    }
    if (problems.length === 0 && nominees.has(nomination.nomineeSeatIndex)) {
      problems.push("Each player may be nominated only once per day");
    }

    if (problems.length > 0) {
      rejected.push({ index, problems });
      return;
    }

    nominators.add(nomination.nominatorSeatIndex);
    nominees.add(nomination.nomineeSeatIndex);
    legal.push(nomination);
  });

  return { legal, rejected };
}

/**
 * Resolve a day of nominations. Rounds are processed in the order they were
 * called, so a ghost vote raised in the first round is gone for the second.
 *
 * Ghost votes are spent whether or not the nomination reached the threshold —
 * raising a hand is the cost, not the outcome.
 */
export function resolveDay(params: {
  seats: readonly VoteSeat[];
  nominations: readonly Nomination[];
}): DayResult {
  const { seats, nominations } = params;

  if (nominations.length === 0) {
    return {
      outcome: { executed: null, reason: "no-nominations" },
      tallies: [],
      ghostVotesSpent: [],
    };
  }

  const bySeat = new Map(seats.map((seat) => [seat.seatIndex, seat]));
  const threshold = voteThreshold(countAlive(seats));
  const spent = new Set<number>();
  const tallies: VoteOutcome[] = [];

  for (const nomination of nominations) {
    const rejected: number[] = [];
    const seen = new Set<number>();
    let count = 0;

    for (const seatIndex of nomination.voterSeatIndexes) {
      if (seen.has(seatIndex)) continue; // one vote per seat per round
      seen.add(seatIndex);

      const seat = bySeat.get(seatIndex);
      if (!seat) {
        rejected.push(seatIndex);
        continue;
      }
      if (seat.alive) {
        count += 1;
        continue;
      }
      if (seat.ghostVoteAvailable && !spent.has(seatIndex)) {
        spent.add(seatIndex);
        count += 1;
        continue;
      }
      rejected.push(seatIndex);
    }

    tallies.push({
      voteCount: count,
      threshold,
      qualified: count >= threshold,
      ghostVotesSpent: [...spent],
      rejectedVotes: rejected,
    });
  }

  const qualified = nominations
    .map((nomination, index) => ({ nomination, tally: tallies[index]! }))
    .filter((entry) => entry.tally.qualified);

  if (qualified.length === 0) {
    return {
      outcome: { executed: null, reason: "below-threshold" },
      tallies,
      ghostVotesSpent: [...spent],
    };
  }

  const best = Math.max(...qualified.map((entry) => entry.tally.voteCount));
  const winners = qualified.filter((entry) => entry.tally.voteCount === best);

  if (winners.length > 1) {
    return {
      outcome: { executed: null, reason: "tie" },
      tallies,
      ghostVotesSpent: [...spent],
    };
  }

  return {
    outcome: {
      executed: winners[0]!.nomination.nomineeSeatIndex,
      reason: "most-votes",
    },
    tallies,
    ghostVotesSpent: [...spent],
  };
}
