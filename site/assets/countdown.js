/* Hero countdown to Hardcore Worlds opening: 11:00 UTC on Wed 4 Nov 2026 (6am ET), per Jagex's
   @OldSchoolRS post of 2 Nov 2026. If Jagex moves it, change data-at in index.html.
   After the moment it says "opening now" for two hours, then hides. Hover shows the time in the visitor's zone. */
(function () {
  var box = document.getElementById("countdown");
  if (!box) return;
  var at = Date.parse(box.getAttribute("data-at"));
  if (isNaN(at)) { box.hidden = true; return; }
  var el = {};
  ["d", "h", "m", "s"].forEach(function (k) { el[k] = document.getElementById("cd-" + k); });
  try {
    box.title = "Launches " + new Date(at).toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short"
    });
  } catch (e) { box.title = "Launches Wed 4 Nov, 6:00 AM EST"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var timer;
  function tick() {
    var left = at - Date.now();
    if (left <= -2 * 3600e3) { box.hidden = true; clearInterval(timer); return; }
    if (left <= 0) {
      box.classList.add("now");
      box.querySelector(".cd-k").textContent = "Hardcore Worlds launch";
      box.querySelector(".cd-units").textContent = "now";
      clearInterval(timer);
      return;
    }
    var s = Math.floor(left / 1000);
    el.d.textContent = pad(Math.floor(s / 86400));
    el.h.textContent = pad(Math.floor(s / 3600) % 24);
    el.m.textContent = pad(Math.floor(s / 60) % 60);
    el.s.textContent = pad(s % 60);
  }
  box.hidden = false;
  tick();
  timer = setInterval(tick, 1000);
})();
