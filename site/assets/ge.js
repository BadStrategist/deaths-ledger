/* Hardcore Worlds: Death Toll — GE tracker. Reads the OSRS Wiki real-time prices API straight from the browser.
   data/watcher.json → price_route picks the feed: set = Hardcore Worlds prices (LIVE); null = main-game prices, labelled PREVIEW. */
(function () {
  "use strict";
  const API = "https://prices.runescape.wiki/api/v1/";
  const MAIN = "osrs";
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function short(n) {
    if (n == null) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
    return fmt(Math.round(n));
  }
  const pct = (v, dp = 1) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(dp) + "%";
  const cls = v => v == null || !isFinite(v) || Math.abs(v) < 5e-4 ? "" : v > 0 ? "up" : "down";
  function ago(sec) {
    const s = Math.max(0, Date.now() / 1000 - sec);
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 129600) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = ms => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  const icon = it => it && it.icon ? `https://oldschool.runescape.wiki/images/${encodeURIComponent(it.icon.replace(/ /g, "_"))}` : "";
  const img = it => icon(it) ? `<img class="ge-ic" src="${icon(it)}" alt="" loading="lazy" width="24" height="24" onerror="this.style.visibility='hidden'">` : `<span class="ge-ic"></span>`;
  // GE tax: 2% of the sell price, rounded down, capped at 5M; sales under 50 gp pay none.
  const tax = p => p < 50 ? 0 : Math.min(Math.floor(p * 0.02), 5e6);

  /* ---------------- fetching ---------------- */
  const cache = {};
  function api(route, path) {
    const key = route + "/" + path;
    if (!cache[key]) {
      cache[key] = fetch(API + key, { headers: { Accept: "application/json" } }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      cache[key].catch(() => delete cache[key]);   // let a retry try again
    }
    return cache[key];
  }
  async function watcher() {
    try {
      const r = await fetch(`data/watcher.json?t=${Math.floor(Date.now() / 60000)}`);
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function graveyard() {
    try {
      const r = await fetch(`data/graveyard.json?t=${Math.floor(Date.now() / 60000)}`);
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  /* ---------------- shared header (same markup as chrome() in app.js) ---------------- */
  const NAV = [["index.html", "graveyard", "Graveyard"], ["population.html", "population", "Population"], ["ge.html", "ge", "GE tracker"], ["watcher.html", "watcher", "Data watcher"]];
  function chrome(gy) {
    const fallen = gy && gy.status === "live" && gy.counts ? gy.counts.all_time : 0;
    $("#top").innerHTML = `
      <img class="hg pix" src="assets/art/hourglass.png" width="13" height="31" alt="">
      <a class="brand" href="index.html"><small>HARDCORE WORLDS</small><b>Death Toll</b></a>
      <nav class="nav" aria-label="Main">${NAV.map(([href, id, label]) =>
        `<a href="${href}"${id === "ge" ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
      <div class="count" title="Deaths recorded from the Hardcore Worlds hiscores"><img class="pix" src="assets/art/skull.png" width="25" height="25" alt="">${fmt(fallen)} fallen</div>`;
  }

  /* ---------------- state ---------------- */
  const S = {
    route: MAIN, live: false,
    items: [], byId: new Map(), latest: {}, main: null, vol: null, hour: null,
    sel: null, range: "24h", mwin: "1h", mdir: "up",
  };
  const mid = (p) => p && p.high && p.low ? (p.high + p.low) / 2 : p ? (p.high || p.low || null) : null;
  // Spread vs the main game: only exists when we are reading a separate Hardcore Worlds feed.
  const spread = id => {
    if (!S.main) return null;
    const a = mid(S.latest[id]), b = mid(S.main[id]);
    return a && b ? a / b - 1 : null;
  };

  function friendly(where, e, retry) {
    const el = $("#err");
    el.innerHTML = `<div class="ge-error" role="alert"><b>THE GE CLERK IS BUSY</b>
      Couldn't reach the OSRS Wiki price feed (${esc(where)}: ${esc(e && e.message || "network error")}). Prices will be back shortly.
      <button class="tab" type="button">Try again</button></div>`;
    $("button", el).addEventListener("click", () => { el.innerHTML = ""; retry(); });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const [w, gy] = await Promise.all([watcher(), graveyard()]);
    chrome(gy);
    S.route = w && w.price_route ? String(w.price_route) : MAIN;
    S.live = !!(w && w.price_route);
    const badge = $("#badge");
    badge.hidden = false;
    badge.textContent = S.live ? "LIVE" : "PREVIEW";
    badge.className = "ge-badge " + (S.live ? "live" : "preview");
    if (!S.live) {
      $("#flag").innerHTML = `<div class="preview-flag" role="note"><b>PREVIEW · these are MAIN-GAME prices.</b> Hardcore Worlds has its own economy; its prices replace these automatically when the OSRS Wiki publishes a Hardcore Worlds price feed.</div>`;
    } else {
      $("#flag").innerHTML = `<p class="note">Showing <b>Hardcore Worlds</b> prices (feed <b>/${esc(S.route)}</b>). The <b>VS MAIN</b> column compares each item with the main game.</p>`;
    }
    wire();
    await loadCore();
  }

  async function loadCore() {
    try {
      const [mapping, latest, hour] = await Promise.all([api(S.route, "mapping"), api(S.route, "latest"), api(S.route, "1h")]);
      S.items = mapping.filter(it => it && it.name);
      S.byId = new Map(S.items.map(it => [it.id, it]));
      S.latest = latest.data || {};
      S.hour = hour;
    } catch (e) {
      friendly("prices", e, loadCore);
      for (const t of ["#movers", "#traded"]) body($(t), `<tr><td class="note">Prices unavailable right now.</td></tr>`);
      return;
    }
    // Optional extras: the page still works without them.
    const extras = [api(S.route, "volumes").then(v => { S.vol = v.data || null; }).catch(() => { S.vol = null; })];
    if (S.live) extras.push(api(MAIN, "latest").then(m => { S.main = m.data || null; }).catch(() => { S.main = null; }));
    await Promise.all(extras);
    S.items.forEach(it => { it._n = it.name.toLowerCase(); it._v = S.vol ? S.vol[it.id] || 0 : 0; });
    const q = $("#q");
    q.disabled = false;
    drawMovers();
    drawTraded();
    fromUrl();
  }

  /* ---------------- search ---------------- */
  let hits = [], hi = -1;
  function search(text) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const it of S.items) {
      const i = it._n.indexOf(q);
      if (i < 0) continue;
      const rank = it._n === q ? 0 : i === 0 ? 1 : it._n[i - 1] === " " || it._n[i - 1] === "(" ? 2 : 3;
      out.push([rank, -it._v, it._n.length, it]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return out.slice(0, 8).map(r => r[3]);
  }
  function showHits() {
    const ul = $("#hits"), q = $("#q");
    ul.hidden = !hits.length && !q.value.trim();
    q.setAttribute("aria-expanded", String(!ul.hidden));
    ul.innerHTML = hits.length ? hits.map((it, i) => {
      const p = S.latest[it.id];
      return `<li role="option" id="hit-${i}" data-id="${it.id}"${i === hi ? ' aria-selected="true" class="on"' : ""}>${img(it)}<span class="nm">${esc(it.name)}</span><span class="pr">${p ? short(p.high || p.low) : "—"}</span></li>`;
    }).join("") : `<li class="none">No item called that.</li>`;
    if (hi >= 0) q.setAttribute("aria-activedescendant", "hit-" + hi); else q.removeAttribute("aria-activedescendant");
  }
  function closeHits() { hits = []; hi = -1; $("#hits").hidden = true; $("#q").setAttribute("aria-expanded", "false"); }

  /* ---------------- wiring ---------------- */
  function wire() {
    const q = $("#q");
    q.addEventListener("input", () => { hits = search(q.value); hi = hits.length ? 0 : -1; showHits(); });
    q.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!hits.length) return;
        e.preventDefault();
        hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
        showHits();
      } else if (e.key === "Enter") {
        if (hits[hi]) { e.preventDefault(); pick(hits[hi].id); }
      } else if (e.key === "Escape") closeHits();
    });
    q.addEventListener("focus", () => { if (q.value.trim()) { hits = search(q.value); showHits(); } });
    $("#hits").addEventListener("mousedown", e => e.preventDefault());   // keep focus so the click lands
    $("#hits").addEventListener("click", e => { const li = e.target.closest("[data-id]"); if (li) pick(+li.dataset.id); });
    document.addEventListener("click", e => { if (!e.target.closest(".ge-search")) closeHits(); });

    // Item links in the tables are real deep links; open them in place.
    $("#main").addEventListener("click", e => {
      const a = e.target.closest("a[data-item]");
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      e.preventDefault();
      pick(+a.dataset.item);
    });
    $("#mrange").addEventListener("click", e => { const b = e.target.closest("[data-w]"); if (b) { S.mwin = b.dataset.w; drawMovers(); } });
    $("#mdir").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (b) { S.mdir = b.dataset.d; drawMovers(); } });
    window.addEventListener("popstate", fromUrl);
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S.series) drawChart(); }, 150); });
  }

  function fromUrl() {
    const id = +new URLSearchParams(location.search).get("id");
    if (id && S.byId.has(id)) open(id, false);
    else if (!id) { S.sel = null; $("#item").hidden = true; }
    else { $("#item").hidden = false; $("#item").innerHTML = `<div class="empty"><h3>No such item</h3><p>Nothing on the Grand Exchange has id ${esc(id)}.</p></div>`; }
  }
  function pick(id) {
    closeHits();
    $("#q").value = "";
    open(id, true);
    $("#item").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ---------------- item panel ---------------- */
  function open(id, push) {
    const it = S.byId.get(id);
    if (!it) return;
    S.sel = id;
    if (push && +new URLSearchParams(location.search).get("id") !== id) history.pushState({ id }, "", `?id=${id}`);
    document.title = `${it.name} · GE tracker · Hardcore Worlds: Death Toll`;
    const p = S.latest[id] || {};
    const h = (S.hour && S.hour.data && S.hour.data[id]) || {};
    const margin = p.high && p.low ? p.high - p.low : null;
    const net = p.high && p.low ? p.high - tax(p.high) - p.low : null;
    const vol = S.vol ? S.vol[id] : null;
    const sp = spread(id);
    const tile = (label, value, sub = "", c = "") => `<div><span>${label}</span><b class="${c}">${value}</b>${sub ? `<i>${sub}</i>` : ""}</div>`;
    const el = $("#item");
    el.hidden = false;
    el.innerHTML = `
      <div class="ge-head">
        ${icon(it) ? `<img class="ge-big pix" src="${icon(it)}" alt="" width="36" height="32" onerror="this.style.visibility='hidden'">` : ""}
        <div class="ge-name"><h3>${esc(it.name)}</h3><p>${esc(it.examine || "")}</p></div>
        <span class="tag ${it.members ? "gold" : "grey"}">${it.members ? "MEMBERS" : "F2P"}</span>
        <button class="tab ge-share" type="button" title="Copy a link to this item">Copy link</button>
      </div>
      <div class="ge-tiles">
        ${tile("INSTANT BUY (HIGH)", p.high ? fmt(p.high) : "—", p.highTime ? ago(p.highTime) : "no trades", "y")}
        ${tile("INSTANT SELL (LOW)", p.low ? fmt(p.low) : "—", p.lowTime ? ago(p.lowTime) : "no trades", "c")}
        ${tile("MARGIN", margin == null ? "—" : fmt(margin), net == null ? "" : `${fmt(net)} after 2% tax`, margin > 0 ? "up" : "")}
        ${tile("BUY LIMIT", it.limit ? fmt(it.limit) : "—", "per 4 hours")}
        ${tile("24H VOLUME", vol == null ? "—" : fmt(vol), "items traded")}
        ${tile("LAST HOUR", h.avgHighPrice || h.avgLowPrice ? short(mid({ high: h.avgHighPrice, low: h.avgLowPrice })) : "—", `${fmt((h.highPriceVolume || 0) + (h.lowPriceVolume || 0))} traded`)}
        ${S.main ? tile("VS MAIN GAME", pct(sp), S.main[id] ? `main: ${short(mid(S.main[id]))}` : "not on main GE", cls(sp)) : ""}
        ${tile("HIGH ALCH", it.highalch ? fmt(it.highalch) : "—", it.highalch && p.low ? `${fmt(it.highalch - p.low)} vs buying` : "")}
      </div>
      <div class="chart-wrap">
        <div class="ge-bar">
          <div class="range" id="crange"><button class="tab" data-r="24h">24h</button><button class="tab" data-r="7d">7 days</button><button class="tab" data-r="30d">30 days</button></div>
          <div class="ge-key"><span class="k y"></span>BUY <span class="k c"></span>SELL <span class="k v"></span>VOLUME</div>
        </div>
        <div class="ge-read" id="read" aria-live="polite">&nbsp;</div>
        <svg class="chart ge-chart" id="gchart" viewBox="0 0 800 280" preserveAspectRatio="none" role="img" aria-label="Price history for ${esc(it.name)}"></svg>
      </div>`;
    $("#crange", el).addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) { S.range = b.dataset.r; loadChart(); } });
    $(".ge-share", el).addEventListener("click", async e => {
      const url = `${location.origin}${location.pathname}?id=${id}`;
      try { await navigator.clipboard.writeText(url); e.target.textContent = "Copied!"; }
      catch (x) { e.target.textContent = "Link in address bar"; }
      setTimeout(() => { e.target.textContent = "Copy link"; }, 1800);
    });
    const svg = $("#gchart", el);
    svg.addEventListener("pointermove", hover);
    svg.addEventListener("pointerdown", hover);
    svg.addEventListener("pointerleave", e => { if (e.pointerType !== "mouse") return; $("#read").innerHTML = "&nbsp;"; const g = $("#cross"); if (g) g.remove(); });
    loadChart();
  }

  /* ---------------- chart ---------------- */
  const RANGES = { "24h": ["5m", 864e5], "7d": ["1h", 7 * 864e5], "30d": ["6h", 30 * 864e5] };
  async function loadChart() {
    const id = S.sel, range = S.range;
    document.querySelectorAll("#crange [data-r]").forEach(b => b.classList.toggle("on", b.dataset.r === range));
    const svg = $("#gchart");
    S.series = null;
    svg.innerHTML = `<text x="20" y="40">Loading prices…</text>`;
    const [step, span] = RANGES[range];
    let ts;
    try { ts = await api(S.route, `timeseries?id=${id}&timestep=${step}`); }
    catch (e) {
      if (S.sel === id && S.range === range) svg.innerHTML = `<text x="20" y="40">Couldn't load the price history. Try another range in a moment.</text>`;
      return;
    }
    if (S.sel !== id || S.range !== range) return;   // the user moved on while this loaded
    const cut = Date.now() - span;
    S.series = (ts.data || []).map(d => ({ t: d.timestamp * 1000, hi: d.avgHighPrice, lo: d.avgLowPrice, v: (d.highPriceVolume || 0) + (d.lowPriceVolume || 0) }))
      .filter(d => d.t >= cut);
    drawChart();
  }

  let geo = null;
  function drawChart() {
    const svg = $("#gchart");
    if (!svg) return;
    const pts = S.series || [];
    const vals = pts.flatMap(p => [p.hi, p.lo]).filter(v => v != null);
    if (pts.length < 2 || !vals.length) { geo = null; svg.innerHTML = `<text x="20" y="40">Not enough trades in this range to draw a chart.</text>`; return; }
    // Draw in real pixels so labels stay crisp and unsquashed on phones.
    const W = Math.max(Math.round(svg.clientWidth) || 800, 260), H = Math.round(svg.clientHeight) || 280;
    const L = W < 420 ? 46 : 60, R = 8, T = 10, B = 26, VH = Math.round((H - T - B) * 0.2);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let vmax = Math.max(...vals), vmin = Math.min(...vals);
    const pad = Math.max((vmax - vmin) * 0.08, vmax * 0.005, 1);
    vmax += pad; vmin = Math.max(0, vmin - pad);
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const x = t => L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
    const y = v => T + (1 - (v - vmin) / Math.max(vmax - vmin, 1)) * (H - T - B - VH - 6);
    const vtop = Math.max(...pts.map(p => p.v), 1);
    const bw = Math.max(1, (W - L - R) / pts.length - 1);
    let g = "", prev = "";
    for (let i = 0; i <= 4; i++) {
      const v = vmin + ((vmax - vmin) * i) / 4, lab = short(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#3a3346" stroke-dasharray="3 4"/>${lab === prev ? "" : `<text x="4" y="${y(v) + 5}">${lab}</text>`}`;
      prev = lab;   // cheap items: don't print "5" twice
    }
    const ticks = W < 500 ? 2 : 4;   // fewer time labels on narrow screens so they never overlap
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      const lab = S.range === "24h" ? clock(t) : day(t);
      const anchor = i === 0 ? "start" : i === ticks ? "end" : "middle";
      g += `<text x="${x(t)}" y="${H - 4}" text-anchor="${anchor}">${lab}</text>`;
    }
    const bars = pts.map(p => p.v ? `<rect x="${(x(p.t) - bw / 2).toFixed(1)}" y="${(H - B - (p.v / vtop) * VH).toFixed(1)}" width="${bw.toFixed(1)}" height="${((p.v / vtop) * VH).toFixed(1)}"/>` : "").join("");
    // Break the line where nobody traded instead of drawing a fake straight run.
    const path = key => {
      let d = "", pen = false;
      for (const p of pts) {
        if (p[key] == null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    svg.innerHTML = `${g}<g class="vol">${bars}</g>
      <path fill="none" stroke="#00ffff" stroke-width="1.6" d="${path("lo")}"/>
      <path fill="none" stroke="#ffff00" stroke-width="2" d="${path("hi")}"/>`;
    geo = { x, y, W, H, T, B, L, R, pts };
  }

  function hover(e) {
    if (!geo) return;
    const svg = $("#gchart");
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (geo.W / r.width);
    let best = geo.pts[0];
    for (const p of geo.pts) if (Math.abs(geo.x(p.t) - px) < Math.abs(geo.x(best.t) - px)) best = p;
    const cx = geo.x(best.t).toFixed(1);
    let c = $("#cross");
    if (!c) { c = document.createElementNS("http://www.w3.org/2000/svg", "line"); c.id = "cross"; c.setAttribute("stroke", "#6b5d78"); svg.appendChild(c); }
    c.setAttribute("x1", cx); c.setAttribute("x2", cx); c.setAttribute("y1", geo.T); c.setAttribute("y2", geo.H - geo.B);
    const when = S.range === "24h" ? clock(best.t) : `${day(best.t)} ${clock(best.t)}`;
    $("#read").innerHTML = `<span>${when}</span> <b class="y">${best.hi ? fmt(best.hi) : "—"}</b> <b class="c">${best.lo ? fmt(best.lo) : "—"}</b> <span>${fmt(best.v)} traded</span>`;
  }

  /* ---------------- movers ---------------- */
  // "Meaningful volume" thresholds per window: trades in the window and gp that changed hands.
  const MIN = { "1h": { trades: 10, gp: 5e5 }, "24h": { trades: 100, gp: 5e6 } };
  async function moverRows(win) {
    const now = S.hour;
    const t = now.timestamp;
    const back = win === "1h" ? 3600 : 86400;
    const then = await api(S.route, `1h?timestamp=${t - back}`);
    const a = now.data || {}, b = then.data || {};
    const rows = [];
    for (const id in a) {
      const it = S.byId.get(+id);
      if (!it || !b[id]) continue;
      const pa = mid({ high: a[id].avgHighPrice, low: a[id].avgLowPrice }), pb = mid({ high: b[id].avgHighPrice, low: b[id].avgLowPrice });
      if (!pa || !pb) continue;
      const trades = win === "1h" ? (a[id].highPriceVolume || 0) + (a[id].lowPriceVolume || 0) : (S.vol ? S.vol[id] || 0 : ((a[id].highPriceVolume || 0) + (a[id].lowPriceVolume || 0)) * 24);
      if (trades < MIN[win].trades || trades * pa < MIN[win].gp) continue;
      rows.push({ it, price: pa, ch: pa / pb - 1, trades });
    }
    return rows;
  }
  async function drawMovers() {
    document.querySelectorAll("#mrange [data-w]").forEach(b => b.classList.toggle("on", b.dataset.w === S.mwin));
    document.querySelectorAll("#mdir [data-d]").forEach(b => b.classList.toggle("on", b.dataset.d === S.mdir));
    const t = $("#movers"), win = S.mwin, dir = S.mdir;
    const m = MIN[win];
    $("#movers + .ge-foot").textContent = `Only items with meaningful volume (at least ${m.trades} trades and ${short(m.gp)} gp traded ${win === "1h" ? "in the last hour" : "in the last 24 hours"}), so one lucky sale can't top the list. Change compares average prices of the latest complete hour with the hour ${win === "1h" ? "before it" : "24 hours earlier"}.`;
    head(t, ["ITEM", "PRICE", "CHANGE", ["TRADED", "hide-sm"]]);
    let rows;
    try { rows = await moverRows(win); }
    catch (e) { body(t, `<tr><td colspan="9" class="note">Couldn't load the price history for movers. Try again in a moment.</td></tr>`); return; }
    if (S.mwin !== win || S.mdir !== dir) return;
    rows.sort((x, y) => dir === "up" ? y.ch - x.ch : x.ch - y.ch);
    rows = rows.filter(r => dir === "up" ? r.ch > 0 : r.ch < 0).slice(0, 15);
    body(t, rows.map(r => `<tr>${name(r.it)}<td class="y">${short(r.price)}</td><td class="${cls(r.ch)}">${pct(r.ch)}</td><td class="hide-sm">${fmt(r.trades)}</td>${spreadCell(r.it.id)}</tr>`).join("")
      || `<tr><td colspan="9" class="note">No item moved enough with real volume. A quiet market.</td></tr>`);
  }

  /* ---------------- most traded ---------------- */
  function drawTraded() {
    const t = $("#traded");
    let rows, foot;
    if (S.vol) {
      rows = Object.entries(S.vol).map(([id, v]) => {
        const it = S.byId.get(+id), p = mid(S.latest[id]);
        return it && p ? { it, trades: v, gp: v * p, price: p } : null;
      }).filter(Boolean);
      foot = "Ranked by gp traded over the last 24 hours (items traded × current price).";
    } else {
      const d = (S.hour && S.hour.data) || {};
      rows = Object.entries(d).map(([id, h]) => {
        const it = S.byId.get(+id), p = mid({ high: h.avgHighPrice, low: h.avgLowPrice });
        const v = (h.highPriceVolume || 0) + (h.lowPriceVolume || 0);
        return it && p ? { it, trades: v, gp: v * p, price: p } : null;
      }).filter(Boolean);
      foot = "24-hour volumes are unavailable right now, so this ranks the latest complete hour instead.";
    }
    $("#traded + .ge-foot").textContent = foot;
    rows.sort((a, b) => b.gp - a.gp);
    head(t, ["ITEM", "PRICE", ["TRADED", "hide-sm"], "GP TRADED"]);
    body(t, rows.slice(0, 15).map(r => `<tr>${name(r.it)}<td class="y">${short(r.price)}</td><td class="hide-sm">${fmt(r.trades)}</td><td>${short(r.gp)}</td>${spreadCell(r.it.id)}</tr>`).join("")
      || `<tr><td colspan="9" class="note">No trades recorded yet.</td></tr>`);
  }

  /* ---------------- table helpers ---------------- */
  function head(t, cols) {
    if (S.main) cols = cols.concat([["VS MAIN", "sp"]]);
    t.classList.toggle("has-sp", !!S.main);
    t.tHead.innerHTML = `<tr>${cols.map(c => Array.isArray(c) ? `<th class="${c[1]}">${c[0]}</th>` : `<th>${c}</th>`).join("")}</tr>`;
  }
  const body = (t, html) => { t.tBodies[0].innerHTML = html; };
  const name = it => `<td class="n"><a href="?id=${it.id}" data-item="${it.id}">${img(it)}<span>${esc(it.name)}</span></a></td>`;
  const spreadCell = id => S.main ? `<td class="sp ${cls(spread(id))}">${pct(spread(id), 0)}</td>` : "";

  boot();
})();
