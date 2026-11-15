# Upstream

This repository is a fork of [BOTC Townsquare](https://github.com/brennenho/botc),
<https://botc.town>, a community-made digital grimoire for Blood on the
Clocktower.

- **Upstream author:** Brennen Ho
- **License:** MIT, Copyright (c) 2026 Brennen Ho — see [LICENSE](LICENSE). Keep it.
- **Forked:** 2026-11-11, from `1c20295` ("Centralize tooltips and replace native title attributes (#35)")
- **Upstream remote:** `upstream https://github.com/brennenho/botc.git`

Upstream is not affiliated with or endorsed by The Pandemonium Institute, and
neither is this fork. Character names, ability text, icons and token art are
third-party material — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
`public/assets` is populated from TPI's official toolmaker resources by
`pnpm sync:assets`.

## Rules of the fork

1. **Keep the license and this file.** MIT requires the copyright notice; a
   reader should be able to tell whose work they are looking at.
2. **Keep our changes separable.** Prefer new files and small, commented diffs
   over rewrites of upstream files, so `git diff upstream/main` stays readable
   and upstream commits can be merged by hand.
3. **Record what we changed** in [docs/FORK-PLAN.md](docs/FORK-PLAN.md), so the
   divergence list is maintained rather than remembered.
4. **Do not rename the product in code** until the fork has been played. The
   product is still unnamed.
5. **Pulling upstream is manual.** `git fetch upstream && git log --oneline
HEAD..upstream/main`. The upstream project is young and solo-maintained;
   expect conflicts in `player.css` and the grimoire components, which are
   where we live.

## Where the design came from

This fork exists to answer a question the upstream README answers the other
way. Upstream says:

> It intentionally does not automate gameplay and is meant to be used with a
> human Storyteller.

We keep the human Storyteller and keep every judgement call theirs. What we add
is **enforcement and prompting**: the app should be able to refuse an illegal
target, resolve poisoning before the ability, compute the vote threshold, and
walk a first-time Storyteller through the night. See `docs/FORK-PLAN.md`.
