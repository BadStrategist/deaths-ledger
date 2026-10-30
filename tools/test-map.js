#!/usr/bin/env node
/* Phone-first checks for site/map.html, in headless Chromium via Playwright.

     node tools/test-map.js [screenshot-dir]

   Serves site/ locally and loads the death map at 360/390/412/768/1366 px wide, twice each:
   pre-launch (graveyard.json "waiting", so the labelled sample points show) and live, with a stub
   graveyard.json that exists only inside this test (served by a route, never written to disk).
   Fails on horizontal page scroll, text past the viewport or clipped by its box, text under 9px,
   console errors, tiles not loading, or a landmark landing off its spot.

   Environment knobs (for sandboxes that cannot reach every host):
     LEAFLET_DIR  folder holding leaflet.js, leaflet.css and leaflet-heat.js to serve in place of unpkg
     TILE_MIRROR  base URL of a mirror with the same {z}/{plane}_{x}_{y}.png layout to serve in place of
                  maps.runescape.wiki (e.g. https://raw.githubusercontent.com/mejrs/layers_osrs/master/mapsquares/-1)
   With neither set, every request goes to the real hosts. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../site");
const OUT = path.resolve(process.argv[2] || path.join(require("os").tmpdir(), "death-map-shots"));
const WIDTHS = [360, 390, 412, 768, 1366];
const LANDMARKS = [["Lumbridge castle", 3222, 3218], ["Varrock square", 3213, 3428], ["Edgeville bank", 3094, 3492]];
fs.mkdirSync(OUT, { recursive: true });

/* A live graveyard: deaths on the surface, in instances, and with no location at all. */
const now = Date.now();
const LIVE = {
  status: "live", min_total: 0, ranked_players: 5000, counts: { today: 9, all_time: 9 },
  deaths: [
    ["Stub Lumby One", 40, 3222, 3218, true], ["Stub Lumby Two", 55, 3230, 3230, true], ["Stub Lumby Three", 61, 3250, 3240, true],
    ["Stub Varrock", 300, 3213, 3428, true], ["Stub Edge", 900, 3094, 3492, true], ["Stub Upstairs", 120, 3208, 3220, true, 2],
    ["Stub Raids", 2000, 3300, 5200, false], ["Stub Inferno", 2100, 2270, 5340, false], ["Stub Nowhere", 700],
  ].map(([name, total, x, y, on_map, plane], i) => ({
    name, total, fate: i === 2 ? "reset" : "died", time: now - i * 600000, world: 500 + i,
    ...(x == null ? {} : { location: { x, y, plane: plane || 0, on_map } }),
  })),
};

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

const tileCache = path.join(require("os").tmpdir(), "death-map-tiles");
function mirrorTile(url) {
  const m = url.match(/\/tiles\/rendered\/0\/(-?\d+)\/(\d+_-?\d+_-?\d+)\.png/);
  if (!m) return null;
  const file = path.join(tileCache, `${m[1]}_${m[2]}.png`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(tileCache, { recursive: true });
    try { execFileSync("curl", ["-sSf", "-o", file, `${process.env.TILE_MIRROR}/${m[1]}/${m[2]}.png`]); }
    catch (e) { fs.writeFileSync(file, ""); }
  }
  const body = fs.readFileSync(file);
  return body.length ? body : null;
}

async function routes(ctx, mode) {
  await ctx.route("**/data/graveyard.json*", r => r.fulfill({ json: mode === "live" ? LIVE : { status: "waiting", deaths: [] } }));
  if (process.env.LEAFLET_DIR) {
    await ctx.route(/unpkg\.com\/leaflet/, r => r.fulfill({
      path: path.join(process.env.LEAFLET_DIR, path.basename(new URL(r.request().url()).pathname)),
      headers: { "access-control-allow-origin": "*" },
    }));
  }
  if (process.env.TILE_MIRROR) {
    await ctx.route(/maps\.runescape\.wiki/, r => {
      const body = mirrorTile(r.request().url());
      return body ? r.fulfill({ body, contentType: "image/png" }) : r.fulfill({ status: 404, body: "" });
    });
  }
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
    if (!t.textContent.trim() || seen.has(el) || el.closest(".leaflet-tile-pane, .leaflet-popup-pane, script, style")) continue;
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
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX + s.overflowY) && !a.matches(".leaflet-container") &&
          (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1)) {
        problems.push(`clipped by ${a.tagName.toLowerCase()}.${a.className}: ${label}`); break;
      }
    }
  }
  return problems;
}

