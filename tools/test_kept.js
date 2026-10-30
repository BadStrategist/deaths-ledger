#!/usr/bin/env node
/* Checks site/kept.html in headless Chromium:
 *   - phone/tablet/desktop layout: no horizontal scroll, no clipped text, no text under 9px, no console errors
 *   - an end-to-end loadout of 5 known items, checked against the Items Kept on Death rules
 *   - Hardcore price route, and the price API being down
 * The price API, fonts and item icons are stubbed, so the test runs offline and the prices are fixed.
 *
 *   node tools/test_kept.js [--shots DIR]
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const SITE = path.join(__dirname, "..", "site");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// Five known items with fixed test prices (gp each).
const ITEMS = [
  { id: 20997, name: "Twisted bow", icon: "Twisted bow.png", price: 1200000000 },
  { id: 6585, name: "Amulet of fury", icon: "Amulet of fury.png", price: 2500000 },
  { id: 4151, name: "Abyssal whip", icon: "Abyssal whip.png", price: 1500000 },
  { id: 385, name: "Shark", icon: "Shark.png", price: 900 },
  { id: 560, name: "Death rune", icon: "Death rune.png", price: 200 },
  { id: 1127, name: "Rune platebody", icon: "Rune platebody.png", price: 38000 },
];
const MAPPING = ITEMS.map(i => ({ id: i.id, name: i.name, icon: i.icon, examine: "", members: true, value: 1, lowalch: 1, highalch: 1, limit: 8 }));
const LATEST = { data: Object.fromEntries(ITEMS.map(i => [i.id, { high: i.price, highTime: 1, low: i.price, lowTime: 1 }])) };
const PNG = fs.readFileSync(path.join(SITE, "assets/art/skull.png"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const f = path.join(SITE, p === "/" ? "index.html" : p);
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}

async function stub(page, { route = null, pricesDown = false, seen = [] } = {}) {
  await page.route("**/data/watcher.json*", r => r.fulfill({ json: { price_route: route } }));
  await page.route("**/data/graveyard.json*", r => r.fulfill({ json: { status: "waiting" } }));
  await page.route("https://fonts.googleapis.com/**", r => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://oldschool.runescape.wiki/images/**", r => r.fulfill({ body: PNG, contentType: "image/png" }));
  await page.route("https://prices.runescape.wiki/**", r => {
    const u = r.request().url();
    seen.push(u);
    if (pricesDown) return r.fulfill({ status: 503, body: "down" });
    if (u.endsWith("/mapping")) return r.fulfill({ json: MAPPING, headers: { "access-control-allow-origin": "*" } });
    if (u.endsWith("/latest")) return r.fulfill({ json: LATEST, headers: { "access-control-allow-origin": "*" } });
    return r.fulfill({ status: 404 });
  });
}

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

async function addItem(page, name, to, qty) {
  await page.click(`.seg [data-to=${to}]`);
  await page.fill("#q", name.slice(0, 6));
  await page.click(`#results button:has-text("${name}")`);
  if (qty > 1) {
    const input = page.locator(`#${to} li:has-text("${name}") input`);
    await input.fill(String(qty));
    await input.press("Tab");
  }
}

const listOf = (page, sel) => page.$$eval(`${sel} li:not(.none)`, lis => lis.map(li => {
  const nm = li.querySelector(".nm");
  const name = nm.childNodes[0].textContent.trim();
  const x = nm.querySelector(".x");
  return `${name}×${x ? Number(x.textContent.replace(/[^0-9]/g, "")) : 1}`;
}));

