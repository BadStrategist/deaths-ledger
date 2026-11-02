/* Hardcore Worlds: Death Toll — Hiscores page. Reads only data/hiscores.json (schema: docs/hiscores-schema.md).
   Until that file reports status "live", clearly labelled sample rankings are shown instead. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function load(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  const fresh = name => `data/${name}?t=${Math.floor(Date.now() / 60000)}`;

  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 129600) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = ms => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

  /* ---------------- shared header: assets/nav.js ---------------- */
  function chrome(gy) {
    deathTollHeader(gy && gy.counts ? gy.counts.all_time : 0);
  }

  /* The sample file is dated; shift its times so "updated" reads as now and deaths look recent. */
  function shiftSample(s) {
    const d = Date.now() - (Date.parse(s.updated) || Date.now());
    const move = t => (t ? new Date(Date.parse(t) + d).toISOString() : t);
    return { ...s, updated: move(s.updated), overall: (s.overall || []).map(r => ({ ...r, died_at: move(r.died_at) })) };
  }

  function state(r) {
    if (!r.dead) return `<span class="pill ok">ALIVE</span>`;
    const t = Date.parse(r.died_at);
    return `<span class="hs-dead"><img class="pix" src="assets/art/skull.png" width="25" height="25" alt="">` +
      `<span>${t ? `<span title="${esc(new Date(t).toString())}">${day(t)}<span class="hide-sm"> ${clock(t)}</span></span>` : "DIED"}</span></span>`;
  }

  async function main() {
    const [real, gy] = await Promise.all([load(fresh("hiscores.json")), load(fresh("graveyard.json"))]);
    chrome(gy && gy.status === "live" ? gy : null);

    let hs = real && real.status === "live" ? real : null;
    if (!hs) {
      const sample = await load("assets/sample-hiscores.json");
      hs = sample ? { ...shiftSample(sample), sample: true } : { status: "waiting", overall: [] };
    }
    const S = hs.sample ? ` <span class="tag sample">SAMPLE</span>` : "";   // every made-up row and tile carries it

    const overall = Array.isArray(hs.overall) ? hs.overall : [];
    const skills = hs.skills && typeof hs.skills === "object" ? hs.skills : null;
    const ui = { board: "Overall", q: "" };

    const alive = overall.find(r => !r.dead), fallen = overall.find(r => r.dead);
    const deadCount = overall.filter(r => r.dead).length;
    const tile = (label, r, cls) => `<div><span>${label}</span><b class="${cls}">${r ? fmt(r.total) : "—"}</b>
      <em>${r ? `${esc(r.name)} <i>· rank ${fmt(r.rank)}</i>${S}` : "Nobody yet"}</em></div>`;
    $("#tiles").innerHTML = tile("HIGHEST ALIVE", alive, "") + tile("HIGHEST FALLEN", fallen, "red") +
      `<div><span>FALLEN IN THE TOP ${fmt(overall.length)}</span><b class="red">${fmt(deadCount)}</b><em>${hs.sample ? "SAMPLE · " : ""}${overall.length ? Math.round((deadCount / overall.length) * 100) + "% of these ranks" : "—"}</em></div>`;

    const boards = skills ? ["Overall", ...Object.keys(skills).filter(k => Array.isArray(skills[k]) && skills[k].length)] : [];
    const tabs = $("#skills");
    if (boards.length > 1) {
      tabs.hidden = false;
      tabs.innerHTML = boards.map(b => `<button class="tab" role="tab" data-b="${esc(b)}">${esc(b)}</button>`).join("");
      tabs.addEventListener("click", e => {
        const b = e.target.closest("[data-b]");
        if (b) { ui.board = b.dataset.b; draw(); }
      });
    }
    $("#search").addEventListener("input", e => { ui.q = e.target.value.trim().toLowerCase(); draw(); });

    function draw() {
      const isOverall = ui.board === "Overall";
      tabs.querySelectorAll("[data-b]").forEach(b => {
        const on = b.dataset.b === ui.board;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on);
      });
      $("#board-title").textContent = isOverall ? "Overall" : ui.board;
      $("#head").innerHTML = `<tr><th class="c-rank">RANK</th><th class="c-name">NAME</th><th class="c-num">${isOverall ? "TOTAL" : "LEVEL"}</th><th class="c-xp hide-sm">XP</th><th class="c-state">STATE</th></tr>`;
      const all = isOverall ? overall : skills[ui.board];
      const list = all.filter(r => !ui.q || String(r.name).toLowerCase().includes(ui.q));
      $("#rows").innerHTML = list.map(r => `<tr class="${r.dead ? "dead" : ""}">
        <td class="c-rank">${fmt(r.rank)}</td>
        <td class="c-name n">${esc(r.name)}${S}</td>
        <td class="c-num y">${fmt(isOverall ? r.total : r.level)}</td>
        <td class="c-xp hide-sm">${fmt(r.xp)}</td>
        <td class="c-state">${state(isOverall ? r : { ...r, died_at: (overall.find(o => o.name === r.name) || {}).died_at })}</td></tr>`).join("") ||
        `<tr><td colspan="5" class="note">${all.length ? "No name in these ranks matches." : "No rankings published yet. The gates open on 4 November."}</td></tr>`;
    }
    draw();

    const t = Date.parse(hs.updated);
    $("#meta").innerHTML = hs.sample
      ? `Showing <b>sample rankings</b> until the Hardcore Worlds hiscores go live.`
      : [`Top <b>${fmt(overall.length)}</b> on Hardcore Worlds`, t ? `updated ${ago(t)}` : "", hs.mode ? `table ${esc(hs.mode)}` : "", hs.notes ? esc(hs.notes) : ""]
          .filter(Boolean).join(" · ") + ".";
  }

  main();
})();
