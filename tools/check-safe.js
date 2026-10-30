#!/usr/bin/env node
/* Checks site/safe.html at phone, tablet and desktop widths with Chromium.
   Usage: node tools/check-safe.js [outdir]   (serves site/ itself on a free port)
   Fails on: horizontal scroll, clipped text, text under 9px, console errors, broken search or chips. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "site");
const OUT = process.argv[2] || path.join(__dirname, "..", "tools", "out");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const WIDTHS = [360, 390, 412, 768, 1366];

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

async function layout(page) {
  return page.evaluate(() => {
    const bad = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) bad.push(`horizontal scroll: ${doc.scrollWidth} > ${doc.clientWidth}`);
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 9) bad.push(`text under 9px (${fs}px): ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && el.clientWidth > 0)
        bad.push(`clipped text: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > doc.clientWidth + 1 || r.left < -1)) bad.push(`off-screen: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}"`);
    }
    return bad;
  });
}

async function behaviour(page) {
  const bad = [];
  const count = () => page.$$eval("#list .verdict:not(.v-unlisted):not(.v-none)", els => els.length);
  const total = await count();
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "safety.json"), "utf8"));
  if (total !== json.entries.length) bad.push(`All shows ${total}, json has ${json.entries.length}`);

  for (const v of ["safe", "unsafe", "conditional"]) {
    await page.click(`#chips .tab[data-v="${v}"]`);
    const want = json.entries.filter(e => e.verdict === v).length;
    const got = await count();
    const cls = await page.$$eval("#list .verdict", (els, v) => els.every(e => e.classList.contains("v-" + v)), v);
    const pressed = await page.getAttribute(`#chips .tab[data-v="${v}"]`, "aria-pressed");
    if (got !== want || !cls || pressed !== "true") bad.push(`chip ${v}: ${got}/${want} shown, classes ok=${cls}, pressed=${pressed}`);
  }
  await page.click('#chips .tab[data-v="all"]');
  if (await count() !== total) bad.push("chip All does not restore the list");

  const cases = [["nmz", "Nightmare Zone", "UNSAFE"], ["castle", "Castle Wars", "SAFE"], ["koschei", "The Fremennik Trials (Koschei)", "IT DEPENDS"], ["jad", null, null], ["LMS", "Last Man Standing", "DISABLED"]];
  for (const [q, name, badge] of cases) {
    await page.fill("#q", q);
    const names = await page.$$eval("#list .verdict h3", els => els.map(e => e.textContent));
    if (name && !names.includes(name)) bad.push(`search "${q}" missing ${name}: ${names}`);
    if (badge) {
      const b = await page.$$eval("#list .verdict", (els, name) => { const e = els.find(x => x.querySelector("h3").textContent === name); return e && e.querySelector(".badge").textContent; }, name);
      if (b !== badge) bad.push(`search "${q}" badge ${b}, want ${badge}`);
    }
    if (q === "jad" && names.length < 2) bad.push(`search "jad" should show Fight Cave and the diary entry: ${names}`);
  }
  await page.fill("#q", "wintertodt");
  const fallback = await page.textContent("#list");
  if (!/Not on the safe list — treat as UNSAFE/.test(fallback) || !(await page.$("#list .v-unlisted a.src[href*='oldschool.runescape.wiki']")))
    bad.push("unlisted search lacks the UNSAFE fallback + source link");
  await page.click('#chips .tab[data-v="safe"]');
  await page.fill("#q", "inferno");
  if (!/different verdict/.test(await page.textContent("#list"))) bad.push("filtered-out match should say it has a different verdict");
  await page.click('#chips .tab[data-v="all"]');
  await page.fill("#q", "");
  return bad;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  for (const w of WIDTHS) {
    const mobile = w < 1000;
    const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|data\/graveyard\.json|404/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", e => errors.push(String(e)));
    page.on("requestfailed", r => { if (!/fonts\.(googleapis|gstatic)|data\/graveyard\.json/.test(r.url())) errors.push("request failed: " + r.url()); });
    await page.goto(`${base}/safe.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#list .verdict");
    const bad = [...await layout(page), ...await behaviour(page)];
    await page.screenshot({ path: path.join(OUT, `safe-${w}.png`), fullPage: true });
    await page.fill("#q", "wintertodt");
    bad.push(...await layout(page));
    await page.screenshot({ path: path.join(OUT, `safe-${w}-unlisted.png`) });
    bad.push(...errors.map(e => "console: " + e));
    console.log(`${w}px: ${bad.length ? "FAIL\n  " + bad.join("\n  ") : "ok"}`);
    failed += bad.length;
    await ctx.close();
  }
  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
})();