async function layoutAudit(page) {
  return page.evaluate(() => {
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`horizontal scroll: ${de.scrollWidth} > ${de.clientWidth}`);
    const W = de.clientWidth;
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest(".sr")) continue;
      const label = `${el.tagName.toLowerCase()}.${el.className || ""} "${el.textContent.trim().slice(0, 30)}"`;
      if (parseFloat(cs.fontSize) < 9) out.push(`text under 9px (${cs.fontSize}): ${label}`);
      if (r.left < -1 || r.right > W + 1) out.push(`off-screen x ${Math.round(r.left)}..${Math.round(r.right)}: ${label}`);
      if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 && el.tagName !== "INPUT") out.push(`clipped text: ${label}`);
    }
    return out;
  });
}

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}/kept.html`;
  const browser = await chromium.launch();

  // ---------------- end-to-end: 5 items vs the wiki rules ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));
    const seen = [];
    await stub(page, { seen });
    await page.goto(BASE);
    await page.waitForSelector("#q:not([disabled])");
    ok(seen.some(u => u.includes("/api/v1/osrs/latest")), "no Hardcore route: fetches /api/v1/osrs prices");
    ok((await page.textContent("#price-label")).includes("main-game GE prices"), "labels main-game prices");

    await addItem(page, "Twisted bow", "eq", 1);
    await addItem(page, "Amulet of fury", "eq", 1);
    await addItem(page, "Abyssal whip", "inv", 1);
    await addItem(page, "Shark", "inv", 10);
    await addItem(page, "Death rune", "inv", 1000);

    const cases = [
      { protect: false, skull: false, n: 3, kept: ["Twisted bow×1", "Amulet of fury×1", "Abyssal whip×1"], lost: ["Shark×10", "Death rune×1000"], risk: 10 * 900 + 1000 * 200 },
      { protect: true, skull: false, n: 4, kept: ["Twisted bow×1", "Amulet of fury×1", "Abyssal whip×1", "Shark×1"], lost: ["Shark×9", "Death rune×1000"], risk: 9 * 900 + 1000 * 200 },
      { protect: false, skull: true, n: 0, kept: [], lost: ["Twisted bow×1", "Amulet of fury×1", "Abyssal whip×1", "Shark×10", "Death rune×1000"], risk: 1200000000 + 2500000 + 1500000 + 9000 + 200000 },
      { protect: true, skull: true, n: 1, kept: ["Twisted bow×1"], lost: ["Amulet of fury×1", "Abyssal whip×1", "Shark×10", "Death rune×1000"], risk: 2500000 + 1500000 + 9000 + 200000 },
    ];
    for (const c of cases) {
      const isOn = async id => (await page.getAttribute(id, "aria-pressed")) === "true";
      if ((await isOn("#t-protect")) !== c.protect) await page.click("#t-protect");
      if ((await isOn("#t-skull")) !== c.skull) await page.click("#t-skull");
      const tag = `protect=${c.protect} skull=${c.skull}`;
      const kept = await listOf(page, "#kept"), lost = await listOf(page, "#lost");
      ok(Number(await page.textContent("#v-n")) === c.n, `${tag}: keeps ${c.n} items`);
      ok(JSON.stringify(kept) === JSON.stringify(c.kept), `${tag}: KEPT ${JSON.stringify(kept)}`);
      ok(JSON.stringify(lost) === JSON.stringify(c.lost), `${tag}: LOST ${JSON.stringify(lost)}`);
      const riskText = await page.textContent("#v-risk + span");
      const shown = c.risk >= 1e5 ? Number(riskText.split("·").pop().replace(/[^0-9]/g, "")) : Number((await page.textContent("#v-risk")).replace(/[^0-9]/g, ""));
      ok(shown === c.risk, `${tag}: GP at risk ${shown.toLocaleString("en-US")} (expected ${c.risk.toLocaleString("en-US")})`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `e2e-390-${c.protect ? "protect" : "noprot"}-${c.skull ? "skull" : "noskull"}.png`), fullPage: true });
    }
    // loadout survives a reload (localStorage)
    await page.reload();
    await page.waitForSelector("#q:not([disabled])");
    ok((await page.$$("#inv li[data-id]")).length === 3 && (await page.$$("#eq li[data-id]")).length === 2, "loadout restored after reload");
    ok(errors.length === 0, `no console errors in e2e${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
  }

  // ---------------- layout at each width (loaded with the 5-item loadout) ----------------
  const seed = JSON.stringify({ inv: [{ id: 4151, qty: 1 }, { id: 385, qty: 10 }, { id: 560, qty: 1000 }, { id: 1127, qty: 1 }], eq: [{ id: 20997, qty: 1 }, { id: 6585, qty: 1 }], protect: true, skull: false });
  for (const w of [360, 390, 412, 768, 1366]) {
    const mobile = w < 1000;
    const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await ctx.addInitScript(s => { try { if (!localStorage.getItem("kept.v1")) localStorage.setItem("kept.v1", s); } catch (e) {} }, seed);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));
    await stub(page);
    await page.goto(BASE);
    await page.waitForSelector("#q:not([disabled])");
    await page.fill("#q", "ab");   // open the results list too
    await page.waitForTimeout(150);
    const issues = await layoutAudit(page);
    ok(issues.length === 0, `${w}px layout${issues.length ? ":\n      " + issues.join("\n      ") : ""}`);
    ok(errors.length === 0, `${w}px no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `layout-${w}.png`), fullPage: true });
    await ctx.close();
  }

  // ---------------- Hardcore route set ----------------
  {
    const page = await browser.newPage();
    const seen = [];
    await stub(page, { route: "hardcore", seen });
    await page.goto(BASE);
    await page.waitForSelector("#q:not([disabled])");
    ok(seen.some(u => u.includes("/api/v1/hardcore/latest")) && !seen.some(u => u.includes("/api/v1/osrs/")), "Hardcore route set: uses /api/v1/hardcore only");
    ok((await page.textContent("#price-label")).includes("Hardcore Worlds GE prices"), "labels Hardcore prices");
    await page.close();
  }

  // ---------------- price API down ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e)));
    await stub(page, { pricesDown: true });
    await page.goto(BASE);
    await page.waitForSelector("#price-state.err");
    ok((await page.textContent("#price-state")).includes("PRICES UNAVAILABLE"), "API down: shows a clear message");
    ok(await page.isDisabled("#q"), "API down: search disabled, not broken");
    ok(pageErrors.length === 0, `API down: no script errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);
    const issues = await layoutAudit(page);
    ok(issues.length === 0, `API down layout at 360px${issues.length ? ": " + issues.join("; ") : ""}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "api-down-360.png"), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
