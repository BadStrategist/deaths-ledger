// Writes site/assets/sample-hiscores.json: made-up rankings for the Hiscores preview.
// Every name and number is fake. Run: node tools/make-sample-hiscores.js
"use strict";
const fs = require("fs");
const path = require("path");

const NAMES = ["Placeholder One", "Sample Name", "Example Player", "Not A Real Acct", "Fake Account", "Dummy Row Six",
  "Preview Only", "Test Iron", "Placeholder Two", "Made Up Name", "Sample Eleven", "Fictional Guy", "Example Twelve",
  "Lorem Ipsum", "Dolor Sit", "Placeholder Three", "Sample Row", "Nobody Real", "Fake Name Two", "Mock Player"];
const SKILLS = ["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Magic", "Prayer", "Slayer"];
const N = 50;
const UPDATED = Date.parse("2026-11-06T12:00:00Z");

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const name = i => NAMES[i] || `Sample ${String(i + 1).padStart(2, "0")}`;
const xpFor = lvl => { let p = 0; for (let l = 1; l < lvl; l++) p += Math.floor(l + 300 * 2 ** (l / 7)); return Math.floor(p / 4); };
const DEAD = new Set([1, 4, 9, 13, 17, 22, 26, 31, 38, 44]);

let total = 1712;
const overall = Array.from({ length: N }, (_, i) => {
  total -= Math.floor(rnd() * 14);
  const dead = DEAD.has(i);
  return {
    rank: i + 1, name: name(i), total, xp: Math.round(total * total * 5.1 + rnd() * 90000), dead,
    died_at: dead ? new Date(UPDATED - Math.round((0.3 + rnd() * 40) * 3600e3)).toISOString().replace(/\.\d+Z$/, "Z") : null,
  };
});

const skills = {};
for (const s of SKILLS) {
  const order = overall.slice(0, 30).map(r => ({ r, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, 25);
  let lvl = 92 + Math.floor(rnd() * 6);
  skills[s] = order.map(({ r }, i) => {
    if (i && rnd() < .45) lvl = Math.max(60, lvl - 1);
    return { rank: i + 1, name: r.name, level: lvl, xp: xpFor(lvl) + Math.floor(rnd() * 40000), dead: r.dead };
  }).sort((a, b) => b.xp - a.xp).map((row, i) => ({ ...row, rank: i + 1 }));
}

const out = {
  status: "sample",
  sample: true,
  updated: new Date(UPDATED).toISOString().replace(/\.\d+Z$/, "Z"),
  mode: null,
  notes: "SAMPLE DATA for the pre-launch preview. Every name and number is made up. Shown only while data/hiscores.json is missing or not live.",
  overall,
  skills,
};
fs.writeFileSync(path.join(__dirname, "..", "site", "assets", "sample-hiscores.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${N} overall rows, ${SKILLS.length} skills`);
