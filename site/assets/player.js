/* Hardcore Worlds: Death Toll — player page (player.html?name=...). Track status and the player's live
   hiscore entry come from the Worker (worker/); graves come from data/graveyard.json. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const API = ((document.querySelector('meta[name="dt-api"]') || {}).content || "").replace(/\/$/, "");
  const NAME_OK = /^[A-Za-z0-9 _-]{1,12}$/;
  const fmt = n => (n == null || n < 0 ? "—" : Number(n).toLocaleString("en-US"));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = n => String(n).replace(/[\s_-]+/g, " ").trim().toLowerCase();
  const when = ms => new Date(ms).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const FATE = { died: "Died", reset: "Reset", banished: "Banished", fallen: "Banished?" };

  async function data(name) {
    try { const r = await fetch(`data/${name}?t=${Math.floor(Date.now() / 60000)}`); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  async function api(path, opts) {
    const r = await fetch(API + path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "The tracker didn't answer. Try again in a minute.");
    return j;
  }
  const say = (el, text, kind) => { el.textContent = text; el.className = "track-msg" + (kind ? " " + kind : ""); };

  function combat(lv) {
    const g = n => Math.max(lv[n] || 1, 1);
    const base = 0.25 * (g("Defence") + (lv.Hitpoints || 10) + Math.floor(g("Prayer") / 2));
    return Math.floor(base + Math.max(0.325 * (g("Attack") + g("Strength")), 0.325 * Math.floor(g("Ranged") * 3 / 2), 0.325 * Math.floor(g("Magic") * 3 / 2)));
  }
  function place(v) {
    if (v == null || v < 0) return null;
    const x = (v >> 14) & 16383, y = v & 16383, plane = v >>> 28;
    if (x < 1000 || x > 4200) return "inside an instance (a boss room, raid or minigame)";
    return `at ${x}, ${y}${plane ? `, floor ${plane}` : ""}${y >= 6400 ? " (underground)" : ""}`;
  }

  // ---- search box: always takes you to the player's page ----
  $("#find").addEventListener("submit", e => {
    e.preventDefault();
    const n = $("#find-name").value.replace(/\s+/g, " ").trim();
    if (!NAME_OK.test(n)) { say($("#find-msg"), "RuneScape names are 1 to 12 letters, numbers, spaces, - or _.", "bad"); return; }
    location.href = `player.html?name=${encodeURIComponent(n)}`;
  });

  async function main() {
    const name = (new URLSearchParams(location.search).get("name") || "").replace(/\s+/g, " ").trim();
    const [w, gy] = await Promise.all([data("watcher.json"), data("graveyard.json")]);
    const live = gy && gy.status === "live";
    deathTollHeader(live && gy.counts ? gy.counts.all_time : 0);
    if (!name) { $("#find-name").focus(); return; }
    if (!NAME_OK.test(name)) { say($("#find-msg"), "That isn't a valid RuneScape name.", "bad"); return; }

    $("#find-name").value = name;
    document.title = `${name} · Death Toll`;
    $("#profile").hidden = false;
    $("#pl-name").textContent = name;
    const mode = w && w.hiscore_mode;
    const graves = live ? (gy.deaths || []).filter(d => key(d.name) === key(name)) : [];

    // tracked?
    let tracked = null;
    try { tracked = await api(`/tracked?name=${encodeURIComponent(name)}`); } catch (e) { /* badge just stays off */ }
    const badges = [];
    const btn = $("#pl-track");
    function drawBadges(extra) {
      const b = [...badges];
      if (tracked && tracked.tracked) b.unshift(`<span class="tag pl-on">TRACKED${tracked.added_at ? " · SINCE " + esc(new Date(tracked.added_at).toLocaleDateString([], { day: "numeric", month: "short" }).toUpperCase()) : ""}</span>`);
      else if (tracked) b.unshift(`<span class="tag sample">NOT TRACKED</span>`);
      $("#pl-badges").innerHTML = b.concat(extra || []).join(" ");
      btn.hidden = !(tracked && !tracked.tracked);
    }
    drawBadges();
    btn.addEventListener("click", async () => {
      btn.disabled = true; say($("#pl-msg"), "Adding…");
      try {
        const j = await api("/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        tracked = { tracked: true, added_at: Date.now(), name: j.name };
        say($("#pl-msg"), mode ? `Now tracking ${j.name}. If they fall, their grave goes up on the Graveyard.` : `Now tracking ${j.name}. We start checking the moment the Hardcore Worlds hiscores open.`, "ok");
        drawBadges(badges.extra);
      } catch (err) { say($("#pl-msg"), err.message, "bad"); }
      finally { btn.disabled = false; }
    });
    $("#pl-copy").addEventListener("click", async () => {
      const url = `${location.origin}${location.pathname}?name=${encodeURIComponent(name)}`;
      try { await navigator.clipboard.writeText(url); say($("#pl-msg"), "Link copied.", "ok"); } catch (e) { say($("#pl-msg"), url); }
    });

    // graves (from the graveyard)
    if (graves.length) {
      $("#pl-graves-wrap").hidden = false;
      $("#pl-graves").innerHTML = graves.map(d => `<tr><td class="n">${FATE[d.fate] || "Died"}${d.run > 1 ? ` <small>(life #${d.run})</small>` : ""}</td>
        <td class="y">${fmt(d.total)}</td><td class="hide-sm">${d.world ? "W" + d.world : "—"}</td><td>${when(d.time)}</td></tr>`).join("");
      badges.push(`<span class="tag">FALLEN ${graves.length > 1 ? "×" + graves.length : ""}</span>`);
      drawBadges();
    }

    if (!mode) {
      $("#pl-sub").textContent = "The Hardcore Worlds hiscores open on 4 November. This player's stats, skills and bosses appear here then.";
      return;
    }

    // live hiscore entry
    let res;
    try { res = await api(`/player?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(name)}`); }
    catch (e) { $("#pl-sub").textContent = e.message; return; }
    if (!res.found) {
      $("#pl-sub").textContent = graves.length ? "No longer on the Hardcore Worlds hiscores." : "Not on the Hardcore Worlds hiscores yet.";
      return;
    }
    const p = res.player, skills = p.skills || [];
    const overall = skills.find(s => s.name === "Overall") || {};
    const lv = Object.fromEntries(skills.map(s => [s.name, s.level]));
    const death = overall.death;
    if (!graves.length) badges.push(death ? `<span class="tag">FALLEN</span>` : `<span class="tag pl-alive">ALIVE</span>`);
    drawBadges();
    $("#pl-sub").textContent = `Overall rank ${fmt(overall.rank)} on the Hardcore Worlds hiscores.`;
    $("#pl-tiles").innerHTML = [["TOTAL LEVEL", fmt(overall.level)], ["COMBAT", fmt(combat(lv))], ["TOTAL XP", fmt(overall.xp)], ["OVERALL RANK", fmt(overall.rank)]]
      .map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");

    if (death && death.timeStamp > 0) {
      $("#pl-death").hidden = false;
      const where = place(death.location);
      $("#pl-death-body").innerHTML = `<p><b>${when(death.timeStamp)}</b>${death.worldID > 0 ? ` on world <b>${death.worldID}</b>` : ""}${where ? `, ${esc(where)}` : ""}.</p>`;
    }

    const shown = skills.filter(s => s.name !== "Overall");
    $("#pl-skills-wrap").hidden = !shown.length;
    $("#pl-skills").innerHTML = shown.map(s => `<tr><td class="n">${esc(s.name)}</td><td class="y">${fmt(s.level)}</td><td>${fmt(s.xp)}</td><td class="hide-sm">${fmt(s.rank)}</td></tr>`).join("");
    const acts = (p.activities || []).filter(a => a.score > 0).sort((a, b) => b.score - a.score);
    $("#pl-bosses-wrap").hidden = !acts.length;
    $("#pl-bosses").innerHTML = acts.map(a => `<tr><td class="n">${esc(a.name)}</td><td class="y">${fmt(a.score)}</td><td class="hide-sm">${fmt(a.rank)}</td></tr>`).join("");
  }
  main();
})();
