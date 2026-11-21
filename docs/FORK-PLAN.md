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

This was the only large hole: a game could not be finished without it.

**Done — storage and resolution.**

- `games.day_state jsonb`: one document per game holding today's nominations and
  the frozen result (`20261116000000_add_day_state.sql`). Chosen over
  `nominations`/`votes` tables because it patches wholesale, exactly like seats
  and tokens, and needs no joins.
- The RPC gained an eighth argument. The old seven-argument signature is dropped
  rather than left as an ambiguous overload. Still `service_role`-only.
- **Rules in TypeScript, not SQL:** `src/lib/engine/vote.ts` (pure, 13 tests) and
  `src/lib/server/day.ts` (`closeDay`). The migration knows nothing about the
  game's rules.
- `POST /api/day` resolves the recorded nominations, spends the ghost votes that
  were raised, and freezes the outcome. **It does not kill the executed player** —
  life and death stay the grimoire's business, so the Storyteller's tap and any
  other deaths land in one place.
- Nominations that break a rule (dead nominator, dead nominee, self-nomination)
  are dropped before the tally and reported, rather than counted.
- `dayState` rides on the storyteller snapshot and is patchable through the
  existing PATCH, so the Storyteller's device can record nominations as they
  happen and a locked phone loses nothing.

**Done — the screens (2026-11-16).**

- **Storyteller day panel**, beside `night-order-sheet.tsx`: three taps record a
  nomination (nominator, nominee, hands), the live threshold is shown as hands go
  up, and "End the day and count" replaces the form with the frozen outcome —
  verdict, every tally, ghost votes spent, and the nominations the rules refused
  (`POST /api/day` now returns them). Dead seats are only tappable while their
  ghost vote is unspent. "Start night" clears the day and moves the clock.
- **Player view:** the day document rides on `PlayerSnapshot` as `day` (it holds
  no roles — everyone saw the hands), the town strip carries a one-line verdict,
  and the full record is behind a read-only Day tab. This did need a projection
  change: the earlier note here was wrong, `PlayerSeatView` alone was not enough.

**Now enforced (2026-11-16):** each player may nominate once per day and be
nominated once per day — `checkDayNominations` in the engine, applied again when
the day is counted, with the refused duplicate named in the outcome. The panel
drops a seat from the pickers once it has had its turn, and a nomination refused
for another reason does not spend it. Sources: the official wiki glossary plus
two independent rulebooks.

**Still open, and deliberately not guessed:** self-nomination, and nominating a
dead player. Our sources disagree. One rulebook says self-nomination is allowed;
the glossary is silent; this engine has always refused it. Two rulebooks say a
dead player cannot be nominated; one says a dead player can still be "executed"
to burn the day. The app keeps the conservative refusal in both cases. Settle it
against the physical rulebook before changing either.

**The round trip closes:** the day panel ends a day with "Start night N+1" and
opens the next with "Start day N", so `phase` is `day` while the table talks and
`night` while it sleeps. The night-order checklist is stored per night, so night
two opens on the other-nights sheet with no ticks carried over.

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

> **Wake prompts are dropped** (decided 2026-11-16). A wake lock, a dim reveal
> and vibration are polish on a problem the table solves by tapping a shoulder,
> and they cost real work on iOS. Revisit only if a playtest says otherwise.

Where upstream is deliberately hands-off and where our engine already has
opinions:

- Refuse a night target that the role's constraints forbid.
- Resolve poisoning **before** the ability resolves, and show the Storyteller the
  true answer privately with "give the real answer anyway".
- Mark the red herring; keep it in no player view.
- Never invent the lie — record what was actually said.

`player-reveal.ts` and `night-reminder-actions.ts` are the seams. Poisoning and
red herring are the only genuinely new state.

## Playtest notes

- **The Storyteller's screen wants landscape.** Upstream shows "Rotate to
  landscape for the grimoire" in portrait below 900px wide, and that notice still
  governs every Storyteller surface including the day panel. The day panel is
  compacted for landscape phones (~390px of height), so the pickers, the hands
  and "Add nomination" fit on one screen; the count button is one small scroll
  away. Do not read the portrait notice as a bug in this fork.
- **Day flow:** deal roles → night one (Night Order, defaults to First Night) →
  "Start day 1" in the day panel → nominations → "End the day and count" →
  "Start night 2" → Night Order (defaults to other nights, no ticks carried) →
  "Start day 2".
- **If every request 500s,** restart `pnpm dev`: `next build` and the dev server
  share `.next`, so running a build while the server is up breaks it until it
  restarts. Supabase must be up first (`colima start`, `supabase start`).
- **Two rules are deliberately unresolved** (see Increment 1): self-nomination
  and nominating a dead player. The app refuses both, so the Storyteller cannot
  record either; a table that plays one of them is playing a house rule for that
  day. Note it and settle it from the physical rulebook afterwards.

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
