#!/usr/bin/env node
/* Layout + behaviour check for site/ge.html.
   Usage: node tools/ge_check.js [--route osrs] [--shots DIR] [--real-api]

   Copies site/ to a temp dir, writes a stub data/watcher.json ({"price_route": null} unless --route),
   serves it with `python3 -m http.server`, and drives Chromium (isMobile/hasTouch) at 360/390/412/768/1366 px.

   By default the OSRS Wiki price API is answered by a generated MOCK (fake items and prices, test-only, never shipped)
   so the check runs offline. Pass --real-api to hit prices.runescape.wiki for real. */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const ROUTE = opt("--route");
const SHOTS = opt("--shots");
const REAL = args.includes("--real-api");
const PORT = 8000 + Math.floor(Math.random() * 900);
const WIDTHS = [360, 390, 412, 768, 1366];

/* ---------- mock API (deterministic) ---------- */
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function mock() {
  const r = rng(7);
  const items = [{ id: 4151, name: "Abyssal whip", examine: "A weapon from the abyss.", members: true, limit: 70, value: 120001, highalch: 72000, lowalch: 48000, icon: "Abyssal whip.png" },
    { id: 4153, name: "Granite maul", examine: "Simplicity is the best weapon.", members: true, limit: 70, value: 50000, highalch: 30000, icon: "Granite maul.png" },
    { id: 12006, name: "Abyssal tentacle", examine: "A weapon from the abyss, embedded in a slimy tentacle.", members: true, limit: 70, value: 1, highalch: 0, icon: "Abyssal tentacle.png" },
    { id: 554, name: "Fire rune", examine: "One of the 4 basic elemental Runes.", members: false, limit: 25000, value: 5, highalch: 3, icon: "Fire rune.png" }];
  const words = ["Rune", "Dragon", "Adamant", "Mithril", "Oak", "Yew", "Magic", "Shark", "Karambwan", "Bronze", "Death", "Blood", "Twisted", "Ancestral"];
  const kinds = ["platebody", "scimitar", "logs", "bones", "arrow", "dart", "potion(4)", "seed", "boots", "longsword with an extremely long name for wrapping"];
  let id = 20000;
  for (const w of words) for (const k of kinds) items.push({ id: id++, name: `${w} ${k}`, examine: "Mock item.", members: r() > .3, limit: Math.ceil(r() * 10000), value: 100, highalch: Math.round(r() * 5e4), icon: `${w} ${k}.png` });
  const base = {}, latest = {}, h1 = {}, h0 = {}, h24 = {}, vol = {};
  const now = Math.floor(Date.now() / 1000), hour = Math.floor(now / 3600) * 3600 - 3600;
  for (const it of items) {
    const p = it.id === 4151 ? 1650000 : it.id === 554 ? 5 : Math.round(Math.exp(r() * 18));
    base[it.id] = p;
    latest[it.id] = { high: Math.round(p * 1.01), highTime: now - Math.round(r() * 600), low: Math.round(p * .99), lowTime: now - Math.round(r() * 900) };
    const v = Math.round(r() * 4000) + 20;
    const bucket = f => ({ avgHighPrice: Math.round(p * f * 1.01), highPriceVolume: v, avgLowPrice: Math.round(p * f * .99), lowPriceVolume: v });
    h1[it.id] = bucket(1); h0[it.id] = bucket(1 + (r() - .5) * .2); h24[it.id] = bucket(1 + (r() - .5) * .5);
    vol[it.id] = v * 30;
  }
  const series = (id, step) => {
    const sec = { "5m": 300, "1h": 3600, "6h": 21600, "24h": 86400 }[step], p = base[id] || 1000, out = [];
    let f = 1;
    for (let i = 364; i >= 0; i--) {
      f *= 1 + (r() - .5) * .02;
      const gap = r() < .04;
      out.push({ timestamp: Math.floor(now / sec) * sec - i * sec, avgHighPrice: gap ? null : Math.round(p * f * 1.01), avgLowPrice: gap ? null : Math.round(p * f * .99), highPriceVolume: gap ? 0 : Math.round(r() * 300), lowPriceVolume: gap ? 0 : Math.round(r() * 300) });
    }
    return { data: out, itemId: id };
  };
  return (url) => {
    const u = new URL(url), p = u.pathname.split("/").slice(4).join("/");
    if (p === "mapping") return items;
    if (p === "latest") return { data: latest };
    if (p === "volumes") return { timestamp: now * 1000, data: vol };
    if (p === "1h") {
      const ts = +u.searchParams.get("timestamp");
      return { data: !ts ? h1 : ts === hour - 3600 ? h0 : h24, timestamp: ts || hour };
    }
    if (p === "timeseries") return series(+u.searchParams.get("id"), u.searchParams.get("timestep"));
    return null;
  };
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/* ---------- checks ---------- */
async function audit(page) {
  return page.evaluate(() => {
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`horizontal scroll: ${de.scrollWidth} > ${de.clientWidth}`);
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || !el.offsetParent && cs.position !== "fixed") continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 9) out.push(`text under 9px (${fs}px): ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 && !el.closest("svg")) out.push(`off-screen text: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" right=${Math.round(r.right)}`);
      // clipped: content wider than the box with overflow hidden, unless it is a deliberate ellipsis
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible" && cs.textOverflow !== "ellipsis" && el.tagName !== "TEXTAREA")
        out.push(`clipped text: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
    }
    for (const t of document.querySelectorAll("svg text")) {
      const fs = parseFloat(getComputedStyle(t).fontSize);
      if (fs < 9) out.push(`svg text under 9px: ${t.textContent}`);
      const b = t.getBBox(), s = t.ownerSVGElement.viewBox.baseVal;
      if (b.x < -1 || b.x + b.width > s.width + 1) out.push(`svg label clipped: "${t.textContent}"`);
    }
    return out;
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ge-site-"));
  fs.cpSync(path.join(__dirname, "..", "site"), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "watcher.json"), JSON.stringify({ price_route: ROUTE || null }));
  if (!fs.existsSync(path.join(dir, "data", "graveyard.json"))) fs.writeFileSync(path.join(dir, "data", "graveyard.json"), JSON.stringify({ status: "waiting" }));
  const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const answer = mock();
  const browser = await chromium.launch();
  const fails = [];
  const base = `http://127.0.0.1:${PORT}/ge.html`;
  console.log(`price_route=${JSON.stringify(ROUTE || null)} · API: ${REAL ? "REAL prices.runescape.wiki" : "MOCK (fake data, test only)"}`);
  try {
    for (const w of WIDTHS) {
      const mobile = w < 1000;
      const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const errs = [];
      const page = await ctx.newPage();
      page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
      page.on("pageerror", e => errs.push("pageerror: " + e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await page.route(/oldschool\.runescape\.wiki\/images\//, r => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      if (!REAL) await page.route(/prices\.runescape\.wiki\/api\/v1\//, r => {
        const body = answer(r.request().url());
        return body ? r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) }) : r.fulfill({ status: 404, body: "" });
      });
      const step = async (label, fn) => {
        try { await fn(); } catch (e) { fails.push(`${w}px ${label}: ${e.message.split("\n")[0]}`); }
        for (const p of await audit(page)) fails.push(`${w}px ${label}: ${p}`);
      };
      const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `ge-${ROUTE ? "live" : "preview"}-${w}-${n}.png`), fullPage: n !== "search" }); } };

      await step("load", async () => {
        await page.goto(base);
        await page.waitForSelector("#traded tbody a[data-item]", { timeout: 15000 });
        await page.waitForSelector("#movers tbody a[data-item]", { timeout: 15000 });
        const badge = await page.textContent("#badge");
        if (badge !== (ROUTE ? "LIVE" : "PREVIEW")) throw new Error(`badge says ${badge}`);
        const flag = await page.$(".preview-flag");
        if (!ROUTE && !flag) throw new Error("preview banner missing");
        if (ROUTE && flag) throw new Error("preview banner shown on a live feed");
        const sp = await page.$$("#traded th.sp");
        if (!!ROUTE !== (sp.length > 0)) throw new Error(`spread column ${sp.length ? "shown" : "missing"}`);
      });
      await shot("home");
      await step("search", async () => {
        await page.fill("#q", "Abyssal whip");
        await page.waitForSelector("#hits li[data-id='4151']");
        const first = await page.getAttribute("#hits li:first-child", "data-id");
        if (first !== "4151") throw new Error("Abyssal whip is not the top hit");
      });
      await shot("search");
      await step("open item", async () => {
        await page.click("#hits li[data-id='4151']");
        await page.waitForSelector("#gchart path", { state: "attached" });
        if (!page.url().includes("?id=4151")) throw new Error("URL not updated: " + page.url());
        if (!(await page.textContent(".ge-name h3")).includes("Abyssal whip")) throw new Error("wrong item");
      });
      for (const r of ["7d", "30d", "24h"]) {
        await step(`range ${r}`, async () => {
          await page.click(`#crange [data-r='${r}']`);
          await page.waitForFunction(r => document.querySelector(`#crange [data-r='${r}']`).classList.contains("on") && document.querySelector("#gchart path"), r);
        });
      }
      await step("chart readout", async () => {
        await page.locator("#gchart").scrollIntoViewIfNeeded();
        const b = await page.locator("#gchart").boundingBox();
        if (mobile) await page.touchscreen.tap(b.x + b.width * .6, b.y + b.height / 2);
        else await page.mouse.move(b.x + b.width * .6, b.y + b.height / 2);
        await page.waitForFunction(() => /traded/.test(document.querySelector("#read").textContent));
      });
      await shot("item");
      await step("movers tabs", async () => {
        await page.click("#mrange [data-w='24h']");
        await page.click("#mdir [data-d='down']");
        await page.waitForFunction(() => document.querySelector("#movers tbody td.down"));
      });
      await step("deep link", async () => {
        await page.goto(base + "?id=554");
        try { await page.waitForSelector("#gchart path", { state: "attached", timeout: 8000 }); }
        catch (e) { throw new Error("chart missing: " + await page.evaluate(() => document.querySelector("#gchart").innerHTML.slice(0, 300) + " URL " + location.href)); }
        if (!(await page.textContent(".ge-name h3")).includes("Fire rune")) throw new Error("deep link opened the wrong item");
      });
      await step("bad id", async () => {
        await page.goto(base + "?id=999999");
        await page.waitForSelector("#item .empty");
      });
      for (const e of errs) fails.push(`${w}px console: ${e}`);
      await ctx.close();
    }
    // API down: friendly message, no crash.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const pageErrs = [];
    page.on("pageerror", e => pageErrs.push(e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route(/prices\.runescape\.wiki/, r => r.fulfill({ status: 503, body: "" }));
    await page.goto(base);
    try { await page.waitForSelector(".ge-error", { timeout: 8000 }); } catch (e) { fails.push("api-down: no friendly error"); }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `ge-${ROUTE ? "live" : "preview"}-error.png`) });
    for (const e of pageErrs) fails.push("api-down pageerror: " + e);
    await ctx.close();
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }
  console.log(`PASS · widths ${WIDTHS.join(", ")} · search, open, ranges, readout, movers, deep link, bad id, API down`);
})();
