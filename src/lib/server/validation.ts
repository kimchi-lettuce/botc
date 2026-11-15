import { z } from "zod";

import { roleById } from "@/lib/game-data";
import { GAME_CODE_PATTERN } from "@/lib/game-code";

const gameCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(GAME_CODE_PATTERN, "Enter a valid game code."));

const roleId = z
  .string()
  .trim()
  .refine((value) => roleById.has(value), "Character is not supported.");

const mutableSeat = z
  .object({
    id: z.string().uuid(),
    seatIndex: z.number().int().min(0).max(19),
    playerName: z.string().trim().min(1).max(40),
    claimedByPlayer: z.boolean(),
    roleId: roleId.nullable(),
    alignment: z.enum(["good", "evil"]),
    alive: z.boolean(),
    ghostVoteAvailable: z.boolean(),
    isTraveller: z.boolean(),
    joinedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const mutableToken = z
  .object({
    id: z.string().uuid(),
    seatId: z.string().uuid().nullable(),
    tokenType: z.enum(["reminder", "bluff", "custom"]),
    roleId: roleId.nullable(),
    label: z.string().trim().min(1).max(80),
    position: z.number().int().min(0),
    metadata: z.record(z.unknown()),
  })
  .strict();

export const createGameSchema = z
  .object({
    edition: z.enum(["tb", "bmr", "snv"]),
    playerCount: z.number().int().min(5).max(20).default(7),
  })
  .strict();

export const joinGameSchema = z
  .object({
    joinCode: gameCode,
    playerName: z.string().trim().min(1).max(40),
  })
  .strict();

const dayNomination = z
  .object({
    id: z.string().trim().min(1).max(64),
    nominatorSeatIndex: z.number().int().min(0).max(19),
    nomineeSeatIndex: z.number().int().min(0).max(19),
    voterSeatIndexes: z.array(z.number().int().min(0).max(19)).max(20),
  })
  .strict();

const dayClosure = z
  .object({
    executedSeatIndex: z.number().int().min(0).max(19).nullable(),
    reason: z.enum(["most-votes", "below-threshold", "tie", "no-nominations"]),
    ghostVotesSpent: z.array(z.number().int().min(0).max(19)).max(20),
    tallies: z
      .array(
        z
          .object({
            // Added after the first days were stored; older rows normalize to "".
            nominationId: z.string().max(64).default(""),
            voteCount: z.number().int().min(0),
            threshold: z.number().int().min(0),
            qualified: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    closedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const dayStateSchema = z
  .object({
    dayNumber: z.number().int().positive(),
    nominations: z.array(dayNomination).max(20),
    closed: dayClosure.nullable(),
  })
  .strict();

export const dayCloseSchema = z
  .object({
    code: gameCode,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const storytellerPatchSchema = z
  .object({
    code: gameCode,
    expectedVersion: z.number().int().positive(),
    phase: z.enum(["setup", "day", "night"]).optional(),
    dayNumber: z.number().int().positive().optional(),
    seats: z.array(mutableSeat).max(20).optional(),
    gameTokens: z.array(mutableToken).max(250).optional(),
    dayState: dayStateSchema.optional(),
  })
  .strict();

export const gameCodeSchema = gameCode;
export const seatIdSchema = z.string().uuid();

export type MutableSeatInput = z.infer<typeof mutableSeat>;
export type MutableTokenInput = z.infer<typeof mutableToken>;
