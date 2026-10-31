// Phone + desktop check of site/hiscores.html in three data states. Run: node tools/test-hiscores.js [screenshot-dir]
// Serves site/ itself and answers /data/* from a per-state fixture, so nothing is written to site/data.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const SITE = path.join(__dirname, "..", "site");
const SHOTS = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };

function liveStub() {
  const now = Date.now();
  const overall = Array.from({ length: 100 }, (_, i) => ({
    rank: i + 1, name: i === 3 ? "Wwwwwwwwwwww" : `Stub Player ${i + 1}`, total: 2277 - i * 3, xp: 4600000000 - i * 9e6,
    dead: i % 7 === 1, died_at: i % 7 === 1 ? new Date(now - i * 600e3).toISOString() : null,
  }));
  return { status: "live", updated: new Date(now - 300e3).toISOString(), mode: "hiscore_oldschool_hardcore_worlds", overall, notes: "Test stub, not real data." };
}

const STATES = {
  "no-data": {},
  "waiting": { "hiscores.json": { status: "waiting", updated: new Date().toISOString(), mode: null, overall: [], notes: null } },
  "live": { "hiscores.json": liveStub() },
};
let current = STATES["no-data"];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.startsWith("/data/")) {
    const body = current[p.slice(6)];
    if (!body) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(body));
  }
  const file = path.join(SITE, p === "/" ? "index.html" : p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const fontCache = new Map();
function font(req) {
  const url = req.url();
  if (!fontCache.has(url)) {
    let body = Buffer.alloc(0);
    try { body = execFileSync("curl", ["-sSf", "-A", req.headers()["user-agent"] || "Mozilla/5.0", url], { maxBuffer: 1 << 24 }); } catch (e) { /* offline */ }
    fontCache.set(url, body);
  }
  return { status: 200, contentType: url.includes("googleapis") ? "text/css" : "font/woff2", body: fontCache.get(url) };
}

const WIDTHS = [360, 390, 412, 768, 1366];

async function audit(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    const scrollers = [...document.querySelectorAll(".hs-skills")];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 9) out.push(`text under 9px (${fs}px): ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      const r = el.getBoundingClientRect();
      if (!scrollers.some(s => s.contains(el)) && (r.right > vw + 0.5 || r.left < -0.5)) out.push(`off-screen text: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible" && cs.overflowX !== "auto")
        out.push(`clipped text: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
    }
    for (const td of document.querySelectorAll(".hs-table td, .hs-table th"))
      if (getComputedStyle(td).display !== "none" && td.scrollWidth > td.clientWidth + 1) out.push(`cell overflows: "${td.textContent.trim().slice(0, 30)}"`);
    for (const a of document.querySelectorAll(".nav a"))
      if (a.scrollWidth > a.clientWidth + 1) out.push(`nav link clipped: ${a.textContent}`);
    return out;
  });
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failures = 0;
  for (const [name, files] of Object.entries(STATES)) {
    current = files;
    for (const w of WIDTHS) {
      const mobile = w < 768;
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      // Fonts come from Google: fetch them with curl (honours the shell's proxy); fall back to system fonts offline.
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill(font(r.request())));
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push("pageerror: " + e.message));
      page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push("console: " + m.text()); });
      page.on("requestfailed", r => errors.push("request failed: " + r.url()));
      await page.goto(`${base}/hiscores.html`, { waitUntil: "networkidle" });
      await page.waitForSelector("#rows tr");

      const facts = await page.evaluate(() => ({
        preview: !!document.querySelector(".preview-flag"),
        tabs: !document.querySelector("#skills").hidden,
        rows: document.querySelectorAll("#rows tr").length,
        tiles: document.querySelector("#tiles").innerText.replace(/\s+/g, " "),
      }));
      const problems = await audit(page);
      if (name === "live") {
        if (facts.preview) problems.push("live data still shows the preview banner");
        if (facts.tabs) problems.push("skill tabs shown although live stub has no skills");
        if (facts.rows !== 100) problems.push(`expected 100 rows, got ${facts.rows}`);
      } else {
        if (!facts.preview) problems.push("missing preview banner");
        if (!facts.tabs) problems.push("sample has skills but no tabs");
      }

      // interactions: search, then a skill tab (re-audit each)
      await page.fill("#search", "zzzz-no-match");
      if ((await page.textContent("#rows")).indexOf("matches") < 0) problems.push("search with no match shows no message");
      await page.fill("#search", "");
      if (facts.tabs) {
        await page.click("#skills [data-b='Slayer']");
        if ((await page.textContent("#head")).indexOf("LEVEL") < 0) problems.push("skill tab did not switch the table");
        problems.push(...(await audit(page)).map(p => "[Slayer] " + p));
        if (SHOTS && w === 390) await page.screenshot({ path: path.join(SHOTS, `${name}-${w}-slayer.png`), fullPage: true });
        await page.click("#skills [data-b='Overall']");
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: true });

      problems.push(...errors);
      failures += problems.length;
      console.log(`${problems.length ? "FAIL" : "ok  "} ${name.padEnd(8)} ${String(w).padStart(4)}px  rows=${facts.rows} tabs=${facts.tabs} | ${facts.tiles}`);
      for (const p of [...new Set(problems)]) console.log("      - " + p);
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
})();
