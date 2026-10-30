#!/usr/bin/env node
/* Checks site/tombstone.html in headless Chromium (Playwright).
 *
 *   node tools/check_tombstone.js [outDir]
 *
 * Serves site/ locally, then at 360/390/412/768/1366 px: no horizontal scroll, no clipped text,
 * no text under 9px, no console errors. Fills the form, triggers both downloads and checks the
 * PNGs are 1200x630 / 1080x1080 and not blank. Downloads and screenshots go to outDir
 * (default: a temp dir). Exits non-zero on any failure.
 */
"use strict";
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "site");
const OUT = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "tombstone-")));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/tombstone.html`;
const WIDTHS = [360, 390, 412, 768, 1366];
const failures = [];
const fail = m => { failures.push(m); console.log("  FAIL " + m); };
const ok = m => console.log("  ok   " + m);

function serve() {
  const p = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  return new Promise(res => setTimeout(() => res(p), 700));
}

// layout audit run inside the page
function audit() {
  const vw = document.documentElement.clientWidth;
  const out = { scroll: document.documentElement.scrollWidth - vw, small: [], clipped: [], offscreen: [] };
  const desc = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) ||
      ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && (el.value || el.placeholder));
    if (!ownText) continue;
    if (parseFloat(cs.fontSize) < 9) out.small.push(`${desc(el)} ${cs.fontSize}`);
    if (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT" && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible")
      out.clipped.push(`${desc(el)} ${el.scrollWidth}>${el.clientWidth}`);
    if (r.left < -1 || r.right > vw + 1) out.offscreen.push(`${desc(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    // text wider than its own box (e.g. a nowrap label overflowing a button)
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      if (tr.width && (tr.left < r.left - 1 || tr.right > r.right + 1) && cs.overflowX !== "visible")
        out.clipped.push(`${desc(el)} text ${Math.round(tr.width)}>${Math.round(r.width)}`);
    }
  }
  return out;
}

