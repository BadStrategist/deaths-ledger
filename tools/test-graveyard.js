#!/usr/bin/env node
/* Phone-first checks for site/graveyard.html and the homepage "Latest graves" strip, in headless Chromium.

     node tools/test-graveyard.js [screenshot-dir]

   Serves site/ locally and loads index.html and graveyard.html at 360/390/412/768/1366 px wide in three data states:
     preview  graveyard.json "waiting", so the labelled sample graves show
     live     a stub with ~3,000 deaths over the last 30 hours
     quiet    a stub that is live but has no deaths in the last 24 hours
   The stubs exist only inside this test (served by a route, never written to disk).
   Fails on horizontal page scroll, text past the viewport or clipped by its box, text under 9px, console errors
   (the Cloudflare beacon is ignored on localhost), missing SAMPLE tags, or controls that do not work. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../site");
const OUT = path.resolve(process.argv[2] || path.join(require("os").tmpdir(), "graveyard-shots"));
const WIDTHS = [360, 390, 412, 768, 1366];
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- stub data ---------------- */
const NOW = Date.now(), HOUR = 3600000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const SKILLS = ["Attack", "Strength", "Defence", "Ranged", "Magic", "Slayer", "Fishing", "Mining", "Agility", "Thieving"];
const SPOTS = [[3222, 3218, true], [3213, 3428, true], [3094, 3492, true], [2860, 9840, true], [3300, 5200, false], [2270, 5340, false]];
const FATES = ["died", "died", "died", "died", "died", "died", "reset", "banished", "fallen"];
function stub(n, fromH, toH) {
  const deaths = [];
  for (let i = 0; i < n; i++) {
    const total = Math.round(32 + Math.pow(rnd(), 1.6) * 2200);
    const time = i === 0 && fromH === 0 ? NOW - 3 * HOUR : NOW - (fromH + rnd() * (toH - fromH)) * HOUR;
    const spot = rnd() < 0.8 ? SPOTS[Math.floor(rnd() * SPOTS.length)] : null;
    const name = (i === 0 ? "Stub Biggest" : i === 1 ? "Xx Long Name" : "Stub " + i).slice(0, 12);
    const fate = FATES[Math.floor(rnd() * FATES.length)];
    deaths.push({
      name, total: i === 0 ? 2277 : total, combat: Math.min(126, 3 + Math.round(total / 18)), fate, run: 1 + Math.floor(rnd() * 3),
      time: Math.round(time), time_exact: fate !== "reset",
      top_skills: [[SKILLS[i % 10], Math.min(99, 10 + Math.round(total / 24))], [SKILLS[(i + 3) % 10], 40]],
      top_boss: total > 1200 ? ["Vorkath", 1 + (i % 90)] : null, world: 500 + (i % 30), notable: total >= 1800, tracked: false,
      ...(spot ? { location: { x: spot[0], y: spot[1], plane: 0, on_map: spot[2] } } : {}),
      ...(!spot && i % 3 === 0 ? { location_text: "The Wilderness" } : {}),
      ...(i % 97 === 5 ? { player_killer: "Some Pker" } : {}),
    });
  }
  deaths.sort((a, b) => b.time - a.time);
  const byHour = {};
  deaths.forEach(d => { const h = Math.floor(d.time / HOUR); byHour[h] = (byHour[h] || 0) + 1; });
  const worst = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
  return {
    status: "live", min_total: 32, ranked_players: 48210, last_full_scan: new Date(NOW - 9 * 60000).toISOString(),
    counts: {
      today: deaths.filter(d => d.time >= NOW - 24 * HOUR).length, all_time: deaths.length,
      resets: deaths.filter(d => d.fate === "reset").length, highest_total: Math.max(...deaths.map(d => d.total)),
      deadliest_hour: worst ? { start: new Date(worst[0] * HOUR).toISOString(), deaths: worst[1] } : null,
    },
    deaths,
  };
}
const DATA = { preview: { status: "waiting", deaths: [] }, live: stub(3000, 0, 30), quiet: stub(40, 30, 60) };

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

async function routes(ctx, mode) {
  await ctx.route("**/data/graveyard.json*", r => r.fulfill({ json: DATA[mode] }));
  await ctx.route("**/data/population.json*", r => r.fulfill({ json: { hardcore_worlds_listed: false, all_worlds_total: 123456, history: [] } }));
  await ctx.route("**/data/watcher.json*", r => r.fulfill({ json: { hiscore_mode: mode === "preview" ? null : "hardcore_worlds" } }));
  await ctx.route("**/data/firsts.json*", r => r.fulfill({ json: { status: mode === "preview" ? "waiting" : "live", total_categories: 105, firsts: {} } }));
  await ctx.route(/cloudflareinsights\.com/, r => r.fulfill({ body: "", contentType: "text/javascript" }));
}

