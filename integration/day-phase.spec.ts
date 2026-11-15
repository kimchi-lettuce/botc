import type { StorytellerSnapshot } from "../src/lib/game-data/types";

import {
  createGameViaApi,
  responseJson,
  expect,
  getStorytellerSnapshot,
  joinGameViaApi,
  patchStorytellerViaApi,
  test,
} from "./fixtures/multiplayer";

/*
 * Fork addition. The day phase: nominations are recorded on the game's day_state
 * and resolved by the server's rules engine. Before this, a game could not be
 * finished — the schema had alive and ghost_vote_available and nothing else.
 */

const PLAYERS = ["Alex", "Bree", "Cass", "Dev", "Elle", "Finn", "Gus"];

test("records nominations, then closes the day with the server's arithmetic", async ({
  createActor,
}) => {
  const storyteller = await createActor();
  const created = await createGameViaApi(storyteller, { playerCount: 7 });
  const joinCode = created.snapshot.game.joinCode;

  const player = await createActor();
  for (const name of PLAYERS) await joinGameViaApi(player, joinCode, name);

  const current = await getStorytellerSnapshot(storyteller, joinCode);
  const seats = [...current.seats].sort((a, b) => a.seatIndex - b.seatIndex);

  // Seat 1 is dead but still holds its ghost vote, and votes on the first
  // nomination. Six living players, so the threshold is half of six: 3.
  const recorded = await patchStorytellerViaApi(
    storyteller,
    joinCode,
    current.game.version,
    {
      phase: "day",
      seats: seats.map((seat) =>
        seat.seatIndex === 1 ? { ...seat, alive: false } : seat,
      ),
      dayState: {
        dayNumber: 1,
        nominations: [
          {
            id: "nomination-1",
            nominatorSeatIndex: 2,
            nomineeSeatIndex: 3,
            voterSeatIndexes: [0, 1, 4, 5],
          },
          {
            id: "nomination-2",
            nominatorSeatIndex: 6,
            nomineeSeatIndex: 0,
            voterSeatIndexes: [6],
          },
        ],
        closed: null,
      },
    },
  );
  expect(recorded.status()).toBe(200);
  const afterRecording = await responseJson<{
    snapshot: StorytellerSnapshot;
  }>(recorded);
  const recordedSnapshot = afterRecording.snapshot;
  expect(recordedSnapshot.game.dayState.nominations).toHaveLength(2);

  const closed = await storyteller.context.request.post("/api/day", {
    data: {
      code: joinCode,
      expectedVersion: recordedSnapshot.game.version,
    },
  });
  expect(closed.status()).toBe(200);
  const closedBody = await responseJson<{ snapshot: StorytellerSnapshot }>(
    closed,
  );
  const snapshot = closedBody.snapshot;

  expect(snapshot.game.dayState.closed).toMatchObject({
    executedSeatIndex: 3,
    reason: "most-votes",
    ghostVotesSpent: [1],
    tallies: [
      { voteCount: 4, threshold: 3, qualified: true },
      { voteCount: 1, threshold: 3, qualified: false },
    ],
  });

  // The ghost vote is spent; nobody is killed by the arithmetic.
  const bySeat = new Map(snapshot.seats.map((seat) => [seat.seatIndex, seat]));
  expect(bySeat.get(1)?.ghostVoteAvailable).toBe(false);
  expect(bySeat.get(3)?.alive).toBe(true);

  // And it persisted, which is what makes a game resumable.
  const reloaded = await getStorytellerSnapshot(storyteller, joinCode);
  expect(reloaded.game.dayState.closed?.executedSeatIndex).toBe(3);
});

test("a player cannot close the day", async ({ createActor }) => {
  const storyteller = await createActor();
  const created = await createGameViaApi(storyteller, { playerCount: 5 });
  const joinCode = created.snapshot.game.joinCode;

  const player = await createActor();
  await joinGameViaApi(player, joinCode, "Alex");

  const response = await player.context.request.post("/api/day", {
    data: { code: joinCode, expectedVersion: 1 },
  });

  expect(response.status()).toBe(401);
});

test("closing the day refuses a stale version", async ({ createActor }) => {
  const storyteller = await createActor();
  const created = await createGameViaApi(storyteller, { playerCount: 5 });
  const joinCode = created.snapshot.game.joinCode;

  const response = await storyteller.context.request.post("/api/day", {
    data: { code: joinCode, expectedVersion: created.snapshot.game.version },
  });

  // The version moved on because joining is not what happens here; the game is
  // untouched, so this should succeed once and then conflict.
  expect(response.status()).toBe(200);

  const again = await storyteller.context.request.post("/api/day", {
    data: { code: joinCode, expectedVersion: created.snapshot.game.version },
  });
  expect(again.status()).toBe(409);
});
