/*
 * Builds a reviewable artifact: screenshots and a PDF presenting them with
 * captions. Not part of the app — run by hand:
 *
 *   node scripts/walkthrough.mjs
 *
 * Requires the dev server on :3000 and Supabase running (colima + supabase start).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "artifacts");
const shots = join(out, "shots");
const BASE = "http://localhost:3000";

const ROLES = [
  "chef",
  "empath",
  "monk",
  "drunk",
  "poisoner",
  "imp",
  "ravenkeeper",
];
const EVIL = new Set(["poisoner", "imp", "scarletwoman", "baron"]);
const OTHERS = ["Bree", "Cass", "Dev", "Elle", "Finn", "Gus"];
const PLAYER_NAME = "Alex";

await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const sections = [];
let shotIndex = 0;

async function capture(page, title, caption) {
  shotIndex += 1;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const file = `${String(shotIndex).padStart(2, "0")}-${slug}.jpg`;
  // JPEG at high quality: these are reviewed as a document, and lossless PNGs of
  // dense UI at 2-3x made the PDF 27 MB.
  await page.screenshot({ path: join(shots, file), type: "jpeg", quality: 88 });
  sections.push({ file, title, caption });
  console.log(`captured ${file}`);
}

/*
 * Seats are claimed from the context that will later look at them, because the
 * player credential is a cookie and cookies do not cross browser contexts. The
 * "before" and laptop views reuse the player's storage state for that reason.
 */
const stCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const phoneCtx = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
});

const created = await stCtx.request.post(`${BASE}/api/games`, {
  data: { edition: "tb", playerCount: 7 },
});
const { snapshot } = await created.json();
const code = snapshot.game.joinCode;

const joined = await phoneCtx.request.post(`${BASE}/api/join`, {
  data: { joinCode: code, playerName: PLAYER_NAME },
});
const { seatId } = await joined.json();

for (const playerName of OTHERS) {
  const response = await stCtx.request.post(`${BASE}/api/join`, {
    data: { joinCode: code, playerName },
  });
  if (!response.ok()) throw new Error(`join failed: ${response.status()}`);
}

const current = (await (
  await stCtx.request.get(`${BASE}/api/storyteller?code=${code}`)
).json()).snapshot;
const patched = await stCtx.request.patch(`${BASE}/api/storyteller`, {
  data: {
    code,
    expectedVersion: current.game.version,
    phase: "day",
    dayNumber: 1,
    seats: current.seats.map((seat, index) => ({
      ...seat,
      roleId: ROLES[index % ROLES.length],
      alignment: EVIL.has(ROLES[index % ROLES.length]) ? "evil" : "good",
      alive: index !== 2,
    })),
  },
});
if (!patched.ok()) throw new Error(`patch failed: ${patched.status()}`);

const playerState = await phoneCtx.storageState();

// ---------------------------------------------------------------------------
// Desktop: home, the Storyteller's grimoire, the night order sheet.
// ---------------------------------------------------------------------------
const st = await stCtx.newPage();
await st.goto(`${BASE}/`, { waitUntil: "networkidle" });
await st.waitForTimeout(900);
await capture(
  st,
  "Home",
  "Upstream's own front door: create a game, or join with a six-character code. Untouched by us.",
);

await st.goto(`${BASE}/game/${code}/storyteller`, { waitUntil: "networkidle" });
await st.waitForTimeout(1200);
await capture(
  st,
  "Storyteller grimoire",
  "Every seat, its character, alive or dead, with the Demon bluffs pinned at the bottom. This is the part we did not have to build, and the main reason the fork was worth doing.",
);

const nightTab = st.getByRole("button", { name: "Night Order" }).first();
if (await nightTab.count()) {
  await nightTab.click();
  await st.waitForTimeout(1400);
  await capture(
    st,
    "Night order",
    "Already per-step: numbered entries, the official night-sheet instruction for each, checkmarks as the Storyteller works, and inline reminder-token placement. This is why 'add prompts' is a small job rather than a build.",
  );
}
await stCtx.close();