// decode a PNG in the page and sample it
async function inspectPng(page, file) {
  const b64 = fs.readFileSync(file).toString("base64");
  return page.evaluate(async src => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
    const c = document.createElement("canvas");
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let bright = 0, n = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3);
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (l > 140) bright++;
      if (d[i + 3] === 255) opaque++;
      n++;
    }
    return { w: c.width, h: c.height, colors: colors.size, brightShare: bright / n, opaqueShare: opaque / n };
  }, "data:image/png;base64," + b64);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of WIDTHS) {
      const mobile = width <= 768;
      console.log(`\n${width}px${mobile ? " (mobile, touch)" : ""}`);
      const ctx = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", e => errors.push(String(e)));
      page.on("requestfailed", r => errors.push("request failed: " + r.url()));
      await page.goto(BASE + "?name=Lynx%20Titan&total=2277&killer=Jad", { waitUntil: "networkidle" });
      await page.waitForSelector("body[data-ready='1']", { timeout: 15000 });

      for (const fmt of ["wide", "square"]) {
        await page.click(`.tsm-fmt [data-fmt=${fmt}]`);
        await page.waitForTimeout(100);
        const a = await page.evaluate(audit);
        a.scroll > 0 ? fail(`${width}/${fmt}: horizontal scroll ${a.scroll}px`) : ok(`${fmt}: no horizontal scroll`);
        a.small.length ? fail(`${width}/${fmt}: text under 9px: ${a.small.join(", ")}`) : ok(`${fmt}: no text under 9px`);
        a.clipped.length ? fail(`${width}/${fmt}: clipped: ${a.clipped.join(", ")}`) : ok(`${fmt}: nothing clipped`);
        a.offscreen.length ? fail(`${width}/${fmt}: off-screen: ${a.offscreen.join(", ")}`) : ok(`${fmt}: all text on screen`);
        await page.screenshot({ path: path.join(OUT, `page-${width}-${fmt}.png`), fullPage: true });
      }
      // tap targets on touch screens
      if (mobile) {
        const tiny = await page.evaluate(() => [...document.querySelectorAll("main button, main input:not([type=radio]), main textarea, .stones label")]
          .map(el => [el.id || el.textContent.trim().slice(0, 20), el.getBoundingClientRect().height]).filter(([, h]) => h < 40));
        tiny.length ? fail(`${width}: small tap targets: ${JSON.stringify(tiny)}`) : ok("tap targets ≥ 40px");
      }
      errors.length ? fail(`${width}: console errors: ${errors.join(" | ")}`) : ok("no console errors");
      await ctx.close();
    }

    console.log("\nprefill + sanitising");
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const evil = "?name=" + encodeURIComponent("<b>Zezima</b>_toolongname") + "&total=99999&killer=" + encodeURIComponent("a‮Goblin\u0007" + "x".repeat(80)) + "&stone=nope&date=2026-13-45";
      await page.goto(BASE + evil, { waitUntil: "networkidle" });
      await page.waitForSelector("body[data-ready='1']");
      const v = await page.evaluate(() => {
        const val = id => document.querySelector(id).value;
        return { name: val("#f-name"), total: val("#f-total"), killer: val("#f-killer"), date: val("#f-date"),
          stone: document.querySelector("input[name=stone]:checked").value };
      });
      console.log("  " + JSON.stringify(v));
      v.name.length <= 12 && !/[<>]/.test(v.name) ? ok("name stripped + capped") : fail("name not sanitised: " + v.name);
      v.total === "2376" ? ok("total clamped to 2376") : fail("total not clamped: " + v.total);
      Array.from(v.killer).length <= 40 && !/[‮\u0007]/.test(v.killer) ? ok("killer stripped + capped") : fail("killer not sanitised: " + v.killer);
      /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? ok("bad date replaced") : fail("date: " + v.date);
      v.stone === "celtic" ? ok("stone auto-picked from total") : fail("stone: " + v.stone);
      await ctx.close();
    }

    console.log("\nfill form + downloads");
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector("body[data-ready='1']");
      await page.fill("#f-name", "Iron Wizzy");
      await page.fill("#f-total", "1432");
      const auto = await page.$eval("input[name=stone]:checked", e => e.value);
      auto === "grave" ? ok("1432 total → grave") : fail("1432 total picked " + auto);
      await page.fill("#f-killer", "a level 2 dark wizard");
      await page.fill("#f-epitaph", "Went AFK for one second. The escape crystal was in the bank. Tell my clan I tried.");
      await page.fill("#f-date", "2026-11-05");
      await page.check("input[name=stone][value=celtic]", { force: true });
      await page.fill("#f-total", "120");
      const kept = await page.$eval("input[name=stone]:checked", e => e.value);
      kept === "celtic" ? ok("manual stone choice survives total edits") : fail("manual stone overwritten → " + kept);
      await page.waitForTimeout(150);
      for (const [btn, w, h] of [["#dl-wide", 1200, 630], ["#dl-square", 1080, 1080]]) {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.tap(btn)]);
        const file = path.join(OUT, dl.suggestedFilename());
        await dl.saveAs(file);
        const s = await inspectPng(page, file);
        console.log(`  ${path.basename(file)} ${JSON.stringify(s)}`);
        s.w === w && s.h === h ? ok(`${btn} is ${w}x${h}`) : fail(`${btn} is ${s.w}x${s.h}, want ${w}x${h}`);
        s.colors > 200 && s.brightShare > 0.004 && s.opaqueShare > 0.99 ? ok(`${btn} not blank (${s.colors} colours)`) : fail(`${btn} looks blank: ${JSON.stringify(s)}`);
      }
      errors.length ? fail("page errors: " + errors.join(" | ")) : ok("no page errors");
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\noutput: ${OUT}`);
  if (failures.length) { console.log(`${failures.length} failure(s)`); process.exit(1); }
  console.log("all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