/* Every visible text box: on screen, not clipped by its own box or an overflow:hidden ancestor, 9px or larger. */
function textAudit() {
  const problems = [], W = window.innerWidth;
  const doc = document.documentElement;
  if (doc.scrollWidth > W) problems.push(`page scrolls sideways: ${doc.scrollWidth} > ${W}`);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode, el = t.parentElement;
    if (!t.textContent.trim() || seen.has(el) || el.closest("script, style")) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || !el.getClientRects().length) continue;
    const label = `<${el.tagName.toLowerCase()} class="${el.className}"> "${t.textContent.trim().slice(0, 30)}"`;
    if (parseFloat(cs.fontSize) < 9) problems.push(`font ${cs.fontSize}: ${label}`);
    const range = document.createRange(); range.selectNodeContents(t);
    for (const r of range.getClientRects()) {
      if (r.width && (r.right > W + 0.5 || r.left < -0.5)) { problems.push(`off screen (${Math.round(r.left)}..${Math.round(r.right)}): ${label}`); break; }
    }
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX + s.overflowY) && !a.matches(".hero, .treeline, .wf-feature, .wf-chips span, .count") &&
          (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1)) {
        problems.push(`clipped by ${a.tagName.toLowerCase()}.${a.className}: ${label}`); break;
      }
    }
  }
  return problems;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  let failures = 0;
  const fail = msg => { failures++; console.log("  FAIL " + msg); };
  const ok = msg => console.log("  ok   " + msg);
  const expect = (cond, msg) => (cond ? ok(msg) : fail(msg));

  for (const mode of ["preview", "live", "quiet"]) {
    for (const width of WIDTHS) {
      const phone = width < 1024;
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 780 : 900 }, isMobile: phone, hasTouch: phone,
        deviceScaleFactor: phone ? 2 : 1, timezoneId: "America/New_York", locale: "en-US" });
      await routes(ctx, mode);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", m => { if (m.type() === "error" && !/cloudflareinsights|beacon/.test(m.text() + (m.location().url || ""))) errors.push(m.text()); });
      page.on("pageerror", e => errors.push(String(e)));
      const tap = async sel => (phone ? page.locator(sel).first().tap() : page.locator(sel).first().click());

      /* ---- homepage ---- */
      const tag = `${mode}-${width}`;
      console.log(`index ${tag}`);
      await page.goto(base + "index.html", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      (await page.evaluate(textAudit)).forEach(p => fail(p));
      const home = await page.evaluate(() => ({
        stones: document.querySelectorAll("#latest-rows .stone").length,
        samples: document.querySelectorAll("#latest-rows .stone .tag.sample").length,
        order: [...document.querySelectorAll("#main > *")].map(e => e.id || e.className).filter(Boolean).join(" > "),
        navOn: [...document.querySelectorAll("#top a.on")].map(a => a.textContent),
        navHref: (document.querySelector('#top .nav a') || {}).getAttribute?.("href"),
        old: !!document.querySelector("#rows, #ledger, #filters, #deadliest"),
      }));
      expect(home.stones === (mode === "quiet" ? 6 : 6), `latest strip shows ${home.stones} graves`);
      expect(mode === "preview" ? home.samples === home.stones : home.samples === 0, `SAMPLE tags on ${home.samples}/${home.stones} strip graves`);
      expect(/track.*wf-feature.*latest.*explore/.test(home.order), `order: ${home.order}`);
      expect(!home.navOn.length, `no nav item highlighted on home (${home.navOn.join(",") || "none"})`);
      expect(home.navHref === "graveyard.html", `nav Graveyard -> ${home.navHref}`);
      expect(!home.old, "old graveyard and full ledger gone from the homepage");
      if (width === 390 || width === 1366) await page.screenshot({ path: path.join(OUT, `index-${tag}.png`), fullPage: true });
      await tap("a.enter");
      await page.waitForURL(/graveyard\.html$/);
      ok("Enter the graveyard -> graveyard.html");

      /* ---- graveyard page ---- */
      console.log(`graveyard ${tag}`);
      const t0 = Date.now();
      await page.waitForSelector("#feed .stone, #feed .empty");
      const ms = Date.now() - t0;
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      (await page.evaluate(textAudit)).forEach(p => fail(p));
      const g = () => page.evaluate(() => ({
        stones: document.querySelectorAll("#feed .stone").length,
        samples: document.querySelectorAll("#feed .stone .tag.sample").length,
        heads: [...document.querySelectorAll(".hour-h")].map(h => h.innerText.replace(/\s+/g, " ").trim()),
        empty: (document.querySelector("#feed .empty h3") || {}).textContent || "",
        more: !document.getElementById("gy-more").hidden,
        summary: document.getElementById("gy-summary").hidden ? "" : document.getElementById("gy-summary").innerText.replace(/\s+/g, " "),
        preview: !document.getElementById("preview").hidden,
        navOn: [...document.querySelectorAll("#top .nav a.on")].map(a => a.textContent),
        totals: [...document.querySelectorAll("#feed .stone-lvl > b")].map(b => +b.textContent.replace(/,/g, "")),
        names: [...document.querySelectorAll("#feed .stone-name")].map(n => n.textContent),
        listing: document.getElementById("listing").innerText,
      }));
      let s = await g();
      console.log(`       first paint ${ms} ms, ${s.stones} cards; summary: ${s.summary || "(hidden)"}`);
      console.log(`       listing: ${s.listing}`);
      if (s.heads[0]) console.log(`       first group: ${s.heads[0]}`);
      expect(width < 1001 || s.navOn.join() === "Graveyard", `nav highlight: ${s.navOn.join() || "(menu)"}`);
      expect(s.heads.every(h => /Death claimed [\d,]+ (life|lives)\b/.test(h) && !/graves/i.test(h)), `${s.heads.length} hour headers read "Death claimed N lives"`);
      expect(s.heads.every(h => !/Death claimed 1 lives|Death claimed (?!1 )[\d,]+ life\b/.test(h)), "life/lives agrees with N");
      if (mode === "preview") {
        expect(s.preview && s.samples === s.stones && s.stones > 0, `preview banner + SAMPLE on ${s.samples}/${s.stones} cards`);
        expect(/^SAMPLE/.test(s.summary), "summary tagged SAMPLE");
      } else {
        expect(!s.preview && s.samples === 0, "no preview banner or SAMPLE tags on live data");
      }
      if (mode === "quiet") {
        expect(s.empty === "No one has fallen today. Yet.", `empty Today: "${s.empty}"`);
      }
      if (width === 390 || width === 1366) await page.screenshot({ path: path.join(OUT, `graveyard-${tag}.png`), fullPage: mode !== "live" });
      if (mode === "live") {
        expect(s.stones === 150 && s.more, `first page renders ${s.stones} cards with Show older`);
        expect(/Death claimed [\d,]+ lives today/.test(s.summary) && /Biggest loss: Stub Biggest \(2,277\)/.test(s.summary) && /Deadliest hour:/.test(s.summary), "summary has all three pieces");
        await tap("#gy-more");
        s = await g();
        expect(s.stones === 300, `Show older -> ${s.stones} cards`);
      }

      // time tabs
      await tap('#gy-range [data-v="all"]');
      s = await g();
      const allCount = s.stones;
      expect(allCount > 0 && !s.empty, `All time -> ${allCount} cards`);
      await tap('#gy-range [data-v="week"]');
      s = await g();
      expect(s.stones === allCount, `This week -> ${s.stones} cards`);
      // total level select
      await page.selectOption("#gy-level", "2000");
      s = await g();
      expect(s.totals.length > 0 && s.totals.every(t => t >= 2000), `2,000+ -> ${s.totals.length} cards, all 2,000+`);
      await page.selectOption("#gy-level", "0");
      // search
      const want = mode === "preview" ? "Mock Mage" : "Stub Biggest";
      await tap("#gy-search");
      await page.fill("#gy-search", want.slice(0, 6).toLowerCase());
      s = await g();
      expect(s.names.length > 0 && s.names.every(n => n.toLowerCase().includes(want.slice(0, 6).toLowerCase())), `search "${want.slice(0, 6)}" -> ${s.names.length} cards`);
      await page.fill("#gy-search", "zzzz no one");
      s = await g();
      expect(s.empty === "No graves match", `search with no match: "${s.empty}"`);
      await page.fill("#gy-search", "");
      (await page.evaluate(textAudit)).forEach(p => fail("after tapping: " + p));
      errors.forEach(e => fail("console: " + e));
      await ctx.close();
    }
  }
  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} problem(s). Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
