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
  function when(d) {
    if (d.time_exact) return `${day(d.time)} ${clock(d.time)}`;
    if (d.window_start) return `${clock(d.window_start)}–${clock(d.time)}`;
    return `by ${clock(d.time)}`;
  }

  /* ---------------- shared chrome ---------------- */
  const NAV = [
    ["index.html", "graveyard", "Graveyard", '<path d="M4 19V8a6 6 0 0 1 12 0v11z" fill="currentColor" opacity=".85"/><path d="M10 7v7M7.5 9.5h5" stroke="#5a1014" stroke-width="2"/>'],
    ["population.html", "population", "Population", '<path d="M5 2h10M5 18h10M6 3c0 5 4 5 4 7s-4 2-4 7h8c0-5-4-5-4-7s4-2 4-7z" fill="none" stroke="#d4a65a" stroke-width="1.6"/>', "● LIVE"],
    ["watcher.html", "watcher", "Data watcher", '<path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z" fill="none" stroke="#d4a65a" stroke-width="1.6"/><circle cx="10" cy="10" r="3" fill="#e8323c"/>'],
  ];

  function chrome(pop, gy) {
    $("#top").innerHTML = `
      <svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M14 6h36M14 58h36" stroke="#d4a65a" stroke-width="4" stroke-linecap="round"/>
        <path d="M18 8c0 14 10 18 14 24-4 6-14 10-14 24h28c0-14-10-18-14-24 4-6 14-10 14-24z" fill="#1a1511" stroke="#d4a65a" stroke-width="2.5"/>
        <path d="M24 50c2-6 6-8 8-9 2 1 6 3 8 9z" fill="#e8323c"/>
        <circle cx="32" cy="18" r="6" fill="#e9dbb8"/><circle cx="29.8" cy="17.5" r="1.6" fill="#000"/><circle cx="34.2" cy="17.5" r="1.6" fill="#000"/>
      </svg>
      <a class="brand" href="index.html"><small>HARDCORE WORLDS</small><h1>Death Toll</h1></a>
      <div class="top-live">
        <div class="orb alive" title="Players on Hardcore Worlds right now"><i>♥</i><b>${pop && pop.hardcore_total != null ? fmt(pop.hardcore_total) + " alive" : "awaiting launch"}</b></div>
        <div class="orb dead" title="Deaths recorded"><i>☠</i><b>${fmt(gy && gy.counts ? gy.counts.all_time : 0)} fallen</b></div>
      </div>`;
    $("#nav").innerHTML = `<h3>Death's Office</h3><div class="body">` +
      NAV.map(([href, id, label, icon, tag]) =>
        `<a href="${href}" class="${PAGE === id ? "on" : ""}"><svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>${label}${tag ? `<span class="tag">${tag}</span>` : ""}</a>`).join("") +

      `</div>`;
  }

  function popCard(pop) {
    if (!pop) return `<section class="frame"><h3>Population</h3><div class="body note">No data yet.</div></section>`;
    const hc = pop.hardcore_worlds_listed;
    const series = pop.history.slice(-144).map(p => hc ? p[1] : p[2]).filter(v => v != null);
    const max = Math.max(...series, 1), min = Math.min(...series, max);
    const pts = series.map((v, i) => `${(i / Math.max(series.length - 1, 1)) * 200},${54 - ((v - min) / Math.max(max - min, 1)) * 48}`).join(" ");
    const worlds = (pop.worlds || []).slice(0, 5);
    const top = Math.max(...worlds.map(w => w.players), 1);
    return `<section class="frame"><h3>${hc ? "Still Breathing" : "Gielinor Tonight"}</h3><div class="body">
      <div class="hg">
        <svg viewBox="0 0 46 70" aria-hidden="true"><path d="M6 3h34M6 67h34" stroke="#d4a65a" stroke-width="3"/>
          <path d="M9 5c0 16 12 20 14 30-2 10-14 14-14 30h28c0-16-12-20-14-30 2-10 14-14 14-30z" fill="#0b0907" stroke="#d4a65a" stroke-width="2"/>
          <path d="M13 12h20c-2 8-8 12-10 16-2-4-8-8-10-16z" fill="#ffff00" opacity=".85"/>
          <path class="sand" d="M23 30v30" stroke="#ffff00" stroke-width="1.5" stroke-dasharray="2 2"/>
          <path d="M12 63c3-6 8-8 11-9 3 1 8 3 11 9z" fill="#ffff00" opacity=".85"/></svg>
        <div><div class="pop-big">${fmt(hc ? pop.hardcore_total : pop.all_worlds_total)}</div>
          <div class="pop-sub">${hc ? "PLAYERS ON HARDCORE WORLDS NOW" : "PLAYERS ON ALL OSRS WORLDS NOW"}</div></div>
      </div>
      ${series.length > 1 ? `<svg class="spark" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">
        <polygon fill="rgba(255,255,0,.08)" points="0,56 ${pts} 200,56"/><polyline fill="none" stroke="#ffff00" stroke-width="2" points="${pts}"/></svg>` : ""}
      <div class="pop-sub">${hc ? `PEAK ${fmt(pop.peak_hardcore)}` : "HARDCORE WORLDS NOT ON THE WORLD LIST YET"}</div>
      ${worlds.length ? `<div class="worlds">${worlds.map(w =>
        `<div><span class="w">W${w.id} ${esc((w.region || "").slice(0, 2))}</span><span class="meter"><i style="width:${(w.players / top) * 100}%"></i></span><span>${fmt(w.players)}</span></div>`).join("")}</div>` : ""}
      <a class="note" href="population.html" style="display:block;color:var(--chat-cyan)">Population history →</a>
    </div></section>`;
  }

  function watchCard(w, gy) {
    const pill = (ok, wait) => ok ? `<span class="pill ok">LIVE</span>` : `<span class="pill wait">${wait}</span>`;
    return `<section class="frame"><h3>Data Watcher</h3><div class="body status">
      <div>World list${pill(true)}</div>
      <div>HC hiscores${pill(w && w.hiscore_mode, "WAITING")}</div>
      <div>HC GE prices${pill(w && w.price_route, "WAITING")}</div>
      <div style="border:none;color:var(--muted);font-size:15px">Checked ${w && w.checked ? ago(Date.parse(w.checked)) : "—"}${gy && gy.last_full_scan ? ` · full scan ${ago(Date.parse(gy.last_full_scan))}` : ""}</div>
    </div></section>`;
  }

  const deathSpeaks = `<div class="chatbox"><span class="nm">Death:</span> <span class="r">Nightmare Zone, Pest Control and your own house will not save you. Only a handful of minigames are safe.</span></div>`;

  /* ---------------- graveyard ---------------- */
  function tier(d) {
    if (d.fate === "fallen") return "t-stone";
    const t = d.total || 0;
    if (t >= 1800) return "t-obelisk";
    if (t >= 1500) return "t-marble";
    if (t >= 500) return "t-stone";
    return "t-wood";
  }
  const BADGE = { died: ["reset", "DIED"], reset: ["reset", "RESET"], fallen: ["fallen", "FALLEN"] };

  function epitaph(d) {
    if (d.death_text) return d.death_text;
    const bits = [];
    const sk = (d.top_skills || [])[0];
    if (sk) bits.push(`${sk[1]} ${sk[0]}`);
    if (d.top_boss) bits.push(`${fmt(d.top_boss[1])} ${d.top_boss[0]} kills`);
    return bits.length ? `Fell with ${bits.join(" and ")}.` : "";
  }

  function where(d) {
    if (d.location_text) return d.location_text;
    const parts = [];
    if (d.world) parts.push(`W${d.world}`);
    if (d.location && !d.location.on_map) parts.push("instance");
    return parts.join(" · ");
  }

  function stone(d) {
    const t = tier(d), [cls, label] = BADGE[d.fate] || BADGE.died;
    const sk = (d.top_skills || []).slice(0, 2).map(s => `${s[0]} ${s[1]}`).join(" · ");
    const killer = d.player_killer ? "SLAIN BY A PLAYER" : "";
    const body = `
      <div class="rsn">${esc(d.name)}</div>
      <div class="lvl">${fmt(d.total)}${t === "t-obelisk" ? "" : " <small>total</small>"}</div>
      ${sk ? `<div class="last">${esc(sk.toUpperCase())}${d.top_boss ? `<br>${esc(d.top_boss[0].toUpperCase())} KC <b>${fmt(d.top_boss[1])}</b>` : ""}</div>` : ""}
      ${killer ? `<div class="killer">${killer}</div>` : ""}
      <div class="when ${d.time_exact ? "exact" : ""}" title="${new Date(d.time).toString()}">${when(d)}</div>
      ${where(d) ? `<div class="when">${esc(where(d))}</div>` : ""}
      <span class="badge ${cls}">${label}</span>`;
    const notable = d.notable ? `<span class="notable">NOTABLE</span>` : "";
    const run = d.run > 1 ? `<span class="run">#${d.run}</span>` : "";
    if (t === "t-wood")
      return `<div class="g t-wood" tabindex="0"><div class="face"><span class="shape"><i></i></span><div class="plaque">
        <div class="rsn">${esc(d.name)}</div><div class="lvl">${fmt(d.total)} <small>total</small></div>
        <div class="when" style="color:#5a4a33">${when(d)}${d.run > 1 ? " · #" + d.run : ""}</div></div></div></div>`;
    if (t === "t-obelisk")
      return `<div class="g t-obelisk" tabindex="0">${notable}<div class="face"><span class="shape"><i></i><i></i></span><div class="inner">${body}</div></div></div>`;
    return `<div class="g ${t}" tabindex="0">${notable}<div class="face">${run}${body}</div></div>`;
  }

  function memorial(deaths) {
    const now = Date.now();
    const pick = (since, label) => {
      const pool = deaths.filter(d => d.time >= since);
      if (!pool.length) return null;
      return [pool.reduce((a, b) => ((b.total || 0) > (a.total || 0) ? b : a)), label];
    };
    const got = pick(now - 864e5, "TODAY") || pick(now - 7 * 864e5, "THIS WEEK") || pick(0, "ALL TIME");
    if (!got) return `<div class="eyebrow">THE GRAVEYARD IS EMPTY</div>
      <div class="big-stone"><div class="rsn">No one. Yet.</div><div class="epitaph">"Every adventurer in Gielinor still draws breath. Death is patient."</div></div>
      <span class="candle" style="left:26px"></span><span class="candle" style="right:26px;height:26px"></span>`;
    const [d, label] = got;
    return `<div class="eyebrow">MOST NOTABLE DEATH · ${label}</div>
      <div class="big-stone">
        <div class="rsn">${esc(d.name)}</div>
        <div class="lvl">${fmt(d.total)} <small>total</small></div>
        ${epitaph(d) ? `<div class="epitaph">"${esc(epitaph(d))}"</div>` : ""}
        <div class="when">${when(d)}${d.run > 1 ? " · run #" + d.run : ""}${d.world ? " · W" + d.world : ""}</div>
      </div>
      <span class="candle" style="left:26px"></span><span class="candle" style="right:26px;height:26px"></span>`;
  }

  /* Until the Hardcore hiscores are live, show clearly labelled sample graves.
     The moment graveyard.json reports status "live", real data replaces them with no code change. */
  async function withPreview(real) {
    if (real && real.status === "live") return real;
    let sample;
    try { sample = await (await fetch("assets/sample-graveyard.json")).json(); } catch (e) { return real; }
    const now = Date.now();
    const deaths = sample.deaths.map(d => {
      const time = now - d.age_min * 60000;
      return { ...d, time, window_start: d.window_minutes ? time - d.window_minutes * 60000 : undefined };
    });
    const hours = new Array(24).fill(0);
    deaths.forEach(d => { const a = Math.floor((now - d.time) / 36e5); if (a < 24) hours[23 - a]++; });
    return {
      status: "preview", sample: true, deaths, deaths_per_hour: hours,
      counts: {
        today: deaths.filter(d => d.time >= now - 864e5).length,
        all_time: deaths.length,
        resets: deaths.filter(d => d.fate === "reset").length,
        highest_total: Math.max(...deaths.map(d => d.total)),
      },
    };
  }

  async function graveyard() {
    const [real, pop, w] = await Promise.all([load("graveyard.json"), load("population.json"), load("watcher.json")]);
    const gy = await withPreview(real);
    chrome(pop, gy.sample ? null : gy);
    if (gy.sample) {
      document.querySelector("main").insertAdjacentHTML("afterbegin",
        `<div class="preview-flag" role="note"><b>PREVIEW · SAMPLE GRAVES</b> Every name and number below is made up. Hardcore Worlds open 4 November; real deaths from the official hiscores replace these automatically.</div>`);
    }
    $("#rail").innerHTML = popCard(pop) + watchCard(w, gy.sample ? real : gy) + deathSpeaks;
    const deaths = (gy && gy.deaths) || [];
    const c = (gy && gy.counts) || {};
    $("#memorial").innerHTML = memorial(deaths);
    $("#tally").innerHTML = `
      <div><b class="red">${fmt(c.today || 0)}</b><span>FALLEN TODAY</span></div>
      <div><b>${fmt(c.all_time || 0)}</b><span>FALLEN ALL-TIME</span></div>
      <div><b class="blue">${fmt(c.resets || 0)}</b><span>RESETS DETECTED</span></div>
      <div><b class="yel">${c.highest_total ? fmt(c.highest_total) : "—"}</b><span>HIGHEST TOTAL LOST</span></div>`;
    const hours = (gy && gy.deaths_per_hour) || new Array(24).fill(0);
    const hmax = Math.max(...hours, 1);
    const worst = hours.indexOf(Math.max(...hours));
    $("#bars").innerHTML = hours.map(h => `<i style="height:${Math.max((h / hmax) * 100, 2)}%" title="${h}"></i>`).join("");
    $("#deadliest").textContent = Math.max(...hours) > 0 ? `PEAK: ${23 - worst}H AGO` : "";
    const recent = deaths.slice(0, 12);
    $("#ticker").innerHTML = recent.length
      ? recent.map(d => `<span class="bc">☠ </span><span class="nm">${esc(d.name)}</span><span class="bc"> ${d.fate === "reset" ? "reset" : "has fallen"} at total level ${fmt(d.total)}.</span> &nbsp;&nbsp; `).join("")
      : `<span class="bc">Death waits in his office. Hardcore Worlds open on 4 November.</span>`;

    const state = { range: "all", tier: "any", fate: "any", q: "", shown: 48 };
    const filters = $("#filters");
    filters.addEventListener("click", e => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      state[b.dataset.k] = state[b.dataset.k] === b.dataset.v && b.dataset.k !== "range" ? "any" : b.dataset.v;
      state.shown = 48;
      draw();
    });
    $("#search").addEventListener("input", e => { state.q = e.target.value.trim().toLowerCase(); state.shown = 48; draw(); });
    $("#more").addEventListener("click", () => { state.shown += 48; draw(); });

    function filtered() {
      const now = Date.now();
      return deaths.filter(d =>
        (state.range === "all" || d.time >= now - (state.range === "today" ? 864e5 : 7 * 864e5)) &&
        (state.tier === "any" || (state.tier === "2000" ? d.total >= 2000 : state.tier === "1500" ? d.total >= 1500 : d.total < 500)) &&
        (state.fate === "any" || d.fate === state.fate) &&
        (!state.q || d.name.toLowerCase().includes(state.q)));
    }

    function draw() {
      filters.querySelectorAll("[data-k]").forEach(b => b.classList.toggle("on", state[b.dataset.k] === b.dataset.v));
      const list = filtered();
      const yard = $("#rows");
      if (!gy || gy.status === "waiting") {
        yard.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>The gates open on 4 November</h3>
          <p>Hardcore Worlds launch on Wednesday. The moment Jagex publishes the Hardcore Worlds hiscores, this page starts reading them and the first stone goes up here, automatically.</p></div>`;
      } else if (!list.length) {
        yard.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>${deaths.length ? "No graves match" : "No graves yet"}</h3>
          <p>${deaths.length ? "Try a wider filter." : "The hiscores are being read. Everyone above the listing line is still alive."}</p></div>`;
      } else {
        yard.innerHTML = list.slice(0, state.shown).map(stone).join("");
      }
      $("#more").hidden = list.length <= state.shown;
      $("#ledger").innerHTML = list.slice(0, state.shown).map(d => `<tr>
        <td class="n">${esc(d.name)}</td><td class="y">${fmt(d.total)}</td><td class="hide-sm">${d.combat ?? "—"}</td>
        <td class="hide-sm">${esc((d.top_skills || []).map(s => s[0] + " " + s[1]).join(", "))}</td>
        <td style="color:${d.fate === "fallen" ? "#bbb" : "var(--chat-red)"}">${d.fate === "died" ? "Died" : d.fate === "reset" ? "Reset" : "Fallen"}</td>
        <td class="hide-sm">${d.world ? "W" + d.world : "—"}</td><td>${when(d)}</td></tr>`).join("") ||
        `<tr><td colspan="7" class="note">Nothing recorded yet.</td></tr>`;
    }
    $("#listing").innerHTML = gy && gy.status === "live"
      ? `Listing players with total level <b>${fmt(gy.min_total || 0)}+</b> · ${fmt(gy.ranked_players)} on the hiscores${gy.last_full_scan ? ` · last full scan ${ago(Date.parse(gy.last_full_scan))}` : ""}. <b>FALLEN</b> = left the hiscores; exact cause unknown.`
      : gy.sample ? `Showing <b>sample graves</b> until the Hardcore Worlds hiscores go live.` : "";
    draw();
  }

  /* ---------------- population ---------------- */
  async function population() {
    const [pop, gy] = await Promise.all([load("population.json"), load("graveyard.json")]);
    chrome(pop, gy);
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
        grid += `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#3a3328" stroke-dasharray="3 4"/><text x="4" y="${y(v) + 5}">${fmt(Math.round(v))}</text>`;
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
    chrome(pop, gy);
    const row = (label, ok, detail) => `<tr><td class="n">${label}</td><td>${ok ? '<span class="pill ok">FOUND</span>' : '<span class="pill wait">WAITING</span>'}</td><td>${detail}</td></tr>`;
    $("#sources").innerHTML =
      row("World list (RuneLite)", pop && pop.hardcore_worlds_listed, pop && pop.hardcore_worlds_listed ? `${(pop.worlds || []).length} Hardcore worlds listed` : "Live, but no Hardcore worlds on it yet") +
      row("Hardcore Worlds hiscores", w && w.hiscore_mode, w && w.hiscore_mode ? esc(w.hiscore_mode) : "Not published yet") +
      row("Hardcore GE prices (OSRS Wiki)", w && w.price_route, w && w.price_route ? "/api/v1/" + esc(w.price_route) : "Not published yet");
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

  ({ graveyard, population, watcher: watcherPage })[PAGE]();
})();
