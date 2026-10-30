/* Hardcore Worlds: Death Toll — tombstone maker. Everything renders locally on a <canvas>; no data leaves the page. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const ART = "assets/art/";
  const MAX_TOTAL = 2376;
  const SIZES = { wide: [1200, 630], square: [1080, 1080] };
  const STONES = { cross: "Grave_Haunted_Woods", grave: "Grave", celtic: "Gravestone_Draynor_Manor" };
  const TREES = ["Dead_tree_large_1", "Dead_tree_Gravedigger", "Dead_tree_old", "Dead_tree_dark", "Dead_tree_big_2", "Dead_tree_small_1"];
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const C = { gold: "#ff981f", parch: "#e9dbb8", muted: "#a399ad", violet: "#c4b0ff", red: "#ff3b45" };

  /* ---------------- input sanitising ---------------- */
  // drop control and bidi-override characters, collapse whitespace, cap by code point (never splits an emoji)
  const clean = (s, max) => Array.from(String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, " ")
    .replace(/\s+/g, " ").trimStart()).slice(0, max).join("");
  const cleanName = s => clean(String(s ?? "").replace(/[ _]/g, " ").replace(/[^A-Za-z0-9 -]/g, ""), 12);
  const cleanTotal = s => {
    const d = String(s ?? "").replace(/\D/g, "").slice(0, 4);
    return d ? String(Math.min(MAX_TOTAL, parseInt(d, 10))) : "";
  };
  const cleanDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(Date.parse(s)) ? s : "";
  const autoStone = t => t >= 1800 ? "celtic" : t >= 500 ? "grave" : "cross";
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  /* ---------------- assets: art + fonts ---------------- */
  const img = src => new Promise(res => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
  const assets = { stones: {}, trees: [], office: null };
  // dead trees are pre-darkened once on a scratch canvas (ctx.filter isn't available everywhere)
  function shade(im, tint, amount) {
    if (!im) return null;
    const c = document.createElement("canvas");
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = "source-atop";
    x.globalAlpha = amount;
    x.fillStyle = tint;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  async function loadArt() {
    const [office, ...rest] = await Promise.all([
      img(ART + "Deaths_Office.webp"),
      ...Object.values(STONES).map(n => img(ART + n + ".webp")),
      ...TREES.map(n => img(ART + "trees/" + n + ".webp")),
    ]);
    assets.office = office;
    Object.keys(STONES).forEach((k, i) => { assets.stones[k] = rest[i]; });
    assets.trees = rest.slice(3).map(t => shade(t, "#0a0814", .5));
  }
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const faces = ["900 80px Cinzel", "700 40px Cinzel", "40px VT323", "20px Silkscreen"];
    // never wait forever on a slow font CDN: draw with fallbacks, then redraw when they land
    return Promise.race([
      Promise.all(faces.map(f => document.fonts.load(f).catch(() => null))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  }

  /* ---------------- drawing ---------------- */
  function sky(x, w, h) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0b0914"); g.addColorStop(.55, "#120f1d"); g.addColorStop(.86, "#151a10"); g.addColorStop(1, "#1c2611");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (assets.office) {          // Death's Office, faint, as the backdrop's violet haze
      const s = Math.max(w / assets.office.width, h / assets.office.height);
      x.globalAlpha = .16;
      x.drawImage(assets.office, (w - assets.office.width * s) / 2, (h - assets.office.height * s) * .35, assets.office.width * s, assets.office.height * s);
      x.globalAlpha = 1;
    }
    const v = x.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, "rgba(11,9,20,.55)"); v.addColorStop(.7, "rgba(11,9,20,.35)"); v.addColorStop(1, "rgba(13,18,8,.9)");
    x.fillStyle = v; x.fillRect(0, 0, w, h);
    // fixed star field so every export of the same stone looks identical
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      x.fillStyle = `rgba(233,219,184,${.15 + rnd() * .45})`;
      const sz = rnd() < .85 ? 2 : 3;
      x.fillRect(Math.round(rnd() * w), Math.round(rnd() * h * .55), sz, sz);
    }
  }
  function glow(x, cx, cy, r, a) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(139,92,246,${a})`); g.addColorStop(1, "rgba(139,92,246,0)");
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  function tree(x, i, cx, base, hgt, flip) {
    const t = assets.trees[i % assets.trees.length];
    if (!t) return;
    const w = t.width * hgt / t.height;
    x.save();
    x.globalAlpha = .9;
    x.translate(cx, base);
    if (flip) x.scale(-1, 1);
    x.drawImage(t, -w / 2, -hgt, w, hgt);
    x.restore();
  }
  function ground(x, w, h, top) {
    const g = x.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, "rgba(20,26,12,0)"); g.addColorStop(.35, "#141a0c"); g.addColorStop(1, "#0d1208");
    x.fillStyle = g; x.fillRect(0, top, w, h - top);
  }
  function stone(x, key, cx, base, hgt) {
    const im = assets.stones[key];
    // burial mound
    const m = x.createRadialGradient(cx, base, 0, cx, base, hgt * .42);
    m.addColorStop(0, "#3b5220"); m.addColorStop(.7, "#1e2b0f"); m.addColorStop(1, "rgba(30,43,15,0)");
    x.fillStyle = m;
    x.beginPath(); x.ellipse(cx, base, hgt * .42, hgt * .06, 0, 0, Math.PI * 2); x.fill();
    if (!im) return;
    const w = im.naturalWidth * hgt / im.naturalHeight;
    x.save();
    x.shadowColor = key === "celtic" ? "rgba(255,152,31,.45)" : "rgba(139,92,246,.5)";
    x.shadowBlur = hgt * .09;
    x.drawImage(im, cx - w / 2, base - hgt * .97, w, hgt);
    x.restore();
  }
  function text(x, s, cx, y, font, color, opts = {}) {
    x.font = font;
    x.textAlign = opts.align || "center";
    x.textBaseline = "alphabetic";
    if ("letterSpacing" in x) x.letterSpacing = opts.spacing || "0px";
    x.fillStyle = "#000";
    const sh = opts.shadow ?? 2;
    if (sh) x.fillText(s, cx + sh, y + sh);
    x.fillStyle = color;
    x.fillText(s, cx, y);
    if ("letterSpacing" in x) x.letterSpacing = "0px";
  }
  // largest font size (<= max) at which s fits in width
  function fit(x, s, family, max, min, width) {
    let size = max;
    for (; size > min; size -= 2) {
      x.font = family.replace("{}", size);
      if (x.measureText(s).width <= width) break;
    }
    return size;
  }
  function wrap(x, s, font, width, maxLines) {
    x.font = font;
    const words = s.split(" "), lines = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (x.measureText(t).width <= width || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    // a single word too long for the line gets hard-broken
    const out = [];
    for (let l of lines) {
      while (x.measureText(l).width > width && l.length > 1) {
        let n = l.length - 1;
        while (n > 1 && x.measureText(l.slice(0, n)).width > width) n--;
        out.push(l.slice(0, n)); l = l.slice(n);
      }
      out.push(l);
    }
    if (out.length > maxLines) {
      out.length = maxLines;
      let last = out[maxLines - 1];
      while (last && x.measureText(last + "…").width > width) last = last.slice(0, -1);
      out[maxLines - 1] = last + "…";
    }
    return out;
  }

  // builds the stacked inscription as a list of rows so it can be measured, then centred
  function inscription(x, d, width, k) {
    const rows = [];
    const name = d.name || "A Hardcore Ironman";
    rows.push({ h: 34 * k, draw: (cx, y) => text(x, "HERE LIES", cx, y, `${22 * k}px Silkscreen, monospace`, C.violet, { spacing: `${4 * k}px` }) });
    const ns = fit(x, name, `900 {}px Cinzel, Georgia, serif`, Math.round(92 * k), 30, width);
    rows.push({ h: ns * 1.12, draw: (cx, y) => text(x, name, cx, y, `900 ${ns}px Cinzel, Georgia, serif`, C.gold, { shadow: 4 * k }) });
    if (d.total) rows.push({ h: 46 * k, draw: (cx, y) => {
      x.font = `${44 * k}px VT323, monospace`;
      const a = "TOTAL LEVEL ", b = Number(d.total).toLocaleString("en-US");
      const wa = x.measureText(a).width, wb = x.measureText(b).width, left = cx - (wa + wb) / 2;
      text(x, a, left, y, x.font, C.parch, { align: "left" });
      text(x, b, left + wa, y, x.font, C.gold, { align: "left" });
    } });
    rows.push({ h: 26 * k, draw: (cx, y) => {
      const g = x.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
      g.addColorStop(0, "rgba(107,93,120,0)"); g.addColorStop(.5, "rgba(196,176,255,.7)"); g.addColorStop(1, "rgba(107,93,120,0)");
      x.fillStyle = g; x.fillRect(cx - width * .4, y - 12 * k, width * .8, 2);
    } });
    if (d.killer) {
      const killer = d.killer.toUpperCase();
      const ks = fit(x, killer, `700 {}px Cinzel, Georgia, serif`, Math.round(36 * k), 18, width);
      rows.push({ h: 28 * k, draw: (cx, y) => text(x, "SLAIN BY", cx, y, `${17 * k}px Silkscreen, monospace`, C.muted, { spacing: `${3 * k}px` }) });
      rows.push({ h: ks * 1.3, draw: (cx, y) => text(x, killer, cx, y, `700 ${ks}px Cinzel, Georgia, serif`, C.red) });
    }
    if (d.epitaph) {
      const ef = `italic ${30 * k}px Georgia, "Times New Roman", serif`;
      const lines = wrap(x, `“${d.epitaph}”`, ef, width, 3);
      rows.push({ h: 12 * k });
      for (const l of lines) rows.push({ h: 38 * k, draw: (cx, y) => text(x, l, cx, y, ef, "#d4c9e0") });
    }
    if (d.date) rows.push({ h: 48 * k, draw: (cx, y) => text(x, "FELL " + fmtDate(d.date), cx, y + 8 * k, `${34 * k}px VT323, monospace`, C.muted) });
    return rows;
  }
  function paintRows(rows, cx, top, bottom) {
    const total = rows.reduce((s, r) => s + r.h, 0);
    let y = top + Math.max(0, (bottom - top - total) / 2);
    for (const r of rows) { y += r.h; if (r.draw) r.draw(cx, y - r.h * .18); }
  }
  function credit(x, w, h, k, align) {
    const cx = align === "center" ? w / 2 : w - 28 * k;
    text(x, "deathtoll.gg · not affiliated with Jagex", cx, h - 22 * k, `${24 * k}px VT323, monospace`, C.muted, { align: align === "center" ? "center" : "right", shadow: 1 });
    text(x, "HARDCORE WORLDS · DEATH TOLL", align === "center" ? w / 2 : 30 * k, align === "center" ? 46 * k : 44 * k,
      `${15 * k}px Silkscreen, monospace`, C.violet, { align: align === "center" ? "center" : "left", spacing: `${3 * k}px`, shadow: 1 });
  }

  function render(canvas, fmt, d) {
    const [w, h] = SIZES[fmt];
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const x = canvas.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.clearRect(0, 0, w, h);
    sky(x, w, h);
    if (fmt === "wide") {
      const cx = 300, base = 568;
      glow(x, cx, 300, 300, .32);
      const shadeR = x.createRadialGradient(830, 320, 0, 830, 320, 420);
      shadeR.addColorStop(0, "rgba(7,6,11,.6)"); shadeR.addColorStop(1, "rgba(7,6,11,0)");
      x.fillStyle = shadeR; x.fillRect(410, 0, 790, h);
      glow(x, 830, 280, 380, .1);
      tree(x, 0, 60, 600, 330, false);
      tree(x, 3, 520, 596, 250, true);
      tree(x, 4, 1160, 604, 300, true);
      ground(x, w, h, 470);
      stone(x, d.stone, cx, base, d.stone === "grave" ? 360 : 420);
      paintRows(inscription(x, d, 600, 1), 830, 70, 560);
      credit(x, w, h, 1, "right");
    } else {
      const cx = w / 2, base = 470;
      glow(x, cx, 280, 340, .34);
      tree(x, 0, 150, 520, 380, false);
      tree(x, 4, 940, 520, 360, true);
      tree(x, 3, 330, 500, 230, false);
      tree(x, 1, 760, 500, 250, true);
      ground(x, w, h, 380);
      const band = x.createLinearGradient(0, 440, 0, 560);
      band.addColorStop(0, "rgba(11,9,14,0)"); band.addColorStop(1, "rgba(11,9,14,.6)");
      x.fillStyle = band;
      x.fillRect(0, 440, w, h - 440);
      stone(x, d.stone, cx, base, d.stone === "grave" ? 330 : 380);
      paintRows(inscription(x, d, 780, 1.06), cx, 500, 1010);
      credit(x, w, h, 1.1, "center");
    }
  }

  /* ---------------- page wiring ---------------- */
  const form = $("#form"), canvas = $("#stone"), status = $("#status");
  const F = { name: $("#f-name"), total: $("#f-total"), killer: $("#f-killer"), epitaph: $("#f-epitaph"), date: $("#f-date") };
  let fmt = "wide", stonePicked = false;

  function read() {
    const d = {
      name: cleanName(F.name.value).trim(),
      total: cleanTotal(F.total.value),
      killer: clean(F.killer.value, 40).trim(),
      epitaph: clean(F.epitaph.value, 90).trim(),
      date: cleanDate(F.date.value),
    };
    const picked = form.querySelector("input[name=stone]:checked");
    d.stone = picked && STONES[picked.value] ? picked.value : autoStone(+d.total || 0);
    return d;
  }
  function setStone(k) {
    const r = form.querySelector(`input[name=stone][value="${k}"]`);
    if (r) r.checked = true;
  }
  let queued = false;
  function draw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(canvas, fmt, read()); });
  }

  // keep the fields themselves within limits as people type or paste
  function enforce(el, fn) {
    el.addEventListener("input", () => {
      const v = fn(el.value);
      if (v !== el.value) el.value = v;
      if (el === F.total && !stonePicked) setStone(autoStone(+v || 0));
      if (el === F.epitaph) $("#ep-count").textContent = `${Array.from(v).length}/90`;
      draw();
    });
  }
  enforce(F.name, cleanName);
  enforce(F.total, cleanTotal);
  enforce(F.killer, v => clean(v, 40));
  enforce(F.epitaph, v => clean(v, 90));
  F.date.addEventListener("input", draw);
  F.date.addEventListener("change", draw);
  form.addEventListener("change", e => {
    if (e.target.name === "stone") { stonePicked = true; draw(); }
  });
  form.addEventListener("submit", e => e.preventDefault());

  document.querySelectorAll(".tsm-fmt .tab").forEach(b => b.addEventListener("click", () => {
    fmt = b.dataset.fmt;
    document.querySelectorAll(".tsm-fmt .tab").forEach(o => {
      o.classList.toggle("on", o === b);
      o.setAttribute("aria-pressed", String(o === b));
    });
    $(".tsm-preview").classList.toggle("square", fmt === "square");
    draw();
  }));

  async function download(which, btn) {
    btn.disabled = true;
    try {
      const c = document.createElement("canvas");
      const d = read();
      render(c, which, d);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("no image");
      const [w, h] = SIZES[which];
      const slug = (d.name || "tombstone").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tombstone";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `deathtoll-${slug}-${w}x${h}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      status.textContent = `Saved ${w}×${h} PNG.`;
    } catch (e) {
      status.textContent = "Couldn't make the image. Try again.";
    } finally {
      btn.disabled = false;
    }
  }
  $("#dl-wide").addEventListener("click", e => download("wide", e.currentTarget));
  $("#dl-square").addEventListener("click", e => download("square", e.currentTarget));

  // prefill: ?name=&total=&killer= (plus optional epitaph, date, stone) so graveyard and hiscore pages can link here
  const q = new URLSearchParams(location.search);
  F.name.value = cleanName(q.get("name")).trim();
  F.total.value = cleanTotal(q.get("total"));
  F.killer.value = clean(q.get("killer"), 40).trim();
  F.epitaph.value = clean(q.get("epitaph"), 90).trim();
  F.date.value = cleanDate(q.get("date")) || today();
  $("#ep-count").textContent = `${Array.from(F.epitaph.value).length}/90`;
  if (STONES[q.get("stone")]) { setStone(q.get("stone")); stonePicked = true; }
  else setStone(autoStone(+F.total.value || 0));

  render(canvas, fmt, read());
  Promise.all([loadArt(), loadFonts()]).then(() => {
    render(canvas, fmt, read());
    document.body.dataset.ready = "1";
    if (document.fonts) document.fonts.ready.then(draw);
  });
})();
