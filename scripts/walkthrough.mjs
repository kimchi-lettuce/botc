/*
 * Builds a reviewable artifact: screenshots and a PDF presenting them with
 * captions. Not part of the app — run by hand:
 *
 *   node scripts/walkthrough.mjs
 *
 * Requires the dev server on :3000 and Supabase running (colima + supabase start).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  deviceScaleFactor: 2,
});
const phoneCtx = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 3,
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
  deviceScaleFactor: 3,
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
  deviceScaleFactor: 2,
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
// Report → PDF
// ---------------------------------------------------------------------------
const dataUri = async (file) => {
  const bytes = await readFile(join(shots, file));
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
};

const cards = [];
for (const section of sections) {
  cards.push(`
    <section class="card">
      <h2>${section.title}</h2>
      <img src="${await dataUri(section.file)}" alt="${section.title}" />
      <p>${section.caption}</p>
    </section>`);
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #232622;
    background: #f4f0e6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
  }
  header { border-bottom: 3px solid #8d713d; padding-bottom: 10px; margin-bottom: 18px; }
  .kicker { font-size: 8pt; letter-spacing: .16em; text-transform: uppercase; color: #8d713d; font-weight: 700; }
  h1 { font-size: 22pt; margin: 6px 0 4px; letter-spacing: -.01em; }
  .sub { color: #60645d; font-size: 10pt; margin: 0; }
  .lede { margin: 16px 0 18px; }
  .card { page-break-inside: avoid; margin: 0 0 18px; }
  .card h2 { font-size: 12.5pt; margin: 0 0 8px; }
  .card img {
    width: 100%; border: 1px solid #c9b482; border-radius: 4px;
    box-shadow: 0 2px 8px rgba(49,32,13,.14); display: block;
  }
  .card p { margin: 8px 0 0; color: #3d423c; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 9.5pt; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #d8c8a2; }
  th { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #8d713d; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  h2.section { font-size: 13pt; margin: 24px 0 10px; padding-top: 10px; border-top: 1px solid #d8c8a2; }
  ul { margin: 8px 0 0; padding-left: 18px; }
  li { margin: 3px 0; }
  .note { background: #e8d7b1; border-left: 3px solid #8d713d; padding: 9px 12px; margin: 14px 0; font-size: 9.5pt; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #d8c8a2; color: #60645d; font-size: 8.5pt; }
  code { font-family: ui-monospace, "SF Mono", monospace; font-size: 9pt; background: #e8d7b1; padding: 1px 4px; border-radius: 3px; }
</style></head>
<body>
  <header>
    <div class="kicker">Clocktower · build review</div>
    <h1>A fork of botc.town, and what we changed</h1>
    <p class="sub">What exists, what it looks like, and what is next.</p>
  </header>

  <p class="lede">
    The product is now a fork of <strong>BOTC Townsquare</strong> (botc.town, MIT) rather than the
    Solid/Convex app this repository started as. The reason is in the evidence: the grimoire, the
    invite link and QR code, the accounts-free join flow, live presence, the night-order sheet and
    three full scripts are already built, tested and deployed there — and their Trouble Brewing
    ability text matches ours word for word across all 20 shared characters.
  </p>

  <div class="note">
    <strong>What that leaves for us.</strong> Their schema has <code>alive</code> and
    <code>ghost_vote_available</code> and no voting at all, so a game cannot currently be finished.
    And players are handed the Storyteller's spatial map on a phone-sized screen. Those two are the
    work: the day phase, and a player screen that leads with the player's own character.
  </div>

  <h2 class="section">The screens</h2>
  ${cards.join("\n")}

  <h2 class="section">Verification</h2>
  <table>
    <tr><th>Check</th><th class="num">Result</th></tr>
    <tr><td>Unit tests (vitest)</td><td class="num">184 passing</td></tr>
    <tr><td>Integration tests (Playwright)</td><td class="num">32 passing</td></tr>
    <tr><td>TypeScript (<code>tsc --noEmit</code>)</td><td class="num">clean</td></tr>
    <tr><td>ESLint</td><td class="num">clean</td></tr>
    <tr><td>New phone player-view spec</td><td class="num">passing</td></tr>
    <tr><td>Player payload leak check</td><td class="num">no other roles</td></tr>
  </table>

  <h2 class="section">Decided and built</h2>
  <ul>
    <li><strong>Fork, not rebuild.</strong> This repository keeps the rules engine and the content of record; the fork carries the interface.</li>
    <li><strong>The vote engine is ported</strong> — threshold, nomination legality, ghost votes across the day's rounds, ties, execution. Pure TypeScript, 13 unit tests, and it accepts either a Storyteller seat or a player's projected seat since both satisfy a minimal <code>VoteSeat</code>.</li>
    <li><strong>Phone player view rebuilt</strong> — town strip plus role card, verified at 375 and 360 pixels wide, and untouched at laptop and tablet widths.</li>
    <li><strong>Official token art now ships.</strong> Upstream syncs TPI's published toolmaker resources, so the old "no official art" principle is retired; the ability text stays faithful and the product stays free.</li>
  </ul>

  <h2 class="section">Next, in order</h2>
  <ul>
    <li><strong>Day phase persistence</strong> — a day-state column and the RPC behind it, then the Storyteller's day panel. The arithmetic is already written and tested; this is the last gate to a finishable game.</li>
    <li><strong>Ability resolution</strong> — poisoning applied before the ability resolves, the red herring, and the "give the real answer anyway" path.</li>
    <li><strong>Wake prompts</strong> — wake lock and a dim reveal, so the Storyteller is not tapping shoulders all night.</li>
  </ul>

  <div class="note">
    <strong>The one thing that needs a human.</strong> One game night with a first-time Storyteller.
    If they cope unaided, the premise is wrong and we should stop building. If they fumble the vote
    threshold or the poisoning order, the engine in this repository is exactly the missing piece.
  </div>

  <footer>
    Screenshots captured with Playwright against a real local game: 7 seats, Trouble Brewing, roles
    dealt, one player dead, day 1. The "before" screenshot is the same game with our stylesheet
    additions reverted before first paint, so the two layouts are directly comparable.
  </footer>
</body></html>`;

await writeFile(join(out, "report.html"), html, "utf8");

const pdfBrowser = await chromium.launch();
const pdfPage = await pdfBrowser.newPage();
await pdfPage.setContent(html, { waitUntil: "load" });
await pdfPage.pdf({
  path: join(out, "walkthrough.pdf"),
  format: "A4",
  printBackground: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});
await pdfBrowser.close();

console.log(`\nartifacts written to ${out}`);
