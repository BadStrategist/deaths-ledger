/* Hardcore Worlds: Death Toll — "Is it safe?" lookup, rendered from assets/safety.json. */
(function () {
  "use strict";
  const PAGE = document.body.dataset.page;
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WIKI = "https://oldschool.runescape.wiki/w/Hardcore_Worlds";

  /* ---------------- shared header: assets/nav.js ---------------- */
  function chrome(gy) {
    deathTollHeader(gy && gy.counts ? gy.counts.all_time : 0);
  }

  async function json(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  /* ---------------- lookup ---------------- */
  const BADGE = { safe: "SAFE", unsafe: "UNSAFE", conditional: "IT DEPENDS", disabled: "DISABLED" };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  let data = null, verdict = "all";

  function matches(e, q) {
    if (!q) return true;
    const hay = e._hay;
    return q.split(" ").every(w => hay.includes(w));
  }

  function card(e) {
    return `<article class="verdict v-${e.verdict}">
      <span class="badge">${BADGE[e.verdict] || esc(e.verdict.toUpperCase())}</span>
      <div class="vt"><h3>${esc(e.name)}</h3><p>${esc(e.rule)}</p>
      <a class="src" href="${esc(e.source)}" rel="noopener">Source</a></div></article>`;
  }

  function render() {
    const raw = $("#q").value, q = norm(raw);
    const shown = data.entries.filter(e => (verdict === "all" || e.verdict === verdict) && matches(e, q));
    let html = shown.map(card).join("");
    if (!shown.length) {
      const inOther = q && data.entries.some(e => matches(e, q));
      html = inOther
        ? `<div class="verdict v-none"><div class="vt"><h3>No ${esc(verdict)} match</h3><p>"${esc(raw.trim())}" is on the list with a different verdict. Tap <b>All</b> to see it.</p></div></div>`
        : `<article class="verdict v-unsafe v-unlisted">
            <span class="badge">UNSAFE</span>
            <div class="vt"><h3>${q ? `"${esc(raw.trim())}" is not on the safe list` : "Nothing here"}</h3>
            <p>Not on the safe list — treat as <b>UNSAFE</b>. On Hardcore Worlds, a death anywhere not listed as safe counts as your one life.</p>
            <a class="src" href="${WIKI}" rel="noopener">Check the OSRS Wiki</a></div></article>`;
    }
    $("#list").innerHTML = html;
    const n = shown.length;
    $("#status").textContent = n ? `${n} ${n === 1 ? "entry" : "entries"}${q ? ` matching "${raw.trim()}"` : ""}` : "";
  }

  function setVerdict(v) {
    verdict = v;
    document.querySelectorAll("#chips .tab").forEach(b => {
      const on = b.dataset.v === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    render();
  }

  async function init() {
    chrome(null);
    json(`data/graveyard.json?t=${Math.floor(Date.now() / 60000)}`).then(gy => { if (gy && gy.status === "live") chrome(gy); });

    data = await json("assets/safety.json?v=20261030a");
    if (!data) {
      $("#list").innerHTML = `<div class="verdict v-none"><div class="vt"><h3>Could not load the safe list</h3><p>Treat every death as <b>UNSAFE</b> and check the <a href="${WIKI}" rel="noopener">OSRS Wiki</a>.</p></div></div>`;
      return;
    }
    data.entries.forEach(e => { e._hay = norm([e.name, ...(e.aka || [])].join(" ")); });
    const order = { unsafe: 0, conditional: 1, safe: 2, disabled: 3 };
    data.entries.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.name.localeCompare(b.name));

    const d = new Date(data.updated + "T12:00:00Z");
    $("#checked").innerHTML = `List last updated ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. Sources: the
      <a href="${esc(data.sources.news)}" rel="noopener">official announcement</a> and the <a href="${esc(data.sources.wiki)}" rel="noopener">OSRS Wiki</a>.
      Jagex can change these rules; if in doubt, assume a death counts.`;

    const params = new URLSearchParams(location.search);
    if (params.get("q")) $("#q").value = params.get("q");
    $("#q").addEventListener("input", render);
    $("#chips").addEventListener("click", ev => { const b = ev.target.closest(".tab"); if (b) setVerdict(b.dataset.v); });
    render();
  }

  init();
})();
