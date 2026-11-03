/* The Reaper's Raffle: all tasks, filterable. Data from assets/raffle.json,
   parsed from Jagex's own task list (Newspost-Raffle-Tasks-V1.js). */
(function () {
  "use strict";
  var tabsEl = document.getElementById("tabs");
  var listEl = document.getElementById("list");
  var countEl = document.getElementById("count");
  var emptyEl = document.getElementById("empty");
  var searchEl = document.getElementById("search");
  var bonusEl = document.getElementById("bonus");
  var board = "All";
  var data = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function total(tasks) {
    return tasks.reduce(function (a, t) { return a + t.entries; }, 0);
  }

  function match(t, q) {
    if (bonusEl.checked && t.entries < 2) return false;
    if (!q) return true;
    return (t.task + " " + t.id + " " + t.tags.join(" ")).toLowerCase().indexOf(q) !== -1;
  }

  function render() {
    var q = searchEl.value.trim().toLowerCase();
    var shown = [];
    listEl.textContent = "";
    data.boards.forEach(function (b) {
      if (board !== "All" && b.name !== board) return;
      var hit = b.tasks.filter(function (t) { return match(t, q); });
      if (!hit.length) return;
      shown = shown.concat(hit);
      listEl.appendChild(el("h2", "rf-board", b.name + " · " + hit.length + (hit.length === 1 ? " task" : " tasks")));
      hit.forEach(function (t) {
        var row = el("div", "rf-row");
        row.appendChild(el("span", "rf-id", t.id));
        var mid = el("div");
        mid.appendChild(el("div", "rf-task", t.task));
        if (t.tags.length) mid.appendChild(el("div", "rf-tags", t.tags.join(" · ")));
        row.appendChild(mid);
        var badge = el("span", "rf-ent" + (t.entries > 1 ? " hot" : ""), t.entries + (t.entries === 1 ? " entry" : " entries"));
        row.appendChild(badge);
        listEl.appendChild(row);
      });
    });
    emptyEl.hidden = shown.length > 0;
    countEl.textContent = shown.length + " of " + data.totalTasks + " tasks · " + total(shown).toLocaleString("en-US") + " of " + data.totalEntries.toLocaleString("en-US") + " entries shown";
  }

  function buildTabs() {
    ["All"].concat(data.boards.map(function (b) { return b.name; })).forEach(function (name) {
      var b = el("button", "rf-tab", name);
      b.type = "button";
      b.setAttribute("aria-pressed", String(name === board));
      b.addEventListener("click", function () {
        board = name;
        Array.prototype.forEach.call(tabsEl.children, function (c) {
          c.setAttribute("aria-pressed", String(c === b));
        });
        render();
      });
      tabsEl.appendChild(b);
    });
  }

  searchEl.addEventListener("input", render);
  bonusEl.addEventListener("change", render);

  fetch("assets/raffle.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      data = d;
      data.totalTasks = d.boards.reduce(function (a, b) { return a + b.tasks.length; }, 0);
      data.totalEntries = total(d.boards.reduce(function (a, b) { return a.concat(b.tasks); }, []));
      buildTabs();
      render();
    })
    .catch(function () {
      countEl.textContent = "The task list could not load. Reload the page.";
    });

  if (window.deathTollHeader) window.deathTollHeader(null);
})();