async function landmarkCheck(page, tag) {
  const results = [];
  for (const [name, x, y] of LANDMARKS) {
    await page.evaluate(([x, y]) => new Promise(done => {
      const { map, toLatLng } = window.deathMap;
      map.once("moveend", () => done()); map.setView(toLatLng(x, y), 3, { animate: false });
    }), [x, y]);
    await page.waitForFunction(() => [...document.querySelectorAll(".leaflet-tile-pane img")].every(i => i.complete), null, { timeout: 30000 });
    const r = await page.evaluate(([x, y]) => {
      const { map, toLatLng } = window.deathMap;
      const pt = map.latLngToContainerPoint(toLatLng(x, y));
      const box = map.getContainer().getBoundingClientRect();
      const cx = box.left + pt.x, cy = box.top + pt.y;
      const img = [...document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded")].find(i => {
        const b = i.getBoundingClientRect(); return cx >= b.left && cx < b.right && cy >= b.top && cy < b.bottom;
      });
      if (!img) return { error: "no loaded tile under the landmark" };
      const [, z, px, tx, ty] = img.src.match(/\/(-?\d+)\/(\d+)_(-?\d+)_(-?\d+)\.png/).map(Number);
      const b = img.getBoundingClientRect(), s = 2 ** z;
      return {
        url: img.src.replace(/^.*\/versions\//, "…/"),
        tile: [tx, ty], want: [Math.floor((x + 0.5) * s / 256), Math.floor((y + 0.5) * s / 256)],
        at: [cx - b.left, cy - b.top], wantAt: [((x + 0.5) * s) % 256, 256 - (((y + 0.5) * s) % 256)], plane: px,
        clip: { x: Math.max(0, cx - 90), y: Math.max(0, cy - 70), width: 180, height: 140 }, cx, cy,
      };
    }, [x, y]);
    const ok = !r.error && r.plane === 0 && r.tile[0] === r.want[0] && r.tile[1] === r.want[1] &&
      Math.abs(r.at[0] - r.wantAt[0]) <= 1 && Math.abs(r.at[1] - r.wantAt[1]) <= 1;
    // Drop a crosshair on the exact spot so the screenshot shows where the code thinks the landmark is.
    await page.evaluate(([cx, cy]) => {
      const d = document.createElement("div"); d.className = "test-pin";
      d.style.cssText = `position:fixed;z-index:9999;left:${cx - 7}px;top:${cy - 7}px;width:14px;height:14px;border:2px solid #0ff;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none`;
      document.body.appendChild(d);
    }, [r.cx, r.cy]);
    const shot = path.join(OUT, `landmark-${name.toLowerCase().replace(/\W+/g, "-")}-${tag}.png`);
    await page.screenshot({ path: shot, clip: r.clip });
    await page.evaluate(() => document.querySelectorAll(".test-pin").forEach(e => e.remove()));
    results.push({ name, ok, ...r, shot });
  }
  return results;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/map.html`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  let failures = 0;
  const fail = msg => { failures++; console.log("  FAIL " + msg); };

  for (const mode of ["preview", "live"]) {
    for (const width of WIDTHS) {
      const phone = width < 1024;
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 780 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
      await routes(ctx, mode);
      const page = await ctx.newPage();
      const errors = [], tileErrors = [];
      page.on("console", m => {
        if (m.type() !== "error") return;
        (/maps\.runescape\.wiki/.test(m.location().url || "") ? tileErrors : errors).push(m.text());
      });
      page.on("pageerror", e => errors.push(String(e)));
      let tilesOk = 0;
      page.on("response", r => { if (/maps\.runescape\.wiki/.test(r.url()) && r.ok()) tilesOk++; });

      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.deathMap && document.querySelectorAll(".leaflet-tile-loaded").length > 3, null, { timeout: 30000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const tag = `${mode}-${width}`;
      console.log(`${tag}`);

      const problems = await page.evaluate(textAudit);
      problems.forEach(p => fail(p));
      errors.forEach(e => fail("console: " + e));
      if (tileErrors.length) console.log(`  note: ${tileErrors.length} tile 404s (the server skips empty tiles)`);
      const loadedTiles = await page.$$eval(".leaflet-tile-loaded", els => els.filter(i => i.naturalWidth === 256).length);
      if (loadedTiles < 4) fail(`only ${loadedTiles} tiles loaded`); else console.log(`  ok   ${loadedTiles} tiles on screen (${tilesOk} tile responses)`);

      const counts = await page.$$eval("#counts b", bs => bs.map(b => b.textContent));
      const regions = await page.$$eval("#regions tr", rs => rs.map(r => r.innerText.replace(/\s+/g, " ").trim()));
      const flag = await page.$eval("#flag", el => el.innerText);
      const badge = await page.$eval("#badge", el => !el.hidden);
      if (mode === "preview") {
        if (!/made up/i.test(flag) || !badge) fail("preview banner or map badge missing");
        else console.log("  ok   preview banner + badge shown");
      } else {
        if (flag || badge) fail("preview banner shown on live data");
        if (counts.join() !== "6,2,1,3") fail(`counts ${counts} (want 6,2,1,3)`);
        if (!/^1 Lumbridge/.test(regions[0]) || !/4$/.test(regions[0])) fail(`top region "${regions[0]}" (want Lumbridge, 4)`);
        else console.log(`  ok   counts ${counts}; top region "${regions[0]}"`);
      }
      await page.screenshot({ path: path.join(OUT, `page-${tag}.png`), fullPage: true });

      // Tap a marker: its popup must open with that death's name.
      const name = mode === "live" ? "Stub Edge" : "Pretend Banker";
      const where = await page.evaluate(() => {
        const { map, toLatLng } = window.deathMap; map.setView(toLatLng(3094, 3492), 2, { animate: false });
        const p = map.latLngToContainerPoint(toLatLng(3094, 3492)), b = map.getContainer().getBoundingClientRect();
        return { x: b.left + p.x + 3, y: b.top + p.y + 2 };
      });
      await page.waitForTimeout(250);
      if (phone) await page.touchscreen.tap(where.x, where.y); else await page.mouse.click(where.x, where.y);
      const popup = await page.waitForSelector(".leaflet-popup-content", { timeout: 3000 }).then(e => e.innerText()).catch(() => "");
      if (!popup.includes(name)) fail(`tapping the marker did not open its popup (got "${popup.slice(0, 40)}")`);
      else {
        console.log("  ok   marker popup: " + popup.replace(/\s+/g, " ").trim());
        const pp = await page.evaluate(textAudit);
        pp.forEach(p => fail("with popup open: " + p));
        await page.waitForTimeout(400);   // let the popup finish fading in
        await page.screenshot({ path: path.join(OUT, `popup-${tag}.png`) });
      }
      await page.evaluate(() => window.deathMap.map.closePopup());
      await page.waitForSelector(".leaflet-popup", { state: "detached" });

      for (const r of await landmarkCheck(page, tag)) {
        if (!r.ok) fail(`landmark ${r.name}: ${JSON.stringify(r)}`);
        else console.log(`  ok   ${r.name} -> ${r.url} at (${r.at.map(Math.round)}) in tile [${r.tile}]`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} problem(s). Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
