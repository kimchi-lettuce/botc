// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlayerDayPanel } from "@/components/player/player-day-panel";
import { emptyDayState } from "@/lib/game-data/day-state";
import type {
  DayClosure,
  DayState,
  PlayerSeatView,
} from "@/lib/game-data/types";

const NAMES = ["Alex", "Bree", "Cass", "Dev", "Elle", "Finn"];

function seatView(
  seatIndex: number,
  overrides: Partial<PlayerSeatView> = {},
): PlayerSeatView {
  return {
    id: `seat-${seatIndex}`,
    seatIndex,
    playerName: NAMES[seatIndex] ?? `Player ${seatIndex + 1}`,
    occupied: true,
    publicRoleId: null,
    alive: true,
    ghostVoteAvailable: true,
    isTraveller: false,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

const table = (count: number) =>
  Array.from({ length: count }, (_, index) => seatView(index));

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
  tallies: [{ voteCount: 3, threshold: 3, qualified: true }],
  closedAt: "2026-11-16T09:30:00.000Z",
  ...overrides,
});

afterEach(() => cleanup());

function renderPanel(day: DayState, seats = table(6)) {
  render(<PlayerDayPanel seats={seats} day={day} />);
}

describe("PlayerDayPanel", () => {
  it("shows the day and the threshold before anything is nominated", () => {
    renderPanel(emptyDayState(2));

    expect(screen.getByRole("heading", { name: "Day 2" })).toBeVisible();
    expect(screen.getByText("6 living · 3 hands to execute")).toBeVisible();
    expect(screen.getByText("Nobody has been nominated yet.")).toBeVisible();
  });

  it("lists nominations with their hands and flags the ones that pass", () => {
    renderPanel({
      dayNumber: 1,
      nominations: [
        nomination("nomination-1", 1, 3, [0, 4, 5]),
        nomination("nomination-2", 2, 5, [4]),
      ],
      closed: null,
    });

    expect(screen.getByText("3 hands")).toHaveClass("is-qualified");
    expect(screen.getByText("1 hand")).not.toHaveClass("is-qualified");
  });

  it("shows the counted outcome instead of a running total", () => {
    renderPanel({
      dayNumber: 1,
      nominations: [nomination("nomination-1", 1, 3, [0, 4, 5])],
      closed: closure(),
    });

    expect(screen.getByTestId("player-day-verdict")).toHaveTextContent(
      "Dev is executed.",
    );
    expect(screen.getByText("3 hands")).toBeVisible();
  });

  it("names the ghost votes that were spent", () => {
    renderPanel({
      dayNumber: 1,
      nominations: [nomination("nomination-1", 1, 3, [0, 4])],
      closed: closure({
        executedSeatIndex: null,
        reason: "below-threshold",
        ghostVotesSpent: [5],
        tallies: [{ voteCount: 2, threshold: 3, qualified: false }],
      }),
    });

    expect(
      screen.getByText("Nobody reached the threshold — nobody is executed."),
    ).toBeVisible();
    expect(screen.getByText("Ghost votes spent: Finn")).toBeVisible();
  });

  it("counts only occupied, living seats toward the threshold", () => {
    const seats = table(6);
    seats[4] = seatView(4, { alive: false });
    seats[5] = seatView(5, { occupied: false });

    renderPanel(emptyDayState(1), seats);

    expect(screen.getByText("4 living · 2 hands to execute")).toBeVisible();
  });

  it("carries no character information", () => {
    const seats = table(6);
    seats[0] = seatView(0, { publicRoleId: "chef" });

    renderPanel(emptyDayState(1), seats);

    expect(screen.queryByText(/Chef/)).toBeNull();
    expect(screen.queryByText(/evil/i)).toBeNull();
  });
});
