import {
  createGameViaApi,
  expect,
  getPlayerSnapshot,
  getStorytellerSnapshot,
  joinGameViaApi,
  patchStorytellerViaApi,
  test,
} from "./fixtures/multiplayer";

/*
 * Fork addition. On a phone the player's own character leads the screen, the
 * Storyteller's spatial circle is replaced by a town strip, and no other
 * player's role is rendered.
 *
 * Phone viewport is set here rather than by a Playwright project so this test
 * does not run in the landscape/tablet projects, where the circle is correct.
 */
test.use({ viewport: { width: 375, height: 667 } });

test("phone player view leads with the role card and shows the whole town", async ({
  createActor,
}) => {
  const storyteller = await createActor();
  const { snapshot } = await createGameViaApi(storyteller, {
    playerCount: 7,
  });
  const joinCode = snapshot.game.joinCode;

  const player = await createActor({ viewport: { width: 375, height: 667 } });
  const joined = await joinGameViaApi(player, joinCode, "Alex");
  for (const name of ["Bree", "Cass", "Dev", "Elle", "Finn", "Gus"]) {
    await joinGameViaApi(player, joinCode, name);
  }

  // Joining bumps the game version; re-read before patching.
  const current = await getStorytellerSnapshot(storyteller, joinCode);
  const seats = [...current.seats].sort(
    (first, second) => first.seatIndex - second.seatIndex,
  );
  const ownSeat = seats.find((seat) => seat.id === joined.seatId)!;
  const deadSeat = seats.find((seat) => seat.id !== joined.seatId)!;

  const patched = await patchStorytellerViaApi(
    storyteller,
    joinCode,
    current.game.version,
    {
      phase: "day",
      seats: seats.map((seat) =>
        seat.id === ownSeat.id
          ? { ...seat, roleId: "chef" }
          : seat.id === deadSeat.id
            ? { ...seat, roleId: "poisoner", alignment: "evil", alive: false }
            : seat,
      ),
    },
  );
  expect(patched.status()).toBe(200);

  await player.page.goto(`/game/${joinCode}/player/${joined.seatId}`);

  // The player's own information leads.
  await expect(
    player.page.getByRole("complementary", { name: "Your Character" }),
  ).toContainText("Chef");
  await expect(player.page.getByText("Day 1")).toBeVisible();

  // The circle is replaced by the strip on a phone.
  await expect(player.page.locator(".town-strip")).toBeVisible();
  await expect(player.page.locator(".grimoire-workspace")).toBeHidden();

  // Every seat is visible without scrolling, and the dead one is marked.
  await expect(player.page.locator(".town-strip .town-strip-chip")).toHaveCount(
    7,
  );
  await expect(player.page.getByText("6 alive · 1 dead")).toBeVisible();
  await expect(
    player.page.locator(".town-strip .town-strip-chip.is-dead"),
  ).toHaveCount(1);

  // No other player's role is rendered anywhere on the page.
  await expect(player.page.getByText("Poisoner")).toHaveCount(0);

  // And the strip's content sits below the floating toolbar rather than under it.
  const heading = await player.page
    .locator(".town-strip-heading")
    .boundingBox();
  expect(heading).not.toBeNull();
  expect(heading!.y).toBeGreaterThan(80);
});

test("the day's nominations and outcome reach the player, and nothing else", async ({
  createActor,
}) => {
  const storyteller = await createActor();
  const { snapshot } = await createGameViaApi(storyteller, { playerCount: 7 });
  const joinCode = snapshot.game.joinCode;

  const player = await createActor({ viewport: { width: 375, height: 667 } });
  const joined = await joinGameViaApi(player, joinCode, "Alex");
  for (const name of ["Bree", "Cass", "Dev", "Elle", "Finn", "Gus"]) {
    await joinGameViaApi(player, joinCode, name);
  }

  const current = await getStorytellerSnapshot(storyteller, joinCode);
  const patched = await patchStorytellerViaApi(
    storyteller,
    joinCode,
    current.game.version,
    {
      phase: "day",
      dayState: {
        dayNumber: 1,
        nominations: [
          {
            id: "nomination-1",
            nominatorSeatIndex: 1,
            nomineeSeatIndex: 3,
            voterSeatIndexes: [0, 4, 5, 6],
          },
        ],
        closed: null,
      },
    },
  );
  expect(patched.status()).toBe(200);

  const recorded = await getStorytellerSnapshot(storyteller, joinCode);
  const closed = await storyteller.context.request.post("/api/day", {
    data: { code: joinCode, expectedVersion: recorded.game.version },
  });
  expect(closed.status()).toBe(200);

  // The projection carries the public day record — and still no other roles.
  const { snapshot: playerGame } = await getPlayerSnapshot(
    player,
    joinCode,
    joined.seatId,
  );
  expect(playerGame.day.closed?.executedSeatIndex).toBe(3);
  expect(
    playerGame.seats.filter((seat) => seat.publicRoleId !== null),
  ).toHaveLength(0);

  await player.page.goto(`/game/${joinCode}/player/${joined.seatId}`);

  // A glance at the strip says who died today.
  await expect(player.page.locator(".town-strip-day")).toHaveText(
    "Dev is executed.",
  );

  // The full record is behind the Day tab.
  await player.page.getByRole("button", { name: "Day", exact: true }).click();
  const daySheet = player.page.getByRole("dialog", { name: "Day" });
  await expect(daySheet).toBeVisible();
  await expect(daySheet.getByText("Bree nominated Dev")).toBeVisible();
  await expect(daySheet.getByTestId("player-day-verdict")).toHaveText(
    "Dev is executed.",
  );
  await expect(daySheet.getByText("4 hands", { exact: true })).toBeVisible();

  // Pressing D closes it again, like the reference sheet.
  await player.page.keyboard.press("d");
  await expect(daySheet).toBeHidden();
});
