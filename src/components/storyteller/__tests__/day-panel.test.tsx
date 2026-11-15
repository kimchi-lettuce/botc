// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayPanel } from "@/components/storyteller/day-panel";
import { emptyDayState } from "@/lib/game-data/day-state";
import type {
  DayClosure,
  DayNominationProblem,
  DayState,
  Seat,
} from "@/lib/game-data/types";

const NAMES = ["Alex", "Bree", "Cass", "Dev", "Elle", "Finn", "Gus", "Hattie"];

function seat(seatIndex: number, overrides: Partial<Seat> = {}): Seat {
  return {
    id: `seat-${seatIndex}`,
    seatIndex,
    playerName: NAMES[seatIndex] ?? `Player ${seatIndex + 1}`,
    claimedByPlayer: true,
    roleId: "chef",
    alignment: "good",
    alive: true,
    ghostVoteAvailable: true,
    isTraveller: false,
    joinedAt: "2026-11-16T09:00:00.000Z",
    ...overrides,
  };
}

const table = (count: number) =>
  Array.from({ length: count }, (_, index) => seat(index));

function renderPanel({
  seats = table(8),
  dayState = emptyDayState(1),
  problems = [] as DayNominationProblem[],
  saving = false,
  onChange = vi.fn(),
  onCloseDay = vi.fn(),
  onStartNight = vi.fn(),
}: {
  seats?: Seat[];
  dayState?: DayState;
  problems?: DayNominationProblem[];
  saving?: boolean;
  onChange?: (next: DayState) => void;
  onCloseDay?: () => void;
  onStartNight?: () => void;
} = {}) {
  render(
    <DayPanel
      seats={seats}
      dayState={dayState}
      problems={problems}
      saving={saving}
      onChange={onChange}
      onCloseDay={onCloseDay}
      onStartNight={onStartNight}
    />,
  );
  return { onChange, onCloseDay, onStartNight };
}

const nomination = (
  id: string,
  nominatorSeatIndex: number,
  nomineeSeatIndex: number,
  voterSeatIndexes: number[],
) => ({ id, nominatorSeatIndex, nomineeSeatIndex, voterSeatIndexes });

const closure = (overrides: Partial<DayClosure> = {}): DayClosure => ({
  executedSeatIndex: 3,
  reason: "most-votes",
  ghostVotesSpent: [],
  tallies: [{ voteCount: 4, threshold: 4, qualified: true }],
  closedAt: "2026-11-16T09:30:00.000Z",
  ...overrides,
});

afterEach(() => cleanup());

