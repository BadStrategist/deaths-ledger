/* Hardcore Worlds: Death Toll — the one site header, shared by every page.
   Pages call deathTollHeader(fallen) once they know the death count (null = hide the counter).
   Wide screens: main links inline plus a "More" dropdown. Phones and tablets: one "Menu" dropdown with every page. */
(function () {
  "use strict";
  const MAIN = [["index.html", "graveyard", "Graveyard"], ["hiscores.html", "hiscores", "Hiscores"], ["map.html", "map", "Death map"],
    ["ge.html", "ge", "GE tracker"], ["population.html", "population", "Population"]];
  const MORE = [["kept.html", "kept", "Kept on death"], ["safe.html", "safe", "Is it safe?"],
    ["tombstone.html", "tombstone", "Tombstone maker"], ["watcher.html", "watcher", "Data watcher"]];
  const page = document.body.dataset.page;
  const link = ([href, id, label]) => `<a href="${href}"${page === id ? ' class="on" aria-current="page"' : ""}>${label}</a>`;
  const inMore = MORE.some(([, id]) => id === page);

  function closeAll(except) {
    document.querySelectorAll("#top [aria-expanded=true]").forEach(b => {
      if (b === except) return;
      b.setAttribute("aria-expanded", "false");
      document.getElementById(b.getAttribute("aria-controls")).hidden = true;
    });
  }

  window.deathTollHeader = function (fallen) {
    const top = document.getElementById("top");
    if (!top) return;
    top.innerHTML = `
      <img class="hg pix" src="assets/art/hourglass.png" width="13" height="31" alt="">
      <a class="brand" href="index.html"><small>HARDCORE WORLDS</small><b>Death Toll</b></a>
      <nav class="nav" aria-label="Main">${MAIN.map(link).join("")}
        <div class="nav-drop-wrap"><button class="nav-btn${inMore ? " on" : ""}" type="button" aria-expanded="false" aria-controls="nav-more">More <span aria-hidden="true">▾</span></button>
          <div class="nav-drop" id="nav-more" hidden>${MORE.map(link).join("")}</div></div>
      </nav>
      ${fallen == null ? "" : `<div class="count" title="Deaths recorded from the Hardcore Worlds hiscores"><img class="pix" src="assets/art/skull.png" width="25" height="25" alt="">${Number(fallen).toLocaleString("en-US")} fallen</div>`}
      <button class="nav-btn nav-menu" type="button" aria-expanded="false" aria-controls="nav-all">Menu <span aria-hidden="true">▾</span></button>
      <nav class="nav-drop nav-all" id="nav-all" aria-label="All pages" hidden>${MAIN.concat(MORE).map(link).join("")}</nav>`;
    top.querySelectorAll(".nav-btn").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const open = b.getAttribute("aria-expanded") !== "true";
      closeAll(b);
      b.setAttribute("aria-expanded", String(open));
      document.getElementById(b.getAttribute("aria-controls")).hidden = !open;
    }));
  };

  document.addEventListener("click", e => { if (!e.target.closest(".nav-drop")) closeAll(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });
})();
