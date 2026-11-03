/* Hardcore Worlds: Death Toll — renders every page from the JSON files the pipeline publishes in data/. */
(function () {
  "use strict";
  const PAGE = document.body.dataset.page;
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function load(name) {
    try {
      const r = await fetch(`data/${name}?t=${Math.floor(Date.now() / 60000)}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

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

  /* ---------------- dead-tree border under the hero stats ---------------- */
  const TREES = ["Dead_tree_small_1", "Dead_tree_Gravedigger", "Dead_tree_Misthalin_Manor", "Dead_tree_large_1", "Dead_tree_old",
    "Dead_tree_big_1", "Dead_tree_dark", "Dead_tree_large_2", "Dead_tree_Last_Man_Standing_small", "Dead_tree_big_2", "Dead_tree_large_3", "Dead_tree_burnt"];
  const TREE_H = [82, 104, 70, 112, 88, 76, 108, 68, 94, 100, 74, 106];   // fixed pattern: looks placed, not random
  function treeline() {
    const el = $("#treeline");
    if (!el) return;
    const narrow = window.innerWidth <= 760;
    const count = Math.max(6, Math.round(el.clientWidth / (narrow ? 40 : 56)));
    el.innerHTML = Array.from({ length: count }, (_, i) =>
      `<img src="assets/art/trees/${TREES[i % TREES.length]}.webp" alt="" style="--h:${Math.round(TREE_H[i % TREE_H.length] * (narrow ? .7 : 1))}px">`).join("");
  }

  function cards(pop, w) {
    const hc = pop && pop.hardcore_worlds_listed;
    const online = pop ? (hc ? pop.hardcore_total : pop.all_worlds_total) : null;
    return `
      <div class="frame card"><img class="pix" src="assets/art/hourglass.png" width="13" height="31" alt="">
        <div><b>${fmt(online)}</b><span>${hc ? "ON HARDCORE WORLDS NOW" : "ONLINE · ALL WORLDS (HARDCORE NOT LISTED YET)"}</span><a href="population.html">Population →</a></div></div>
      <div class="frame card"><img class="pix" src="assets/art/escape-crystal.png" width="11" height="27" alt="">
        <div><b>10,000 gp</b><span>ESCAPE CRYSTAL · FIRES WHEN YOU GO IDLE · SOLD BY DEATH, RICK &amp; THE MYSTERIOUS STRANGER</span></div></div>
      <div class="frame card"><img class="pix" src="assets/art/skull.png" width="25" height="25" alt="">
        <div><b>${w && w.hiscore_mode ? "LIVE" : "WAITING"}</b><span>HARDCORE WORLDS HISCORES</span><a href="watcher.html">Data watcher →</a></div></div>`;
  }

  /* ---------------- track a player (Cloudflare Worker, see worker/) ---------------- */
  const API = (document.querySelector('meta[name="dt-api"]') || {}).content || "";
  const NAME_OK = /^[A-Za-z0-9 _-]{1,12}$/;

  function trackBox(live) {
    const box = $("#track");
    if (!box || !API) return;            // no API configured: keep the box hidden rather than show a dead form
    box.hidden = false;
    const form = $("#track-form"), input = $("#track-name"), go = $("#track-go"), msg = $("#track-msg");
    const card = $("#track-card");             // homepage card: opens the Track a player page
    if (card) card.hidden = false;
    const say = (text, kind) => { msg.textContent = text; msg.className = "track-msg" + (kind ? " " + kind : ""); };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const name = input.value.replace(/\s+/g, " ").trim();
      if (!NAME_OK.test(name)) { say("RuneScape names are 1 to 12 letters, numbers, spaces, - or _.", "bad"); input.focus(); return; }
      go.disabled = true; say("Adding…");
      try {
        const r = await fetch(API.replace(/\/$/, "") + "/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { say(j.error || "That didn't work. Try again in a minute.", "bad"); return; }
        const who = j.name || name;
        say(j.already ? `${who} is already being tracked. Opening their page…` : `Now tracking ${who}. Opening their page…`, "ok");
        location.href = `player.html?name=${encodeURIComponent(who)}`;   // the player's own page, like Wise Old Man
      } catch (err) {
        say("Couldn't reach the tracker. Check your connection and try again.", "bad");
      } finally { go.disabled = false; }
    });
  }

  /* ---------------- homepage ---------------- */
  async function home() {
    const G = window.DeathTollGraves;   // assets/graveyard.js: sample fallback + the headstone card
    const [real, pop, w, names] = await Promise.all([load("graveyard.json"), load("population.json"), load("watcher.json"), G.regions()]);
    const gy = (await G.withPreview(real)) || {};
    chrome(gy.sample ? real : gy);
    treeline();
    trackBox(!!(real && real.status === "live"));
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(treeline, 200); });
    const c = gy.counts || {};
    const hc = pop && pop.hardcore_worlds_listed;
    // Sample graves never feed the hero numbers: before launch these read 0 and a dash.
    $("#tally").innerHTML = `
      <div><b class="red">${gy.sample ? "0" : fmt(c.today || 0)}</b><span>FALLEN TODAY</span></div>
      <div><b>${!gy.sample && c.highest_total ? fmt(c.highest_total) : "—"}</b><span>HIGHEST TOTAL LOST</span></div>
      <div><b class="yel">${pop ? fmt(hc ? pop.hardcore_total : pop.all_worlds_total) : "—"}</b><span>${hc ? "ON HARDCORE NOW" : "ONLINE NOW"}</span></div>`;
    $("#cards").innerHTML = cards(pop, w);

    // Latest graves: the newest six, full feed on graveyard.html.
    const latest = (gy.deaths || []).filter(d => Number.isFinite(d.time)).sort((a, b) => b.time - a.time).slice(0, 6);
    $("#latest-rows").innerHTML = latest.length
      ? `<div class="stones">${latest.map(d => G.card(d, names, { small: true })).join("")}</div>`
      : `<div class="frame empty"><h3>${gy.status === "live" ? "No graves yet" : "The gates open on 4 November"}</h3>
          <p>${gy.status === "live" ? "The hiscores are being read. Everyone above the listing line is still alive." : "The moment Jagex publishes the Hardcore Worlds hiscores, the first stone goes up here, automatically."}</p></div>`;
    const note = $("#latest-note");
    note.hidden = !gy.sample;
    if (gy.sample) note.innerHTML = `Showing <b>sample graves</b> until the Hardcore Worlds hiscores go live.`;
  }

  /* ---------------- population ---------------- */
  async function population() {
    const [pop, gy] = await Promise.all([load("population.json"), load("graveyard.json")]);
    chrome(gy && gy.status === "live" ? gy : null);
    if (!pop) { $("#main").innerHTML += `<p class="note">No population data yet.</p>`; return; }
    const hc = pop.hardcore_worlds_listed;
    $("#big").innerHTML = `
      <div><b>${hc ? fmt(pop.hardcore_total) : "—"}</b><span>ON HARDCORE WORLDS NOW</span></div>
      <div><b>${hc ? fmt(pop.peak_hardcore) : "—"}</b><span>HARDCORE PEAK</span></div>
      <div><b>${fmt(pop.all_worlds_total)}</b><span>ALL OSRS WORLDS NOW</span></div>
      <div><b>${hc && pop.all_worlds_total ? ((pop.hardcore_total / pop.all_worlds_total) * 100).toFixed(1) + "%" : "—"}</b><span>SHARE PLAYING HARDCORE</span></div>`;
    let range = 1;
    const svg = $("#chart");
    function drawChart() {
      document.querySelectorAll("#range [data-d]").forEach(b => b.classList.toggle("on", +b.dataset.d === range));
      const cut = range ? Date.now() - range * 864e5 : 0;
      const idx = hc ? 1 : 2;
      const pts = pop.history.filter(p => p[0] >= cut && p[idx] != null);
      if (pts.length < 2) { svg.innerHTML = `<text x="20" y="40">Collecting data… one point every run.</text>`; return; }
      // Draw in real pixels so labels stay crisp and unsquashed on phones.
      const W = Math.max(Math.round(svg.clientWidth) || 800, 280), H = Math.round(svg.clientHeight) || 280, L = 56, B = 26;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
      const vmax = Math.max(...pts.map(p => p[idx])) * 1.05, vmin = Math.min(...pts.map(p => p[idx])) * 0.95;
      const x = t => L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - L - 10);
      const y = v => 10 + (1 - (v - vmin) / Math.max(vmax - vmin, 1)) * (H - B - 10);
      let grid = "";
      for (let i = 0; i <= 4; i++) {
        const v = vmin + ((vmax - vmin) * i) / 4;
        grid += `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#3a3346" stroke-dasharray="3 4"/><text x="4" y="${y(v) + 5}">${fmt(Math.round(v))}</text>`;
      }
      const ticks = W < 500 ? 2 : 4;  // fewer time labels on narrow screens so they never overlap
      for (let i = 0; i <= ticks; i++) {
        const t = t0 + ((t1 - t0) * i) / ticks;
        const lab = range === 1 ? clock(t) : day(t);
        grid += `<text x="${Math.min(x(t) - 16, W - 60)}" y="${H - 4}">${lab}</text>`;
      }
      const line = pts.map(p => `${x(p[0]).toFixed(1)},${y(p[idx]).toFixed(1)}`).join(" ");
      svg.innerHTML = `${grid}<polygon fill="rgba(255,255,0,.08)" points="${L},${H - B} ${line} ${x(t1)},${H - B}"/>
        <polyline fill="none" stroke="#ffff00" stroke-width="2" points="${line}"/>`;
    }
    $("#range").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (b) { range = +b.dataset.d; drawChart(); } });
    $("#chart-title").textContent = hc ? "Players on Hardcore Worlds" : "Players on all OSRS worlds (Hardcore Worlds not listed yet)";
    drawChart();
    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 150); });
    $("#worlds").innerHTML = (pop.worlds || []).map(w => `<tr><td class="n">World ${w.id}</td><td>${esc(w.region || "")}</td><td>${esc(w.activity || "")}</td><td class="y">${fmt(w.players)}</td></tr>`).join("")
      || `<tr><td colspan="4" class="note">Hardcore worlds appear here once Jagex adds them to the world list.</td></tr>`;
  }

  /* ---------------- watcher ---------------- */
  async function watcherPage() {
    const [w, s, pop, gy] = await Promise.all([load("watcher.json"), load("status.json"), load("population.json"), load("graveyard.json")]);
    chrome(gy && gy.status === "live" ? gy : null);
    const row = (label, ok, detail) => `<tr><td class="n">${label}</td><td>${ok ? '<span class="pill ok">FOUND</span>' : '<span class="pill wait">WAITING</span>'}</td><td>${detail}</td></tr>`;
    $("#sources").innerHTML =
      row("World list", pop && pop.hardcore_worlds_listed, pop && pop.hardcore_worlds_listed ? `${(pop.worlds || []).length} Hardcore worlds listed` : "Live, but no Hardcore worlds on it yet") +
      row("Hardcore Worlds hiscores", w && w.hiscore_mode, w && w.hiscore_mode ? esc(w.hiscore_mode) : "Not published yet") +
      row("Hardcore GE prices", w && w.price_route, w && w.price_route ? "Live" : "Not published yet");
    const steps = (s && s.steps) || {};
    $("#steps").innerHTML = Object.entries(steps).map(([k, r]) =>
      `<tr><td class="n">${esc(k)}</td><td>${r.ok ? '<span class="pill ok">OK</span>' : '<span class="pill no">FAILED</span>'}</td><td>${ago(Date.parse(r.at))} · ${(r.ms / 1000).toFixed(1)}s${r.error ? " · " + esc(r.error) : ""}</td></tr>`).join("")
      || `<tr><td colspan="3" class="note">No runs yet.</td></tr>`;
    const ev = (w && w.events) || [];
    $("#events").innerHTML = ev.length
      ? `<ul>${ev.slice().reverse().map(e => `<li><span class="t">${day(Date.parse(e.t))} ${clock(Date.parse(e.t))}</span>${esc(e.detail)}</li>`).join("")}</ul>`
      : `<p class="note">Nothing new yet. The first entry will be the Hardcore Worlds hiscores appearing.</p>`;
    $("#checked").textContent = w && w.checked ? `Last checked ${ago(Date.parse(w.checked))}` : "";
  }

  ({ home, population, watcher: watcherPage })[PAGE]();
})();