describe("DayPanel", () => {
  it("shows the threshold the table has to reach", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Day 1" })).toBeVisible();
    expect(screen.getByText("8 living · 4 hands execute")).toBeVisible();
    expect(screen.getByText("Nobody has been nominated yet.")).toBeVisible();
  });

  it("records three taps as one nomination and clears the form", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    const nominator = screen.getByTestId("day-nominator");
    await user.click(
      within(nominator).getByRole("button", { name: "2. Bree" }),
    );

    const nominee = screen.getByTestId("day-nominee");
    // The nominator cannot nominate themselves.
    expect(
      within(nominee).queryByRole("button", { name: "2. Bree" }),
    ).toBeNull();
    await user.click(within(nominee).getByRole("button", { name: "4. Dev" }));

    const hands = screen.getByTestId("day-hands");
    for (const name of ["Alex", "Elle", "Finn", "Gus"]) {
      await user.click(
        within(hands).getByRole("button", { name: new RegExp(name) }),
      );
    }
    expect(within(hands).getByText(/4 of 4 needed/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add nomination" }));

    expect(onChange).toHaveBeenCalledWith({
      dayNumber: 1,
      closed: null,
      nominations: [
        {
          id: "nomination-1",
          nominatorSeatIndex: 1,
          nomineeSeatIndex: 3,
          voterSeatIndexes: [0, 4, 5, 6],
        },
      ],
    });

    // Form is ready for the next nomination.
    expect(within(hands).getByText(/0 of 4 needed/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add nomination" }),
    ).toBeDisabled();
  });

  it("lists recorded nominations with their hand count", () => {
    renderPanel({
      dayState: {
        ...emptyDayState(1),
        nominations: [nomination("nomination-1", 1, 3, [0, 4])],
      },
    });

    expect(screen.getByText("Bree nominated Dev")).toBeVisible();
    expect(screen.getByText("2 of 4 hands")).toBeVisible();
  });

  it("offers a dead seat only while its ghost vote is unspent", () => {
    const seats = table(8);
    seats[6] = seat(6, { alive: false, ghostVoteAvailable: true });
    seats[7] = seat(7, { alive: false, ghostVoteAvailable: false });

    renderPanel({ seats });

    const hands = screen.getByTestId("day-hands");
    expect(
      within(hands).getByRole("button", { name: /Gus \(dead, ghost vote\)/ }),
    ).toBeEnabled();
    expect(
      within(hands).getByRole("button", {
        name: /Hattie \(dead, ghost vote already spent\)/,
      }),
    ).toBeDisabled();
  });

  it("keeps a dead seat out of the nominator and nominee lists", () => {
    const seats = table(5);
    seats[2] = seat(2, { alive: false });

    renderPanel({ seats });

    expect(
      within(screen.getByTestId("day-nominator")).queryByRole("button", {
        name: "3. Cass",
      }),
    ).toBeNull();
    expect(
      within(screen.getByTestId("day-nominee")).queryByRole("button", {
        name: "3. Cass",
      }),
    ).toBeNull();
  });

  it("removes a nomination without touching the others", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      dayState: {
        ...emptyDayState(1),
        nominations: [
          nomination("nomination-1", 1, 3, [0]),
          nomination("nomination-2", 2, 5, [4]),
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Remove nomination of Dev" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      dayNumber: 1,
      closed: null,
      nominations: [nomination("nomination-2", 2, 5, [4])],
    });
  });

  it("ends the day without inventing an outcome", async () => {
    const user = userEvent.setup();
    const { onCloseDay } = renderPanel();

    await user.click(
      screen.getByRole("button", { name: "End the day and count" }),
    );

    expect(onCloseDay).toHaveBeenCalledTimes(1);
  });

  it("renders the frozen outcome, refused nominations and the way forward", async () => {
    const user = userEvent.setup();
    const { onStartNight } = renderPanel({
      dayState: {
        dayNumber: 1,
        nominations: [
          nomination("nomination-1", 1, 3, [0, 4, 5, 6]),
          nomination("nomination-2", 6, 2, [4]),
        ],
        closed: closure(),
      },
      problems: [
        {
          nominationId: "nomination-2",
          problems: ["Gus is dead and cannot nominate"],
        },
      ],
    });

    expect(screen.getByText("Dev is executed.")).toBeVisible();
    expect(
      screen.getByText("Nomination 1: 4 of 4 needed — passed"),
    ).toBeVisible();
    expect(screen.getByText("Not counted")).toBeVisible();
    expect(
      screen.getByText("Gus nominating Cass: Gus is dead and cannot nominate"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Start night 2" }));
    expect(onStartNight).toHaveBeenCalledTimes(1);
  });

  it("says whose ghost vote was spent", () => {
    renderPanel({
      dayState: {
        dayNumber: 2,
        nominations: [nomination("nomination-1", 0, 1, [5])],
        closed: closure({
          executedSeatIndex: null,
          reason: "below-threshold",
          ghostVotesSpent: [5],
          tallies: [{ voteCount: 1, threshold: 3, qualified: false }],
        }),
      },
    });

    expect(
      screen.getByText("Nobody reached the threshold — nobody is executed."),
    ).toBeVisible();
    expect(screen.getByText("Ghost votes spent: Finn")).toBeVisible();
  });

  it("blocks the count button while a save is in flight", () => {
    renderPanel({ saving: true });

    expect(screen.getByRole("button", { name: "Counting…" })).toBeDisabled();
  });
});
