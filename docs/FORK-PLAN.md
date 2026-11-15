# Fork plan

What this fork adds to upstream, in the order it should be built. Written after
reading the code, not the README. Every "verified" line below was checked in
this repository on 2026-11-11.

## Verified state of upstream

| Thing              | Reality                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack              | Next.js 15 App Router, React 19, TypeScript, Supabase/Postgres, Tailwind                                                                               |
| Backend            | RLS denies `anon`/`authenticated`; all access via `security definer` RPCs called from `src/app/api/*` route handlers with rate limits                  |
| Projection         | `getPlayerSnapshotByCode` sends only own seat + `PlayerSeatView[]`; `createPlayerSeatView` nulls `publicRoleId` for everyone except Travellers         |
| Ability text       | **Parity: zero differences** against our Trouble Brewing content across the 20 shared roles, compared word for word                                    |
| Night instructions | `roles.json` already carries `firstNightReminder` / `otherNightReminder` per role, from the official night sheet, with `:reminder:` markers            |
| Night order screen | `night-order-sheet.tsx` already numbers steps, checks them off, formats info tokens, places reminders, and persists state per night/scope              |
| Voting             | **Absent.** The schema has `alive` and `ghost_vote_available` and nothing else. No nominations, no votes, no threshold. `grep -i vote` finds no files. |
| Content            | TB + BMR + SnV + 5 TB Travellers, 181 roles including carousel                                                                                         |

Two conclusions that change the plan:

1. **Content is not a port.** Our `troubleBrewing.ts` and their `roles.json` agree
   word for word. Do not copy ours over theirs; keep theirs and keep upstream
   mergeable.
2. **The night wizard is mostly not a port either.** Their sheet is a checklist
   with per-step instructions, reminder placement and reveal actions. Ours is a
   one-step-at-a-time focus. That difference is worth building, but it is an
   addition to a working screen, not a replacement we have to finish.

## Increment 1 — day phase and vote arithmetic (the real gap)

This is the only large hole: a game cannot be finished without it.

- **Schema** (`supabase/migrations/*_day_phase.sql`): `nominations` and `votes`
  tables, or a `game_day_state` JSONB column. Nothing conflicts — the ground is
  empty.
- **Rules (port, no rewrite):** `applyDayResult` from
  `/Users/m_mye/Developer/clocktower/confect/game/engine/` — threshold, ties,
  ghost-vote spending, deaths, endgame. Already tested at eleven players. It is
  pure TypeScript with no Convex imports, so it drops into `src/lib/engine/`.
- **RPC:** extend `botc_update_game` or add `botc_resolve_day`, keeping the
  `service_role`-only pattern.
- **Storyteller UI:** a day panel beside `night-order-sheet.tsx` — tap seats for
  hands-up votes, show the threshold, resolve.
- **Player UI:** their `PlayerSeatView` already carries `alive` and
  `ghostVoteAvailable`, so the player side needs no backend change to show the
  result.

## Increment 2 — role-card-first player screen (the design gap)

The player currently gets `read-only-grimoire-board.tsx`: the Storyteller's town
circle, read-only, with the role in a bar at the bottom (`src/styles/player.css`,
`@media (max-width: 700px)` gives the board `minmax(0,1fr)` and caps the card at
`38svh`).

Players are not looking at a map most of the time. They are looking at _their
ability_ and _who is alive_.

- `src/components/player/player-role-card.tsx` already renders role, team,
  alignment, alive/dead, ghost vote and ability text — it is only demoted.
- Move the town circle behind a panel tab (the `GrimoirePanelTabs` +
  `Sheet` pattern is already used for "Reference" in `player-app.tsx`).
- Keep the circle on tablet/landscape, where the spatial view is genuinely
  useful — it is the table's shared coordinate system.
- First change made: board capped and card promoted on phones in `player.css`.
  Tune by eye; it is one media query.

## Increment 3 — resolution help (the interesting one)

Where upstream is deliberately hands-off and where our engine already has
opinions:

- Refuse a night target that the role's constraints forbid.
- Resolve poisoning **before** the ability resolves, and show the Storyteller the
  true answer privately with "give the real answer anyway".
- Mark the red herring; keep it in no player view.
- Never invent the lie — record what was actually said.

`player-reveal.ts` and `night-reminder-actions.ts` are the seams. Poisoning and
red herring are the only genuinely new state.

## What we do not port

- Solid UI. This fork is React. The screens and the design reasoning carry over;
  the components do not.
- Our Convex backend, Confect authoring and `gameView`. Upstream's projection is
  already server-side and correct, and replacing it would restart the leak
  surface for no gain.

## Blocker

The app cannot be run or tested without Docker (`supabase start`). Everything
above can be written and typechecked without it; nothing can be **played**
without it. `pnpm typecheck` is green as cloned.

## Review artifacts

`node scripts/walkthrough.mjs` seeds a real local game (7 seats, Trouble Brewing,
roles dealt, one player dead, day 1), captures six screenshots and writes one
self-contained `artifacts/build-review.html` (images inlined, dark theme, styled
to match the owner's Obsidian vault notes) plus `artifacts/shots/`. It also
copies the HTML to `~/Desktop/Daily Journal/projects/clocktower/build-review.html`
so it opens alongside the storyteller brief. `artifacts/` is gitignored.
Requires the dev server on :3000 and Supabase up.

Two traps worth knowing, both hit while building it:

- **Player credentials are cookies, and cookies do not cross browser contexts.**
  A seat must be claimed from the context that will later view it, or the phone
  page renders "Game unavailable" — which looks exactly like a layout bug.
- **This Playwright build does not reliably repaint after in-place style
  mutations**, so an "upstream layout restored afterwards" screenshot silently
  captures the unmodified page. Render comparison variants in their own context
  with the CSS injected before first paint.
