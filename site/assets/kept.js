/* Hardcore Worlds: Death Toll — Kept on death calculator. Prices: OSRS Wiki real-time API, fetched in the browser. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const trim = s => s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  const gp = n => {
    if (n == null) return "—";
    if (n >= 1e9) return trim((n / 1e9).toFixed(n >= 1e10 ? 1 : 2)) + "b";
    if (n >= 1e6) return trim((n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2)) + "m";
    if (n >= 1e5) return Math.round(n / 1e3) + "k";
    return fmt(n);
  };

  const API = "https://prices.runescape.wiki/api/v1/";
  const ICON = "https://oldschool.runescape.wiki/images/";
  const STORE = "kept.v1";
  const LIMIT = { inv: 28, eq: 11 };
  // Coins are not on the GE, so the price API has no entry for them; their value is fixed at 1 gp each.
  const COINS = { id: 995, name: "Coins", icon: "Coins_10000.png", price: 1 };

  /* ---------------- shared header: assets/nav.js ---------------- */
  function chrome(gy) {
    deathTollHeader(gy && gy.counts ? gy.counts.all_time : 0);
  }

  async function local(name) {
    try {
      const r = await fetch(`data/${name}?t=${Math.floor(Date.now() / 60000)}`);
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* ---------------- prices ---------------- */
  const items = new Map();       // id -> {id, name, icon, price}
  let priceInfo = null;          // {route, hardcore, fallback}

  async function loadRoute(route) {
    const [map, latest] = await Promise.all([getJSON(API + route + "/mapping"), getJSON(API + route + "/latest")]);
    if (!Array.isArray(map) || !latest || typeof latest.data !== "object") throw new Error("unexpected response");
    items.clear();
    for (const m of map) {
      const p = latest.data[m.id] || {};
      const hi = p.high > 0 ? p.high : null, lo = p.low > 0 ? p.low : null;
      const price = hi && lo ? Math.round((hi + lo) / 2) : (hi || lo || null);
      items.set(m.id, { id: m.id, name: m.name, icon: m.icon, price });
    }
    items.set(COINS.id, COINS);
  }

  async function loadPrices() {
    const box = $("#price-state");
    box.className = "price-state";
    box.textContent = "Loading prices…";
    const w = await local("watcher.json");
    const hc = w && w.price_route ? String(w.price_route) : null;
    try {
      if (hc) {
        try { await loadRoute(hc); priceInfo = { route: hc, hardcore: true }; }
        catch (e) { await loadRoute("osrs"); priceInfo = { route: "osrs", hardcore: false, fallback: hc }; }
      } else {
        await loadRoute("osrs");
        priceInfo = { route: "osrs", hardcore: false };
      }
    } catch (e) {
      items.clear();
      priceInfo = null;
      box.className = "price-state err";
      box.innerHTML = `<b>PRICES UNAVAILABLE</b> We couldn't reach the price feed, so items can't be searched or valued right now. Your saved loadout is kept. <button class="tab" type="button" id="retry">Try again</button>`;
      $("#retry").addEventListener("click", loadPrices);
      $("#q").disabled = true;
      draw();
      return;
    }
    box.hidden = true;
    $("#q").disabled = false;
    draw();
  }

  function priceLabel() {
    if (!priceInfo) return "";
    if (priceInfo.hardcore) return `<b>Prices:</b> Hardcore Worlds GE prices. Each price is the middle of the latest buy and sell.`;
    const fb = priceInfo.fallback ? ` The Hardcore Worlds prices didn't load, so these are the main-game prices for now.` : "";
    return `<b>Prices:</b> main-game GE prices. Hardcore Worlds has its own economy, and its prices replace these automatically once they're published.${fb} Each price is the middle of the latest buy and sell (OSRS Wiki).`;
  }

  /* ---------------- loadout state ---------------- */
  let state = { inv: [], eq: [], protect: false, skull: false, to: "inv" };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && Array.isArray(s.inv) && Array.isArray(s.eq)) state = { ...state, ...s, to: "inv" };
  } catch (e) { /* storage blocked: start empty */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ inv: state.inv, eq: state.eq, protect: state.protect, skull: state.skull, names: names() })); } catch (e) {} };
  // Remember names too, so a saved loadout still reads sensibly while prices are down.
  const savedNames = (() => { try { return (JSON.parse(localStorage.getItem(STORE) || "{}").names) || {}; } catch (e) { return {}; } })();
  function names() { const o = { ...savedNames }; for (const e of state.inv.concat(state.eq)) { const it = items.get(e.id); if (it) o[e.id] = it.name; } return o; }
  const item = id => items.get(id) || { id, name: savedNames[id] || `Item ${id}`, icon: null, price: null };

  function add(id) {
    const list = state[state.to];
    const have = list.find(e => e.id === id);
    if (have) have.qty += 1;
    else if (list.length >= LIMIT[state.to]) { flash(`${state.to === "eq" ? "Equipment" : "Inventory"} is full (${LIMIT[state.to]} slots).`); return; }
    else list.push({ id, qty: 1 });
    save(); draw();
  }

  /* ---------------- the rule ---------------- */
  // Items Kept on Death (OSRS Wiki): 3 most valuable items; +1 with Protect Item; skulled keeps 0 (+1 with Protect Item).
  // Stacks are counted unit by unit.
  function keepCount(protect, skull) { return (skull ? 0 : 3) + (protect ? 1 : 0); }

  function outcome() {
    const all = [];
    for (const where of ["eq", "inv"]) for (const e of state[where]) if (e.qty > 0) all.push({ ...item(e.id), qty: e.qty, where });
    // Highest value first; unpriced items rank last (we can't know their value).
    all.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    let left = keepCount(state.protect, state.skull);
    const kept = [], lost = [];
    let lastKept = null;
    for (const e of all) {
      const k = Math.min(left, e.qty);
      if (k > 0) { kept.push({ ...e, qty: k }); left -= k; lastKept = e; }
      if (e.qty - k > 0) lost.push({ ...e, qty: e.qty - k });
    }
    const risk = lost.reduce((s, e) => s + (e.price || 0) * e.qty, 0);
    const keptValue = kept.reduce((s, e) => s + (e.price || 0) * e.qty, 0);
    // A tie: the cheapest kept item is worth the same as the best lost item, and they're different items.
    const tie = lastKept && lost[0] && lost[0].id !== lastKept.id && lastKept.price != null && lost[0].price === lastKept.price;
    return { all, kept, lost, risk, keptValue, tie, n: keepCount(state.protect, state.skull),
      unpriced: all.filter(e => e.price == null) };
  }

  /* ---------------- rendering ---------------- */
  const img = it => it.icon ? `<img class="ic" src="${ICON + encodeURIComponent(it.icon.replace(/ /g, "_"))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="ic"></span>`;

  function loadRow(e, where) {
    const it = item(e.id);
    return `<li data-id="${e.id}" data-w="${where}">${img(it)}
      <span class="nm">${esc(it.name)}<small>${it.price == null ? "no price" : gp(it.price) + " ea"}</small></span>
      <span class="qty"><button type="button" class="qb" data-act="dec" aria-label="One fewer ${esc(it.name)}">−</button><input type="number" inputmode="numeric" min="1" max="2147483647" value="${e.qty}" aria-label="Quantity of ${esc(it.name)}"><button type="button" class="qb" data-act="inc" aria-label="One more ${esc(it.name)}">+</button></span>
      <button type="button" class="rm" data-act="rm" aria-label="Remove ${esc(it.name)}">✕</button></li>`;
  }

  function outRow(e) {
    const where = e.where === "eq" ? "worn" : "inv";
    return `<li>${img(e)}<span class="nm">${esc(e.name)}${e.qty > 1 ? ` <b class="x">×${fmt(e.qty)}</b>` : ""}<small>${where}${e.price == null ? " · no price" : " · " + gp(e.price) + " ea"}</small></span>
      <span class="v">${e.price == null ? "?" : gp(e.price * e.qty)}</span></li>`;
  }

  function draw() {
    for (const w of ["eq", "inv"]) {
      $("#" + w).innerHTML = state[w].length ? state[w].map(e => loadRow(e, w)).join("") : `<li class="none">Nothing ${w === "eq" ? "worn" : "carried"}.</li>`;
      $("#" + w + "-n").textContent = `${state[w].length}/${LIMIT[w]}`;
    }
    for (const [id, on] of [["#t-protect", state.protect], ["#t-skull", state.skull]]) {
      $(id).classList.toggle("on", on); $(id).setAttribute("aria-pressed", on);
    }
    const o = outcome();
    $("#kept").innerHTML = o.kept.length ? o.kept.map(outRow).join("") : `<li class="none">${o.all.length ? "Nothing. You keep 0 items while skulled without Protect Item." : "Add items to see what you'd keep."}</li>`;
    $("#lost").innerHTML = o.lost.length ? o.lost.map(outRow).join("") : `<li class="none">${o.all.length ? "Nothing. Everything you carry fits in your kept slots." : "—"}</li>`;
    const ku = o.kept.reduce((s, e) => s + e.qty, 0), lu = o.lost.reduce((s, e) => s + e.qty, 0);
    $("#kept-n").textContent = ku ? `(${fmt(ku)})` : "";
    $("#lost-n").textContent = lu ? `(${fmt(lu)})` : "";
    const warn = [];
    if (o.tie) warn.push(`<b>Tie:</b> ${esc(o.kept[o.kept.length - 1].name)} and ${esc(o.lost[0].name)} have the same price here. The game may keep either one.`);
    if (o.unpriced.length) warn.push(`<b>No price:</b> ${o.unpriced.map(e => esc(e.name)).join(", ")}. These are ranked last and counted as 0 gp, so the result may be wrong.`);
    $("#verdict").innerHTML = `
      <div class="big"><b class="kept-c" id="v-n">${o.n}</b><span>ITEM${o.n === 1 ? "" : "S"} KEPT${state.skull ? " · SKULLED" : ""}${state.protect ? " · PROTECT ITEM" : ""}</span></div>
      <div class="big"><b class="lost-c" id="v-risk">${priceInfo || !o.all.length ? gp(o.risk) : "—"}</b><span>GP AT RISK${o.risk >= 1e5 ? ` · ${fmt(o.risk)}` : ""}</span></div>
      <div class="big"><b id="v-kept">${priceInfo || !o.all.length ? gp(o.keptValue) : "—"}</b><span>GP KEPT</span></div>
      ${warn.length ? `<p class="warn">${warn.join("<br>")}</p>` : ""}`;
    $("#price-label").innerHTML = priceLabel();
  }

  let flashT;
  function flash(msg) {
    const box = $("#price-state");
    if (!priceInfo) return;
    box.hidden = false; box.className = "price-state"; box.textContent = msg;
    clearTimeout(flashT); flashT = setTimeout(() => { box.hidden = true; }, 2500);
  }

  /* ---------------- search ---------------- */
  let hits = [], active = -1;
  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const it of items.values()) {
      const n = it.name.toLowerCase(), i = n.indexOf(q);
      if (i >= 0) out.push([i === 0 ? 0 : (n.includes(" " + q) ? 1 : 2), n.length, it]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return out.slice(0, 8).map(x => x[2]);
  }
  function drawHits() {
    const ul = $("#results");
    const q = $("#q").value.trim();
    if (!hits.length) {
      ul.hidden = q.length < 2;
      ul.innerHTML = `<li class="none">No tradeable item matches “${esc(q)}”.</li>`;
      return;
    }
    ul.hidden = false;
    ul.innerHTML = hits.map((it, i) => `<li><button type="button" data-id="${it.id}"${i === active ? ' class="act"' : ""}>${img(it)}<span class="nm">${esc(it.name)}</span><span class="v">${it.price == null ? "no price" : gp(it.price)}</span></button></li>`).join("");
  }

  /* ---------------- events ---------------- */
  function init() {
    chrome(null);
    local("graveyard.json").then(gy => chrome(gy && gy.status === "live" ? gy : null));
    draw();

    $(".seg").addEventListener("click", e => {
      const b = e.target.closest("[data-to]"); if (!b) return;
      state.to = b.dataset.to;
      for (const x of $(".seg").children) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); }
      $("#q").focus();
    });
    const q = $("#q");
    q.addEventListener("input", () => { hits = search(q.value); active = -1; drawHits(); });
    q.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!hits.length) return;
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
        drawHits();
      } else if (e.key === "Enter" && hits.length) {
        e.preventDefault(); add(hits[Math.max(active, 0)].id);
      } else if (e.key === "Escape") { q.value = ""; hits = []; drawHits(); }
    });
    $("#results").addEventListener("click", e => {
      const b = e.target.closest("button[data-id]"); if (!b) return;
      add(Number(b.dataset.id));
    });
    $("#t-protect").addEventListener("click", () => { state.protect = !state.protect; save(); draw(); });
    $("#t-skull").addEventListener("click", () => { state.skull = !state.skull; save(); draw(); });
    $("#clear").addEventListener("click", () => { state.inv = []; state.eq = []; save(); draw(); });

    for (const w of ["eq", "inv"]) {
      const ul = $("#" + w);
      ul.addEventListener("click", e => {
        const b = e.target.closest("[data-act]"); if (!b) return;
        const li = b.closest("li"), list = state[w], idx = list.findIndex(x => x.id === Number(li.dataset.id));
        if (idx < 0) return;
        if (b.dataset.act === "rm") list.splice(idx, 1);
        else if (b.dataset.act === "inc") list[idx].qty += 1;
        else if (list[idx].qty > 1) list[idx].qty -= 1;
        else list.splice(idx, 1);
        save(); draw();
      });
      ul.addEventListener("change", e => {
        if (!e.target.matches("input")) return;
        const li = e.target.closest("li"), ent = state[w].find(x => x.id === Number(li.dataset.id));
        const v = Math.floor(Number(e.target.value));
        if (ent) ent.qty = Number.isFinite(v) && v >= 1 ? Math.min(v, 2147483647) : 1;
        save(); draw();
      });
    }
    loadPrices();
  }
  init();
})();
