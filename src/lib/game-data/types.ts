import type { NightReminderAction } from "@/lib/game-data/night-reminder-actions";

export type EditionId = "tb" | "bmr" | "snv";
export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";
export type ResidentTeam = Exclude<Team, "traveller">;
export type Alignment = "good" | "evil";
export type Phase = "setup" | "day" | "night";

export type Role = {
  id: string;
  name: string;
  edition: EditionId;
  team: Team;
  ability: string;
  flavor?: string;
  firstNightReminder?: string;
  otherNightReminder?: string;
  reminders: string[];
  setup: boolean;
  imagePath: string;
};

export type TeamCounts = Record<ResidentTeam, number>;

export type SetupAssessment = {
  legal: boolean;
  assignedCount: number;
  expected: TeamCounts | null;
  actual: TeamCounts;
  warnings: string[];
};

export type SetupReminderWarning = {
  roleId: string;
  roleName: string;
  missing: { label: string; count: number }[];
};

export type NightOrderEntry = {
  id: string;
  name: string;
  reminder: string;
  reminderActions: NightReminderAction[];
  role: Role | null;
  system: boolean;
};

export type Game = {
  joinCode: string;
  edition: EditionId;
  phase: Phase;
  dayNumber: number;
  version: number;
  dayState: DayState;
  createdAt: string;
  updatedAt: string;
};

/**
 * One day of nominations, as the Storyteller recorded them.
 *
 * Seats are referenced by their index — the number the table says out loud —
 * rather than by id, because that is the coordinate the engine's rules work in
 * (`src/lib/engine/vote.ts`). Day state is cleared each day, so reindexing
 * cannot make a stale nomination point at the wrong seat.
 */
export type DayNomination = {
  id: string;
  nominatorSeatIndex: number;
  nomineeSeatIndex: number;
  voterSeatIndexes: number[];
};

/** Frozen once the Storyteller ends the day. */
export type DayClosure = {
  executedSeatIndex: number | null;
  reason: DayOutcomeReason;
  ghostVotesSpent: number[];
  tallies: {
    voteCount: number;
    threshold: number;
    qualified: boolean;
  }[];
  closedAt: string;
};

export type DayOutcomeReason =
  | "most-votes"
  | "below-threshold"
  | "tie"
  | "no-nominations";

export type DayState = {
  dayNumber: number;
  nominations: DayNomination[];
  closed: DayClosure | null;
};

/**
 * A nomination the rules refused when the day was counted. Returned alongside
 * the closed snapshot so the Storyteller can see what was dropped instead of
 * wondering why a vote did not count.
 */
export type DayNominationProblem = {
  nominationId: string;
  problems: string[];
};

export type Seat = {
  id: string;
  seatIndex: number;
  playerName: string;
  claimedByPlayer: boolean;
  roleId: string | null;
  alignment: Alignment;
  alive: boolean;
  ghostVoteAvailable: boolean;
  isTraveller: boolean;
  joinedAt: string;
};

export type PlayerSeatView = {
  id: string;
  seatIndex: number;
  playerName: string | null;
  occupied: boolean;
  publicRoleId: string | null;
  alive: boolean;
  ghostVoteAvailable: boolean;
  isTraveller: boolean;
  position: {
    x: number;
    y: number;
  };
};

export type GameToken = {
  id: string;
  seatId: string | null;
  tokenType: "reminder" | "bluff" | "custom";
  roleId: string | null;
  label: string;
  position: number;
  metadata: Record<string, unknown>;
};

export type StorytellerSnapshot = {
  game: Game;
  seats: Seat[];
  gameTokens: GameToken[];
};

export type StorytellerPatch = {
  phase?: Phase;
  dayNumber?: number;
  seats?: Seat[];
  gameTokens?: GameToken[];
  dayState?: DayState;
};

export type VersionedStorytellerPatch = StorytellerPatch & {
  expectedVersion: number;
};

export type PlayerSnapshot = {
  game: Pick<Game, "joinCode" | "edition" | "phase" | "dayNumber" | "version">;
  seat: Seat;
  seats: PlayerSeatView[];
};
