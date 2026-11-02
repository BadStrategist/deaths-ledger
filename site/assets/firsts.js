/* Hardcore Worlds: Death Toll — World firsts page. Reads data/firsts.json (written by scraper/firsts.py),
   data/graveyard.json (to mark claimants who have since died) and assets/firsts-verified.json (optional pins).
   Every category is listed, claimed or not, so before launch this is the list of firsts nobody has yet. */
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
  const stamp = ms => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" }) + " " +
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  /* Category list, mirroring scraper/hiscores.py SKILLS and scraper/firsts.py TOTALS / RAIDS / BOSSES. */
  const SKILLS = ["Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic", "Cooking",
    "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting", "Smithing", "Mining",
    "Herblore", "Agility", "Thieving", "Slayer", "Farming", "Runecraft", "Hunter", "Construction", "Sailing"];
  const RAIDS = { 31: "Chambers of Xeric", 32: "Chambers of Xeric: Challenge Mode", 76: "Theatre of Blood",
    77: "Theatre of Blood: Hard Mode", 80: "Tombs of Amascut", 81: "Tombs of Amascut: Expert Mode", 78: "The Fractured Archive" };
  const BOSSES = { 20: "Abyssal Sire", 21: "Alchemical Hydra", 22: "Amoxliatl", 23: "Araxxor", 24: "Artio",
    25: "Barrows Chests", 26: "Brutus", 27: "Bryophyta", 28: "Callisto", 29: "Calvar'ion", 30: "Cerberus",
    33: "Chaos Elemental", 34: "Chaos Fanatic", 35: "Commander Zilyana", 36: "Corporeal Beast",
    37: "Crazy Archaeologist", 38: "Dagannoth Prime", 39: "Dagannoth Rex", 40: "Dagannoth Supreme",
    41: "Deranged Archaeologist", 42: "Doom of Mokhaiotl", 43: "Duke Sucellus", 44: "General Graardor",
    45: "Giant Mole", 46: "Grotesque Guardians", 47: "Hespori", 48: "Kalphite Queen", 49: "King Black Dragon",
    50: "Kraken", 51: "Kree'Arra", 52: "K'ril Tsutsaroth", 53: "Lunar Chests", 54: "Mad Angel",
    55: "Maggot King", 56: "Mimic", 57: "Nex", 58: "Nightmare", 59: "Phosani's Nightmare", 60: "Obor",
    61: "Phantom Muspah", 62: "Sarachnis", 63: "Scorpia", 64: "Scurrius", 65: "Shellbane Gryphon",
    66: "Skotizo", 67: "Sol Heredit", 68: "Spindel", 69: "Tempoross", 70: "The Gauntlet",
    71: "The Corrupted Gauntlet", 72: "The Hueycoatl", 73: "The Leviathan", 74: "The Royal Titans",
    75: "The Whisperer", 79: "Thermonuclear Smoke Devil", 82: "TzKal-Zuk",
    83: "TzTok-Jad", 84: "Vardorvis", 85: "Venenatis", 86: "Vet'ion", 87: "Vorkath", 88: "Wintertodt",
    89: "Yama", 90: "Zalcano", 91: "Zulrah" };

  function categories(maxTotal) {
    const byName = o => Object.entries(o).map(([t, label]) => ({ id: `kc-${t}`, label }));
    return [
      { cat: "total", title: "Total level", unit: "TOTAL",
        rows: [1000, 1500, 2000].map(t => ({ id: `total-${t}`, label: `${fmt(t)} total level` }))
          .concat({ id: `total-${maxTotal}`, label: "Max total level", sub: `${fmt(maxTotal)} total` }) },
      { cat: "99", title: "First 99s", unit: "XP", rows: SKILLS.map(s => ({ id: `99-${s.toLowerCase()}`, label: `99 ${s}` })) },
      { cat: "raid", title: "Raids", unit: "KC", rows: byName(RAIDS) },
      { cat: "boss", title: "Bosses", unit: "KC", rows: byName(BOSSES) },
    ];
  }

  const unitText = { total: "total", "99": "xp", raid: "kc", boss: "kc" };

  async function main() {
    const [fx, gy, pins] = await Promise.all([load(fresh("firsts.json")), load(fresh("graveyard.json")), load("assets/firsts-verified.json")]);
    const live = gy && gy.status === "live";
    deathTollHeader(live && gy.counts ? gy.counts.all_time : 0);

    const firsts = fx && fx.firsts && typeof fx.firsts === "object" ? fx.firsts : {};
    const verified = pins && typeof pins === "object" ? pins : {};
    const dead = new Set(live ? (gy.deaths || []).map(d => String(d.name || "").toLowerCase()) : []);
    const sections = categories(fx && fx.max_total ? fx.max_total : 99 * SKILLS.length);
    // Any first the pipeline adds later that this list doesn't know yet still shows, in its own section.
    const known = new Set(sections.flatMap(s => s.rows.map(r => r.id)));
    Object.values(firsts).forEach(f => {
      if (!f || known.has(f.id)) return;
      const sec = sections.find(s => s.cat === f.cat);
      if (sec) sec.rows.push({ id: f.id, label: f.label || f.id });
    });

    const all = sections.flatMap(s => s.rows);
    const claimed = all.filter(r => firsts[r.id]);
    const waiting = !fx || fx.status !== "live";
    $("#waiting").hidden = !(waiting && !claimed.length);

    const latest = claimed.map(r => firsts[r.id]).filter(f => Date.parse(f.seen)).sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen))[0];
    $("#tiles").innerHTML = `
      <div><span>CLAIMED</span><b>${fmt(claimed.length)}</b><em>of ${fmt(all.length)} world firsts</em></div>
      <div><span>UP FOR GRABS</span><b class="gold">${fmt(all.length - claimed.length)}</b><em>${claimed.length ? "still unclaimed" : "every one of them"}</em></div>
      <div><span>LATEST</span><b class="fx-latest">${latest ? esc(latest.label) : "—"}</b><em>${latest ? `${esc((latest.names || []).join(", "))} · ${ago(Date.parse(latest.seen))}` : "Nobody yet"}</em></div>`;

    const ui = { f: "all", q: "" };
    $("#filters").addEventListener("click", e => {
      const b = e.target.closest("[data-f]");
      if (b) { ui.f = b.dataset.f; draw(); }
    });
    $("#search").addEventListener("input", e => { ui.q = e.target.value.trim().toLowerCase(); draw(); });

    function who(f) {
      return (f.names || []).map(n => {
        const fell = dead.has(String(n).toLowerCase());
        return `<span class="fx-who${fell ? " fell" : ""}"><a class="pl-link" href="player.html?name=${encodeURIComponent(n)}">${esc(n)}</a>` +
          (fell ? `<img class="pix" src="assets/art/skull.png" width="25" height="25" alt="has since fallen" title="Has since fallen">` : "") + `</span>`;
      }).join(`<span class="fx-and">, </span>`);
    }

    function row(sec, r) {
      const f = firsts[r.id];
      const pin = verified[r.id];
      const ver = pin && /^https:\/\//.test(pin.url || "")
        ? ` <a class="fx-ver" href="${esc(pin.url)}" target="_blank" rel="noopener"${pin.note ? ` title="${esc(pin.note)}"` : ""}>Verified by Jagex ↗</a>` : "";
      const label = `<td class="c-first"><span class="fx-label">${esc(f ? f.label || r.label : r.label)}</span>${r.sub ? `<span class="fx-sub">${esc(r.sub)}</span>` : ""}</td>`;
      if (!f) {
        return `<tr class="open">${label}<td class="c-who"><span class="fx-open">Up for grabs</span></td>` +
          `<td class="c-val hide-sm">—</td><td class="c-when"><span class="tag grey">UNCLAIMED</span></td></tr>`;
      }
      const t = Date.parse(f.seen);
      const val = f.value == null ? "—" : `${fmt(f.value)} <small>${unitText[sec.cat] || ""}</small>`;
      const shared = (f.names || []).length > 1 ? `<span class="fx-sub">Seen together in one check</span>` : "";
      return `<tr class="got">${label}<td class="c-who">${who(f)}${ver}${shared}<span class="fx-sub show-sm">${val}</span></td>` +
        `<td class="c-val hide-sm">${val}</td>` +
        `<td class="c-when">${t ? `<span title="${esc(new Date(t).toString())}"><b>${ago(t)}</b><span class="fx-sub">${stamp(t)}</span></span>` : "—"}</td></tr>`;
    }

    function draw() {
      $("#filters").querySelectorAll("[data-f]").forEach(b => {
        const on = b.dataset.f === ui.f;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on);
      });
      const match = r => {
        const f = firsts[r.id];
        if (ui.f === "claimed" && !f) return false;
        if (ui.f === "open" && f) return false;
        if (!ui.q) return true;
        return r.label.toLowerCase().includes(ui.q) || (f && (f.names || []).some(n => String(n).toLowerCase().includes(ui.q)));
      };
      const html = sections.map(sec => {
        const rows = sec.rows.filter(match);
        if (!rows.length) return "";
        const got = sec.rows.filter(r => firsts[r.id]).length;
        return `<section class="frame fx-sec" id="fx-${sec.cat}">
          <h3>${esc(sec.title)}<span class="fx-count">${fmt(got)} / ${fmt(sec.rows.length)} claimed</span></h3>
          <table class="ledger fx-table">
            <thead><tr><th class="c-first">FIRST</th><th class="c-who">CLAIMED BY</th><th class="c-val hide-sm">${sec.unit}</th><th class="c-when">FIRST SPOTTED</th></tr></thead>
            <tbody>${rows.map(r => row(sec, r)).join("")}</tbody>
          </table></section>`;
      }).join("");
      $("#sections").innerHTML = html ||
        `<section class="frame"><div class="empty"><h3>Nothing matches</h3><p>${ui.f === "claimed" && !claimed.length ? "No first has been claimed yet." : "Try another name or a wider filter."}</p></div></section>`;
    }
    draw();

    const u = fx && Date.parse(fx.updated);
    $("#meta").innerHTML = !waiting && u
      ? `<b>${fmt(claimed.length)}</b> of ${fmt(all.length)} firsts claimed · updated ${ago(u)}.`
      : claimed.length ? `<b>${fmt(claimed.length)}</b> of ${fmt(all.length)} firsts claimed. Checks resume when the hiscores are back.` : "";
  }

  main();
})();
