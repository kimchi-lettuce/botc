"use client";

import { BookOpen, Sun } from "lucide-react";
import { useState } from "react";

import {
  CharacterReference,
  type CharacterReferenceView,
} from "@/components/character-sheet/character-reference";
import { GrimoirePanelTabs } from "@/components/grimoire/grimoire-panel-tabs";
import { GrimoireToolbar } from "@/components/grimoire/grimoire-toolbar";
import { PlayerDayPanel } from "@/components/player/player-day-panel";
import { PlayerRoleCard } from "@/components/player/player-role-card";
import { ReadOnlyGrimoireBoard } from "@/components/player/read-only-grimoire-board";
import { TownStrip } from "@/components/player/town-strip";
import { PageError } from "@/components/ui/page-error";
import { Sheet } from "@/components/ui/sheet";
import { StatusNotice } from "@/components/ui/status-notice";
import { useGamePresence } from "@/hooks/use-game-presence";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { usePlayerGame } from "@/hooks/use-player-game";
import { isTerminalGameError } from "@/lib/app-error";
import { roleById } from "@/lib/game-data";
import type { PlayerSnapshot } from "@/lib/game-data/types";
import { cn } from "@/lib/utils";

export function PlayerApp({
  gameCode,
  seatId,
  initialSnapshot,
}: {
  gameCode: string;
  seatId: string;
  initialSnapshot: PlayerSnapshot;
}) {
  const { snapshot, refreshError, isRefreshing, refresh } = usePlayerGame(
    gameCode,
    seatId,
    initialSnapshot,
  );
  const presence = useGamePresence(gameCode, seatId);
  const [redacted, setRedacted] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [referenceView, setReferenceView] =
    useState<CharacterReferenceView>("script");

  useKeyboardShortcuts([
    {
      id: "toggle-script-reference",
      key: "r",
      enabled: !redacted,
      onTrigger: () => setScriptOpen((current) => !current),
    },
    {
      id: "toggle-day-panel",
      key: "d",
      enabled: !redacted,
      onTrigger: () => setDayOpen((current) => !current),
    },
    {
      id: "close-player-panel",
      key: "Escape",
      enabled: scriptOpen || dayOpen,
      onTrigger: () => {
        setScriptOpen(false);
        setDayOpen(false);
      },
    },
  ]);

  if (isTerminalGameError(refreshError)) {
    return (
      <PageError
        title="Game unavailable"
        message="This game may have ended, or this link is no longer valid."
      />
    );
  }

  const role = snapshot.seat.roleId ? roleById.get(snapshot.seat.roleId) : null;

  return (
    <main
      className={cn(
        "storyteller-shell player-grimoire-shell",
        redacted && "is-redacted",
      )}
    >
      <GrimoireToolbar
        editionId={snapshot.game.edition}
        joinCode={snapshot.game.joinCode}
        actorRole="player"
        redacted={redacted}
        onRedactedChange={(nextRedacted) => {
          setRedacted(nextRedacted);
          if (nextRedacted) {
            setScriptOpen(false);
            setDayOpen(false);
          }
        }}
      />

      <TownStrip
        seats={snapshot.seats}
        ownSeat={snapshot.seat}
        game={snapshot.game}
        day={snapshot.day}
      />

      <div className="grimoire-workspace">
        <ReadOnlyGrimoireBoard
          seats={snapshot.seats}
          ownSeat={snapshot.seat}
          onlineSeatIds={presence.onlineSeatIds}
          presenceAvailable={presence.status === "connected"}
          redacted={redacted}
        />
      </div>

      {!redacted && (
        <>
          <GrimoirePanelTabs
            sheetOpen={scriptOpen || dayOpen}
            tabs={[
              {
                id: "day",
                icon: <Sun />,
                label: "Day",
                shortcut: "D",
                active: dayOpen,
                onClick: () => {
                  setScriptOpen(false);
                  setDayOpen((current) => !current);
                },
              },
              {
                id: "script",
                icon: <BookOpen />,
                label: "Reference",
                shortcut: "R",
                active: scriptOpen,
                onClick: () => {
                  setDayOpen(false);
                  setScriptOpen((current) => !current);
                },
              },
            ]}
          />
          <Sheet
            open={dayOpen}
            onOpenChange={setDayOpen}
            title="Day"
            modal={false}
            backdrop={false}
            disablePointerDismissal
            className="character-sheet-side-sheet max-[700px]:!w-screen max-[700px]:!max-w-none max-[700px]:!basis-full"
          >
            <PlayerDayPanel seats={snapshot.seats} day={snapshot.day} />
          </Sheet>
          <Sheet
            open={scriptOpen}
            onOpenChange={setScriptOpen}
            title="Character Reference"
            modal={false}
            backdrop={false}
            disablePointerDismissal
            className="character-sheet-side-sheet max-[700px]:!w-screen max-[700px]:!max-w-none max-[700px]:!basis-full"
          >
            <CharacterReference
              editionId={snapshot.game.edition}
              view={referenceView}
              onViewChange={setReferenceView}
            />
          </Sheet>
        </>
      )}

      <PlayerRoleCard
        role={role ?? null}
        seat={snapshot.seat}
        redacted={redacted}
      />

      {refreshError ? (
        <div className="status-notice-stack">
          <StatusNotice
            tone="connection"
            title="Connection interrupted"
            message="Showing the latest available game."
            actionLabel="Retry"
            actionPending={isRefreshing}
            onAction={() => void refresh()}
          />
        </div>
      ) : null}
    </main>
  );
}
