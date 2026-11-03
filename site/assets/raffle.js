/* The Reaper's Raffle: all tasks, filterable, with progress saved on the device.
   Data from assets/raffle.json, parsed from Jagex's own task list. */
(function () {
  "use strict";
  var KEY = "dt_raffle_v1";
  var tabsEl = document.getElementById("tabs");
  var listEl = document.getElementById("list");
  var countEl = document.getElementById("count");
  var emptyEl = document.getElementById("empty");
  var searchEl = document.getElementById("search");
  var bonusEl = document.getElementById("bonus");
  var hideEl = document.getElementById("hideDone");
  var resetEl = document.getElementById("reset");
  var progEl = document.getElementById("progress");
  var barEl = document.getElementById("bar");
  var board = "All";
  var data = null;
  var done = {}, pins = {};

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}");
      done = s.done || {};
      pins = s.pins || {};
      hideEl.checked = !!s.hideDone;
    } catch (e) { done = {}; pins = {}; }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ done: done, pins: pins, hideDone: hideEl.checked }));
    } catch (e) { /* private mode: progress will not survive a reload */ }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function sum(tasks) { return tasks.reduce(function (a, t) { return a + t.entries; }, 0); }
  function isDone(t) { return done[t.id] === 1; }
  function isPinned(t) { return pins[t.id] === 1; }

  function match(t, q) {
    if (bonusEl.checked && t.entries < 2) return false;
    if (hideEl.checked && isDone(t)) return false;
    if (!q) return true;
    return (t.task + " " + t.id + " " + t.tags.join(" ")).toLowerCase().indexOf(q) !== -1;
  }

  function rowFor(t) {
    var row = el("div", "rf-row" + (isDone(t) ? " done" : ""));

    var pin = el("button", "rf-pin" + (isPinned(t) ? " on" : ""), isPinned(t) ? "\u2605" : "\u2606");
    pin.type = "button";
    pin.title = isPinned(t) ? "Unpin this task" : "Pin this task";
    pin.setAttribute("aria-pressed", String(isPinned(t)));
    pin.setAttribute("aria-label", (isPinned(t) ? "Unpin " : "Pin ") + t.task);
    pin.addEventListener("click", function () {
      if (isPinned(t)) delete pins[t.id]; else pins[t.id] = 1;
      save(); render();
    });
    row.appendChild(pin);

    var tick = el("input", "rf-tick");
    tick.type = "checkbox";
    tick.checked = isDone(t);
    tick.setAttribute("aria-label", "Mark done: " + t.task);
    tick.addEventListener("change", function () {
      if (tick.checked) done[t.id] = 1; else delete done[t.id];
      save(); render();
    });
    row.appendChild(tick);

    row.appendChild(el("span", "rf-id", t.id));

    var mid = el("div", "rf-mid");
    mid.appendChild(el("span", "rf-task", t.task));
    if (t.tags.length) mid.appendChild(el("span", "rf-tags", t.tags.join(" \u00b7 ")));
    row.appendChild(mid);

    row.appendChild(el("span", "rf-ent" + (t.entries > 1 ? " hot" : ""),
      t.entries + (t.entries === 1 ? " entry" : " entries")));
    return row;
  }

  function section(title, tasks) {
    listEl.appendChild(el("h2", "rf-board", title + " \u00b7 " + tasks.length +
      (tasks.length === 1 ? " task" : " tasks")));
    tasks.forEach(function (t) { listEl.appendChild(rowFor(t)); });
  }

  function render() {
    if (!data) return;
    var q = searchEl.value.trim().toLowerCase();
    var shown = 0, shownEntries = 0;
    listEl.textContent = "";

    var all = data.boards.reduce(function (a, b) { return a.concat(b.tasks); }, []);
    var doneTasks = all.filter(isDone);
    var raw = all.length ? doneTasks.length / all.length * 100 : 0;
    var pct = raw < 10 ? raw.toFixed(1) : String(Math.round(raw));
    barEl.style.width = raw + "%";
    progEl.textContent = doneTasks.length + " of " + all.length + " tasks done (" + pct + "%) \u00b7 " +
      sum(doneTasks).toLocaleString("en-US") + " of " + data.totalEntries.toLocaleString("en-US") + " entries earned";

    var pinned = (board === "All")
      ? all.filter(function (t) { return isPinned(t) && match(t, q); })
      : [];
    var pinnedIds = {};
    pinned.forEach(function (t) { pinnedIds[t.id] = 1; });
    if (pinned.length) {
      section("Pinned", pinned);
      shown += pinned.length; shownEntries += sum(pinned);
    }

    data.boards.forEach(function (b) {
      if (board !== "All" && b.name !== board) return;
      var hit = b.tasks.filter(function (t) { return !pinnedIds[t.id] && match(t, q); });
      if (!hit.length) return;
      var bd = b.tasks.filter(isDone).length;
      section(b.name + " (" + bd + " of " + b.tasks.length + " done)", hit);
      shown += hit.length; shownEntries += sum(hit);
    });

    emptyEl.hidden = shown > 0;
    countEl.textContent = shown + " of " + data.totalTasks + " tasks \u00b7 " +
      shownEntries.toLocaleString("en-US") + " of " + data.totalEntries.toLocaleString("en-US") + " entries shown";
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
  hideEl.addEventListener("change", function () { save(); render(); });
  resetEl.addEventListener("click", function () {
    if (!confirm("Clear every tick and pin on this device?")) return;
    done = {}; pins = {}; save(); render();
  });

  load();
  fetch("assets/raffle.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      data = d;
      data.totalTasks = d.boards.reduce(function (a, b) { return a + b.tasks.length; }, 0);
      data.totalEntries = sum(d.boards.reduce(function (a, b) { return a.concat(b.tasks); }, []));
      buildTabs();
      render();
    })
    .catch(function () { countEl.textContent = "The task list could not load. Reload the page."; });

  if (window.deathTollHeader) window.deathTollHeader(null);
})();
