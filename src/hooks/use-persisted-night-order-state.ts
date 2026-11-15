import { useCallback } from "react";

import {
  type PersistedStateCodec,
  usePersistedState,
} from "@/hooks/use-persisted-state";

import {
  createDefaultNightOrderState,
  normalizeNightOrderState,
  type NightOrderState,
} from "@/lib/night-order-state";

const storagePrefix = "botc:night-order:";
const nightOrderCodec: PersistedStateCodec<NightOrderState> = {
  parse: (value) => normalizeNightOrderState(JSON.parse(value) as unknown),
  stringify: JSON.stringify,
};

/*
 * One checklist per night, not one per game. The sheet keeps its ticks in
 * localStorage; keying it by the night number stops yesterday's completed steps
 * from showing up as today's, and the default view follows the script — first
 * night, then every other night — which the Storyteller can still override.
 */
export function usePersistedNightOrderState(
  gameCode: string,
  nightNumber: number,
) {
  const night = nightNumber > 1 ? "other" : "first";
  const createDefault = useCallback(
    () => createDefaultNightOrderState(night),
    [night],
  );
  return usePersistedState(
    `${storagePrefix}${gameCode}:night-${nightNumber}`,
    createDefault,
    nightOrderCodec,
  );
}
