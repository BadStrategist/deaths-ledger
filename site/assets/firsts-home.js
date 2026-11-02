/* Homepage World firsts feature: live counts and four headline firsts from data/firsts.json.
   Before launch the static markup already says "100 / 0 / unclaimed"; this only fills in real claims. */
(function () {
  "use strict";
  const box = document.getElementById("wf-feature");
  if (!box) return;
  const fmt = n => Number(n).toLocaleString("en-US");
  const ago = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + "m ago" : s < 129600 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago";
  };
  fetch(`data/firsts.json?t=${Math.floor(Date.now() / 60000)}`).then(r => (r.ok ? r.json() : null)).then(fx => {
    if (!fx || !fx.firsts) return;
    const total = fx.total_categories || 100;
    const list = Object.values(fx.firsts);
    document.getElementById("wf-total").textContent = fmt(total);
    document.getElementById("wf-claimed").textContent = fmt(list.length);
    document.getElementById("wf-open").textContent = fmt(Math.max(0, total - list.length));
    const maxId = `total-${fx.max_total || 2376}`;
    box.querySelectorAll("#wf-chips li").forEach(li => {
      const id = li.dataset.id === "total-2376" ? maxId : li.dataset.id;
      const f = fx.firsts[id];
      if (!f) return;
      li.classList.add("got");
      li.querySelector("span").textContent = (f.names || []).join(", ") || "Claimed";
    });
    const latest = list.filter(f => Date.parse(f.seen)).sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen))[0];
    if (latest) {
      document.getElementById("wf-latest").textContent = `Latest: ${latest.label}, ${(latest.names || [])[0] || ""} · ${ago(Date.parse(latest.seen))}`;
    } else if (fx.status === "live") {
      document.getElementById("wf-latest").textContent = "The race is on. Nothing claimed yet.";
    }
  }).catch(() => {});
})();
