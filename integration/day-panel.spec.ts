import {
  createGameViaApi,
  expect,
  getStorytellerSnapshot,
  joinGameViaApi,
  test,
} from "./fixtures/multiplayer";

/*
 * Fork addition. The Storyteller's day panel: three taps record a nomination,
 * the server counts the hands when the day ends, and rolling into the next night
 * clears today's nominations without touching who is alive.
 */

const PLAYERS = ["Alex", "Bree", "Cass", "Dev", "Elle", "Finn", "Gus"];

test("records a nomination and ends the day with the server's count", async ({
  createActor,
}) => {
  const storyteller = await createActor();
  const created = await createGameViaApi(storyteller, { playerCount: 7 });
  const joinCode = created.snapshot.game.joinCode;

  const player = await createActor();
  for (const name of PLAYERS) await joinGameViaApi(player, joinCode, name);

  // Seats are dealt in order, so seat numbers in the panel are predictable.
  const current = await getStorytellerSnapshot(storyteller, joinCode);
  const dealt = await storyteller.page.request.patch(
    `/api/storyteller?code=${joinCode}`,
    {
      data: {
        code: joinCode,
        expectedVersion: current.game.version,
        phase: "day",
        seats: current.seats.map((seat, index) => ({
          ...seat,
          roleId: [
            "chef",
            "empath",
            "monk",
            "drunk",
            "poisoner",
            "imp",
            "ravenkeeper",
          ][index % 7],
        })),
      },
    },
  );
  expect(dealt.status()).toBe(200);

  await storyteller.page.goto(`/game/${joinCode}/storyteller`);
  await storyteller.page
    .getByRole("button", { name: "Day", exact: true })
    .click();
  const dayPanel = storyteller.page.getByRole("dialog", { name: "Day" });
  await expect(dayPanel).toBeVisible();
  await expect(dayPanel.getByText("7 living · 4 hands execute")).toBeVisible();

  // Bree nominates Dev, and four hands go up — one over the threshold.
  await dayPanel
    .getByTestId("day-nominator")
    .getByRole("button", { name: "2. Bree", exact: true })
    .click();
  await dayPanel
    .getByTestId("day-nominee")
    .getByRole("button", { name: "4. Dev", exact: true })
    .click();
  for (const name of ["Alex", "Elle", "Finn", "Gus"]) {
    await dayPanel
      .getByTestId("day-hands")
      .getByRole("button", { name, exact: true })
      .click();
  }
  await expect(
    dayPanel.getByText("4 of 4 needed", { exact: false }),
  ).toBeVisible();
  await dayPanel.getByRole("button", { name: "Add nomination" }).click();

  await expect(dayPanel.getByText("Bree nominated Dev")).toBeVisible();
  await expect(
    dayPanel.getByText("4 of 4 hands — would execute"),
  ).toBeVisible();

  // The nomination is a patch on day_state, not a local detail.
  await expect
    .poll(
      async () =>
        (await getStorytellerSnapshot(storyteller, joinCode)).game.dayState
          ?.nominations.length,
    )
    .toBe(1);

  await dayPanel.getByRole("button", { name: "End the day and count" }).click();

  await expect(
    dayPanel.getByRole("button", { name: "Start night 2" }),
  ).toBeVisible();
  await expect(dayPanel.getByText("Dev is executed.")).toBeVisible();

  // The rules resolve the vote; the grimoire owns life and death.
  const closed = await getStorytellerSnapshot(storyteller, joinCode);
  expect(closed.game.dayState?.closed?.executedSeatIndex).toBe(3);
  expect(closed.seats.every((seat) => seat.alive)).toBe(true);

  await dayPanel.getByRole("button", { name: "Start night 2" }).click();

  await expect
    .poll(
      async () =>
        (await getStorytellerSnapshot(storyteller, joinCode)).game.phase ===
        "night",
    )
    .toBe(true);

  const next = await getStorytellerSnapshot(storyteller, joinCode);
  expect(next.game.dayNumber).toBe(2);
  expect(next.game.dayState).toEqual({
    dayNumber: 2,
    nominations: [],
    closed: null,
  });

  // Dawn: the night is over, and the day has to be opened explicitly so player
  // phones stop saying "Night 2" while the table is talking. Starting the night
  // closed the sheet, so reopen it the way the Storyteller would.
  await storyteller.page
    .getByRole("button", { name: "Day", exact: true })
    .click();
  const nextDay = storyteller.page.getByRole("dialog", { name: "Day" });
  await expect(nextDay.getByRole("heading", { name: "Day 2" })).toBeVisible();
  await nextDay.getByRole("button", { name: "Start day 2" }).click();
  await expect
    .poll(
      async () =>
        (await getStorytellerSnapshot(storyteller, joinCode)).game.phase,
    )
    .toBe("day");
  await expect(
    nextDay.getByRole("button", { name: "Start day 2" }),
  ).toHaveCount(0);
});

test("a dead seat's spent ghost vote cannot be raised", async ({
  createActor,
}) => {
  const storyteller = await createActor();
  const created = await createGameViaApi(storyteller, { playerCount: 7 });
  const joinCode = created.snapshot.game.joinCode;

  const player = await createActor();
  for (const name of PLAYERS) await joinGameViaApi(player, joinCode, name);

  const current = await getStorytellerSnapshot(storyteller, joinCode);
  const patched = await storyteller.page.request.patch(
    `/api/storyteller?code=${joinCode}`,
    {
      data: {
        code: joinCode,
        expectedVersion: current.game.version,
        phase: "day",
        seats: current.seats.map((seat) =>
          seat.seatIndex === 6
            ? { ...seat, alive: false, ghostVoteAvailable: false }
            : seat,
        ),
      },
    },
  );
  expect(patched.status()).toBe(200);

  await storyteller.page.goto(`/game/${joinCode}/storyteller`);
  await storyteller.page
    .getByRole("button", { name: "Day", exact: true })
    .click();
  const dayPanel = storyteller.page.getByRole("dialog", { name: "Day" });

  // Six living players, so the threshold is 3.
  await expect(dayPanel.getByText("6 living · 3 hands execute")).toBeVisible();
  await expect(
    dayPanel
      .getByTestId("day-hands")
      .getByRole("button", { name: /Gus .*ghost vote already spent/ }),
  ).toBeDisabled();
});