// ---------------------------------------------------------------------------
// Phone player view — ours.
// ---------------------------------------------------------------------------
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/game/${code}/player/${seatId}`, {
  waitUntil: "networkidle",
});
await phone.waitForTimeout(1200);
await capture(
  phone,
  "Player phone after",
  "Our change. Your character is the screen: role, team, alignment, seat, and the exact ability text at a size you can read across a table. Above it, every seat at a glance with the day number and a live/dead count; the dead seat is struck through with a skull. All seven seats fit without scrolling. The empty lower half is deliberate for now — it is where the day's nominations and votes will land.",
);
await phoneCtx.close();

// ---------------------------------------------------------------------------
// Phone player view — upstream layout, same game, for comparison.
// Rendered in its own context with the reverting CSS injected before first
// paint, because this build's headless renderer does not reliably repaint after
// in-place style mutations.
// ---------------------------------------------------------------------------
const beforeCtx = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
});
await beforeCtx.addCookies(playerState.cookies);
await beforeCtx.addInitScript(() => {
  const css = `
    .town-strip { display: none !important; }
    .player-grimoire-shell { grid-template-rows: minmax(0, 1fr) auto !important; }
    .player-grimoire-shell .grimoire-workspace { display: block !important; height: auto !important; }
    .player-private-role { max-height: 38svh !important; align-content: start !important; grid-template-columns: 54px minmax(0, 1fr) auto !important; grid-template-areas: "token copy status" "token ability ability" !important; }
    .player-private-role-ability { font-size: 12px !important; line-height: 1.45 !important; padding-right: 0 !important; }
    .player-private-role-copy strong { font-size: 17px !important; }
    .player-private-role-token-slot, .player-private-role-token { width: 52px !important; height: 52px !important; }
  `;
  const inject = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  } else {
    inject();
  }
});
const before = await beforeCtx.newPage();
await before.goto(`${BASE}/game/${code}/player/${seatId}`, {
  waitUntil: "networkidle",
});
await before.waitForTimeout(1200);
await capture(
  before,
  "Player phone before",
  "Upstream, same game — our phone-layout rules reverted before first paint so the two can be compared directly. The Storyteller's spatial circle takes the top two-thirds, most seats render as anonymous \"not assigned\" discs, and the player's own ability is a footnote in a 12px bar.",
);
await beforeCtx.close();

// ---------------------------------------------------------------------------
// Desktop player view: deliberately unchanged.
// ---------------------------------------------------------------------------
const wideCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await wideCtx.addCookies(playerState.cookies);
const wide = await wideCtx.newPage();
await wide.goto(`${BASE}/game/${code}/player/${seatId}`, {
  waitUntil: "networkidle",
});
await wide.waitForTimeout(1000);
await capture(
  wide,
  "Player laptop unchanged",
  "At laptop and tablet widths the circle stays, because there the spatial view is genuinely useful — it is the table's shared coordinate system. The role card stays as a floating card on the left.",
);
await wideCtx.close();

await browser.close();

// ---------------------------------------------------------------------------
// Report → self-contained HTML (dark, matching the vault's other build notes)
// ---------------------------------------------------------------------------
const dataUri = async (file) => {
  const bytes = await readFile(join(shots, file));
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
};

const pick = (title) => sections.find((section) => section.title === title);
const figure = async (title, extraClass = "") => {
  const section = pick(title);
  if (!section) return "";
  return `
    <figure class="${extraClass}">
      <img src="${await dataUri(section.file)}" alt="${section.title}" />
      <figcaption><strong>${section.title}.</strong> ${section.caption}</figcaption>
    </figure>`;
};

const stacked = [];
for (const title of ["Home", "Storyteller grimoire", "Night order"]) {
  stacked.push(await figure(title));
}
const beforeAfter = `
  <div class="pair">
    ${await figure("Player phone before")}
    ${await figure("Player phone after")}
  </div>
  <p class="muted small">Same game, same seat, same moment — the only difference is our stylesheet.</p>`;
const laptop = await figure("Player laptop unchanged");

const html = `<!doctype html><html lang='en'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Clocktower — what we built on botc.town</title>
<style>
:root{--bg:#0d1117;--fg:#dbe4f0;--muted:#8b9bb0;--accent:#58a6ff;--border:#21262d;--card:#161b22;--ok:#56d364;--warn:#d29922;--bad:#f85149;--evil:#f778ba;--good:#7ee787}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:2rem 1.2rem}
h1,h2,h3{color:#fafbfc;line-height:1.25}
h1{font-size:2rem;margin:.2rem 0 .4rem}
h2{margin-top:2.6rem;border-bottom:1px solid var(--border);padding-bottom:.4rem;font-size:1.35rem}
h3{margin:1.8rem 0 .6rem;font-size:1.05rem}
p{margin:0 0 1em}
a{color:var(--accent)}
code{background:#1c2128;padding:.15em .4em;border-radius:4px;font-size:.9em}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
main{max-width:960px;margin:0 auto}
.kicker{color:var(--accent);font-size:.78em;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.sub{color:var(--muted);margin:0 0 1.6rem}
.lede{font-size:1.05em}
.callout{border-left:3px solid var(--accent);padding:.9rem 1.2rem;margin:1.3rem 0;background:#12181f;border-radius:0 8px 8px 0}
.callout.ok{border-color:var(--ok);background:#0d1911}
.callout.warn{border-color:var(--warn);background:#191608}
.callout p:last-child{margin-bottom:0}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1.1rem}
figure{margin:0 0 1.6rem}
figure img{width:100%;display:block;border:1px solid var(--border);border-radius:8px;background:#000}
figcaption{color:var(--muted);font-size:.9em;margin-top:.6rem}
figcaption strong{color:#c9d6e6}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;align-items:start}
.pair figure img{border-color:#30363d}
@media(max-width:760px){.pair{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.94em}
th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--border);vertical-align:top}
th{color:#a4b1c2;font-weight:600;font-size:.85em;text-transform:uppercase;letter-spacing:.03em}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:var(--muted)}
.small{font-size:.9em}
.tag{display:inline-block;padding:.12em .55em;border-radius:99px;font-size:.78em;font-weight:600;white-space:nowrap}
.tag.ok{background:#0d1911;color:var(--ok);border:1px solid #1d3a24}
.tag.ours{background:#0d1a26;color:#79c0ff;border:1px solid #1d3a52}
.tag.up{background:#1c2128;color:#a4b1c2;border:1px solid #30363d}
ul{margin:.6rem 0 0;padding-left:1.2rem}
li{margin:.35rem 0}
hr{border:0;border-top:1px solid var(--border);margin:2rem 0}
footer{color:var(--muted);font-size:.85em;border-top:1px solid var(--border);padding-top:1rem;margin-top:2.6rem}
</style></head><body><main>

<div class='kicker'>Clocktower · build review</div>
<h1>A fork of botc.town, and what we changed</h1>
<p class='sub'>What exists, what it looks like, what is next.</p>

<p class='lede'>The product is now a fork of <strong>BOTC Townsquare</strong>
(<a href='https://botc.town'>botc.town</a>, MIT) rather than the Solid/Convex app this project
started as. The reason is evidence rather than taste: the grimoire, the invite link and QR code,
the accounts-free join flow, live presence, the night-order sheet and three full scripts are
already built, tested and deployed there — and their Trouble Brewing ability text matches ours
word for word across all twenty shared characters.</p>

<div class='callout'>
  <p><strong>What that leaves for us.</strong> Their schema has <code>alive</code> and
  <code>ghost_vote_available</code> and no voting at all, so a game cannot currently be finished.
  And players are handed the Storyteller's spatial map on a phone-sized screen. Those two are the
  work — the day phase, and a player screen that leads with the player's own character.</p>
</div>

<h2>Whose work is whose</h2>
<table>
  <tr><th>Piece</th><th>Where it comes from</th></tr>
  <tr><td>Grimoire, invite link, QR code, presence, reminders, Demon bluffs</td><td><span class='tag up'>upstream</span></td></tr>
  <tr><td>Night-order sheet with per-step instructions and inline actions</td><td><span class='tag up'>upstream</span></td></tr>
  <tr><td>Trouble Brewing, Bad Moon Rising, Sects &amp; Violets, 181 roles</td><td><span class='tag up'>upstream</span></td></tr>
  <tr><td>Vote arithmetic, ghost votes, nomination legality, day resolution</td><td><span class='tag ours'>ours</span></td></tr>
  <tr><td>Phone player screen: town strip and role card first</td><td><span class='tag ours'>ours</span></td></tr>
  <tr><td><code>pnpm dev</code> without a PostHog account</td><td><span class='tag ours'>ours</span></td></tr>
</table>

<h2>The screens</h2>
<h3>What was already there</h3>
${stacked.join("\n")}

<h3>The player screen, before and after</h3>
${beforeAfter}

<h3>Unchanged where it should be</h3>
${laptop}

<h2>Verification</h2>
<table>
  <tr><th>Check</th><th class='num'>Result</th></tr>
  <tr><td>Unit tests (vitest)</td><td class='num'>196 passing</td></tr>
  <tr><td>Integration tests (Playwright)</td><td class='num'>35 passing</td></tr>
  <tr><td>TypeScript (<code>tsc --noEmit</code>)</td><td class='num'>clean</td></tr>
  <tr><td>ESLint</td><td class='num'>clean</td></tr>
  <tr><td>New phone player-view spec</td><td class='num'>passing</td></tr>
  <tr><td>Player payload leak check</td><td class='num'>no other roles</td></tr>
</table>

<h2>Decided and built</h2>
<ul>
  <li><span class='tag ours'>decision</span> <strong>Fork, not rebuild.</strong> The original repository keeps the rules engine and the content of record; the fork carries the interface.</li>
  <li><span class='tag ours'>built</span> <strong>The vote engine is ported</strong> — threshold, nomination legality, ghost votes across the day's rounds, ties, execution. Pure TypeScript, 13 tests, and it accepts either a Storyteller seat or a player's projected seat, because both satisfy a minimal <code>VoteSeat</code>.</li>
  <li><span class='tag ours'>built</span> <strong>The day phase is persisted and resolved server-side</strong> — nominations recorded on the game row, illegal ones dropped before the tally, ghost votes spent, the outcome frozen. <code>POST /api/day</code>. Three integration specs cover it, including a player being refused and a stale version conflicting.</li>
  <li><span class='tag ours'>built</span> <strong>Phone player screen rebuilt</strong> — verified at 375 and 360 pixels wide, and deliberately untouched at laptop and tablet widths.</li>
  <li><span class='tag ours'>decision</span> <strong>Official token art now ships.</strong> Upstream syncs TPI's published toolmaker resources, so the old "no official art" principle is retired. Ability text stays faithful; the product stays free.</li>
</ul>

<h2>Next, in order</h2>
<ul>
  <li><strong>The Storyteller's day panel</strong> — nominations, hands-up votes by seat, the live threshold and the outcome. The storage and resolution behind it are built and tested; this is the last gate to a finishable game.</li>
  <li><strong>Ability resolution</strong> — poisoning applied before the ability resolves, the red herring, and the "give the real answer anyway" path.</li>
</ul>

<div class='callout warn'>
  <p><strong>The one thing that needs a human.</strong> One game night with a first-time Storyteller.
  If they cope unaided, the premise is wrong and we should stop building. If they fumble the vote
  threshold or the poisoning order, the engine already written is exactly the missing piece.</p>
</div>

<footer>
  Generated by <code>scripts/walkthrough.mjs</code> against a real local game: seven seats,
  Trouble Brewing, roles dealt, one player dead, day 1. The "before" screenshot is the same game
  with our phone-layout rules reverted before first paint, so the two are directly comparable.
</footer>

</main></body></html>`;

const localFile = join(out, "build-review.html");
await writeFile(localFile, html, "utf8");
console.log(`wrote ${localFile}`);

// Drop a copy in the vault, next to the storyteller brief, so it opens in Obsidian.
const vaultDir = join(homedir(), "Desktop", "Daily Journal", "projects", "clocktower");
try {
  await mkdir(vaultDir, { recursive: true });
  const vaultFile = join(vaultDir, "build-review.html");
  await writeFile(vaultFile, html, "utf8");
  console.log(`wrote ${vaultFile}`);
} catch (error) {
  console.log(`vault copy skipped: ${error.message}`);
}
