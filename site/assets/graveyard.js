/* Hardcore Worlds: Death Toll — the Graveyard.
   Shared headstone card (also used by the homepage "Latest graves" strip, via window.DeathTollGraves)
   and the obituary feed on graveyard.html: newest first, grouped by clock hour in the viewer's time zone.
   Before launch data/graveyard.json says "waiting" and clearly labelled sample graves are shown instead. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HOUR = 3600000, DAY = 864e5;

  async function load(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  const data = name => load(`data/${name}?t=${Math.floor(Date.now() / 60000)}`);

  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 129600) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  const full = ms => new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const h12 = (() => { try { return new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions().hour12; } catch (e) { return false; } })();

  /* "Wed 4 Nov · 7–8pm" (or "Wed 4 Nov · 19:00–20:00") in the viewer's own time zone and clock style. */
  function hourParts(start) {
    const a = new Date(start), b = new Date(start + HOUR);
    const date = a.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
    if (!h12) {
      const hm = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      return [date, `${hm(a)}–${hm(b)}`];
    }
    const h = d => (d.getHours() % 12 || 12), ap = d => (d.getHours() < 12 ? "am" : "pm");
    return [date, `${h(a)}${ap(a) === ap(b) ? "" : ap(a)}–${h(b)}${ap(b)}`];
  }
  const hourSpan = start => hourParts(start).join(" ");

  /* Until the Hardcore hiscores are live, use clearly labelled sample graves.
     The moment graveyard.json reports status "live", real data replaces them with no code change. */
  async function withPreview(real) {
    if (real && real.status === "live") return real;
    const sample = await load("assets/sample-graveyard.json");
    if (!sample) return real;
    const now = Date.now();
    const deaths = sample.deaths.map(d => {
      const time = now - d.age_min * 60000;
      return { ...d, sample: true, time, window_start: d.window_minutes ? time - d.window_minutes * 60000 : undefined };
    });
    return {
      status: "preview", sample: true, deaths,
      counts: {
        today: deaths.filter(d => d.time >= now - DAY).length,
        all_time: deaths.length,
        resets: deaths.filter(d => d.fate === "reset").length,
        highest_total: Math.max(...deaths.map(d => d.total)),
      },
    };
  }

  /* Region names (assets/map-regions.json), keyed like the death map: ((x >> 6) << 8) | (y >> 6). */
  let regionsP;
  const regions = () => (regionsP ||= load("assets/map-regions.json").then(f => (f && f.regions) || {}));
  const regionOf = (x, y) => ((x >> 6) << 8) | (y >> 6);

  /* ---------------- the headstone card ---------------- */
  const ART = t => t >= 1800 ? ["Gravestone_Draynor_Manor", 140] : t >= 500 ? ["Grave", 246] : ["Grave_Haunted_Woods", 207];
  const FATE = {
    died: ["died", "Died", ""],
    reset: ["reset", "Started over", "Reset their account after dying, and started again from scratch."],
    banished: ["moved", "Moved to main game", "Died, then their account moved to the main game."],
    fallen: ["gone", "Gone, transfer unconfirmed", "Left the Hardcore Worlds hiscores after dying. The move to the main game is not confirmed yet."],
  };
  const isBig = d => (d.total || 0) >= 1800 || !!d.notable;

  function where(d, names) {
    const loc = d.location;
    if (loc && loc.on_map && Number.isFinite(loc.x) && Number.isFinite(loc.y)) {
      const n = names && names[regionOf(loc.x, loc.y)];
      if (n) return n;
    }
    return d.location_text || "";
  }

  function whenTip(d) {
    if (!d.time) return "";
    if (d.time_exact) return full(d.time);
    if (d.window_start) return `Between ${full(d.window_start)} and ${full(d.time)}`;
    return `Noticed by ${full(d.time)}`;
  }

  function card(d, names, opts = {}) {
    const t = d.total || 0, [art, w] = ART(t), [fcls, flabel, ftip] = FATE[d.fate] || FATE.died;
    const big = !opts.small && isBig(d);
    const skills = (d.top_skills || []).slice(0, big ? 3 : 1).map(s => `${esc(s[0])} <b>${fmt(s[1])}</b>`).join(" · ");
    const place = where(d, names);
    const name = d.sample ? esc(d.name) : `<a class="pl-link" href="/player?name=${encodeURIComponent(d.name)}">${esc(d.name)}</a>`;
    return `<article class="stone${big ? " big" : ""}${isBig(d) ? " gilded" : ""} f-${fcls}">
      <img class="stone-art" src="assets/art/${art}.webp" width="${w}" height="320" alt="" loading="lazy">
      <div class="stone-body">
        <h3 class="stone-name">${name}${d.sample ? ` <span class="tag sample">SAMPLE</span>` : ""}</h3>
        <div class="stone-lvl"><b>${fmt(t)}</b> <small>total</small>${d.combat != null ? `<span class="stone-cb">Combat <b>${fmt(d.combat)}</b></span>` : ""}</div>
        ${skills ? `<div class="stone-sk">${big ? "" : "Best: "}${skills}</div>` : ""}
        ${big && d.top_boss ? `<div class="stone-sk">${esc(d.top_boss[0])} kills <b>${fmt(d.top_boss[1])}</b></div>` : ""}
        ${d.player_killer ? `<div class="stone-pk">Slain by a player</div>` : ""}
        ${place ? `<div class="stone-where">${esc(place)}</div>` : ""}
        <div class="stone-foot">
          ${d.time ? `<time datetime="${new Date(d.time).toISOString()}" title="${esc(whenTip(d))}">${d.time_exact ? "" : "~"}${ago(d.time)}</time>` : ""}
          ${d.world ? `<span class="stone-w">World ${esc(d.world)}</span>` : ""}
          <span class="fate f-${fcls}"${ftip ? ` title="${esc(ftip)}"` : ""}>${flabel}</span>
        </div>
      </div>
    </article>`;
  }

  window.DeathTollGraves = { withPreview, regions, card, hourSpan, load: data };

  /* ---------------- graveyard.html: the obituary feed ---------------- */
  const PAGE_SIZE = 150;

  async function feed() {
    const [real, names] = await Promise.all([data("graveyard.json"), regions()]);
    const gy = await withPreview(real);
    deathTollHeader(gy && gy.sample ? (real && real.counts ? real.counts.all_time : 0) : (gy && gy.counts ? gy.counts.all_time : 0));
    const deaths = ((gy && gy.deaths) || []).filter(d => Number.isFinite(d.time)).sort((a, b) => b.time - a.time);
    const sample = !!(gy && gy.sample);
    const live = !!(gy && gy.status === "live");
    // No preview banner: the owner wants sample graves marked only by their SAMPLE tags.

    // True toll per clock hour, from every published death, whatever the filters show.
    const hourKey = ms => { const x = new Date(ms); x.setMinutes(0, 0, 0); return x.getTime(); };
    const tollByHour = new Map();
    for (const d of deaths) { const k = hourKey(d.time); tollByHour.set(k, (tollByHour.get(k) || 0) + 1); }

    summary(gy, deaths, sample, live);
    listing(gy, sample);

    const state = { range: "today", min: 0, q: "", shown: PAGE_SIZE };   // opens on today's dead, like the homepage did
    const tabs = $("#gy-range"), lvl = $("#gy-level"), q = $("#gy-search"), rows = $("#feed"), more = $("#gy-more");
    tabs.addEventListener("click", e => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      state.range = b.dataset.v; state.shown = PAGE_SIZE; draw();
    });
    lvl.addEventListener("change", () => { state.min = +lvl.value || 0; state.shown = PAGE_SIZE; draw(); });
    q.addEventListener("input", () => { state.q = q.value.trim().toLowerCase(); state.shown = PAGE_SIZE; draw(); });
    more.addEventListener("click", () => { state.shown += PAGE_SIZE; draw(); });

    function filtered() {
      const now = Date.now(), cut = state.range === "all" ? -Infinity : now - (state.range === "today" ? DAY : 7 * DAY);
      return deaths.filter(d => d.time >= cut && (d.total || 0) >= state.min && (!state.q || String(d.name).toLowerCase().includes(state.q)));
    }

    function draw() {
      tabs.querySelectorAll("[data-v]").forEach(b => { const on = b.dataset.v === state.range; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      const list = filtered();
      const narrowed = state.min > 0 || !!state.q;
      if (!list.length) {
        const quietToday = state.range === "today" && !narrowed;
        rows.innerHTML = `<div class="empty"><h3>${quietToday ? "No one has fallen today. Yet." : deaths.length ? "No graves match" : "No graves yet"}</h3>
          <p>${quietToday ? (deaths.length ? "Tap This week or All time to see earlier graves." : "The hiscores are being read. Everyone above the listing line is still alive.")
            : deaths.length ? "Try a wider filter." : "The hiscores are being read. Everyone above the listing line is still alive."}</p></div>`;
        more.hidden = true;
        return;
      }
      const shown = list.slice(0, state.shown);
      const inView = new Map();
      for (const d of list) { const k = hourKey(d.time); inView.set(k, (inView.get(k) || 0) + 1); }
      let html = "", open = null;
      for (const d of shown) {
        const k = hourKey(d.time);
        if (k !== open) {
          if (open !== null) html += `</div></section>`;
          open = k;
          const n = tollByHour.get(k) || 0, m = inView.get(k) || 0, [date, span] = hourParts(k);
          html += `<section class="hour"><h2 class="hour-h"><span class="hour-t">${esc(date)} · ${esc(span)}</span>
            <span class="hour-n">Death claimed <b>${fmt(n)}</b> ${n === 1 ? "life" : "lives"}${m < n ? `<em> · ${fmt(m)} shown</em>` : ""}${sample ? ` <span class="tag sample">SAMPLE</span>` : ""}</span></h2><div class="stones">`;
        }
        html += card(d, names);
      }
      html += `</div></section>`;
      rows.innerHTML = html;
      const left = list.length - shown.length;
      more.hidden = left <= 0;
      if (left > 0) more.textContent = `Show older (${fmt(left)} more)`;
    }
    draw();
  }

  function summary(gy, deaths, sample, live) {
    const box = $("#gy-summary");
    const now = Date.now(), today = deaths.filter(d => d.time >= now - DAY);
    const c = (gy && gy.counts) || {};
    const n = live && Number.isFinite(c.today) ? c.today : today.length;
    const parts = [];
    if (live || sample) parts.push(n ? `Death claimed <b>${fmt(n)}</b> ${n === 1 ? "life" : "lives"} today` : `Death has claimed no one today`);
    const top = today.reduce((a, d) => (!a || (d.total || 0) > (a.total || 0) ? d : a), null);
    if (top && top.total) parts.push(`Biggest loss: <b>${esc(top.name)}</b> (${fmt(top.total)})`);
    const worst = live ? c.deadliest_hour : null, ws = worst && Date.parse(worst.start);
    if (ws && worst.deaths) parts.push(`Deadliest hour: <b>${esc(hourSpan(ws))}</b> (${fmt(worst.deaths)} ${worst.deaths === 1 ? "life" : "lives"})`);
    box.hidden = !parts.length;
    box.innerHTML = (sample ? `<span class="tag sample">SAMPLE</span> ` : "") + parts.map(p => `<span>${p}</span>`).join(`<i aria-hidden="true">·</i>`);
  }

  function listing(gy, sample) {
    const ago_ = s => ago(Date.parse(s));
    $("#listing").innerHTML = gy && gy.status === "live"
      ? `Listing players with total level <b>${fmt(gy.min_total || 0)}+</b> · ${fmt(gy.ranked_players)} on the hiscores${gy.last_full_scan ? ` · last full scan ${ago_(gy.last_full_scan)}` : ""}.`
      : sample ? `Showing <b>sample graves</b> until the Hardcore Worlds hiscores go live.` : "";
  }

  if (document.getElementById("feed")) feed();
})();
