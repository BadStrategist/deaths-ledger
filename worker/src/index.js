// Death Toll tracking API (Cloudflare Worker + D1).
//   POST /track   {"name": "..."}  add a player to the tracked list (validated, rate limited per visitor)
//   GET  /names                    every tracked name, for the pipeline to poll
//   GET  /count                    how many players are tracked (for the site)
//   GET  /tracked?name=            is this player tracked (and since when)
//   GET  /player?mode=&name=       one player's hiscore entry, for the site's player page (cached 5 min)
//   GET  /probe                    which Jagex hiscore endpoints answer from Cloudflare's network
//   GET  /hs?mode=&table=&page=    one hiscore ranking page, for the pipeline only (X-Ledger-Key header).
//                                  GitHub's servers get a 403 on these pages; Cloudflare's network does not.
const SITE_ORIGINS = ["https://deathtoll.gg", "https://www.deathtoll.gg"];
const NAME_RE = /^[A-Za-z0-9 _-]{1,12}$/;                 // OSRS display names: 12 chars, letters, digits, space, - and _
const PER_VISITOR_PER_HOUR = 20;
const MAX_TRACKED = 100000;

const key = name => name.replace(/[\s_-]+/g, " ").trim().toLowerCase();

function cors(req, extra = {}) {
  const origin = req.headers.get("Origin") || "";
  const ok = SITE_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { "Access-Control-Allow-Origin": ok ? origin : SITE_ORIGINS[0], "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...extra };
}
const json = (req, body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: cors(req, { "Content-Type": "application/json", ...extra }) });

async function visitorHash(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const day = new Date().toISOString().slice(0, 10);                // rotates daily; raw IPs are never stored
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + day));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function track(req, env) {
  let body;
  try { body = await req.json(); } catch { return json(req, { ok: false, error: "Send a name." }, 400); }
  const name = String(body && body.name || "").replace(/\s+/g, " ").trim();
  if (!NAME_RE.test(name)) return json(req, { ok: false, error: "That isn't a valid RuneScape name (1 to 12 letters, numbers, spaces, - or _)." }, 400);
  const k = key(name), now = Date.now();
  const existing = await env.DB.prepare("SELECT name FROM tracked WHERE key = ?").bind(k).first();
  if (existing) return json(req, { ok: true, name: existing.name, already: true });

  const who = await visitorHash(req);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM tracked WHERE added_by = ? AND added_at > ?").bind(who, now - 3600000).first();
  if (recent.n >= PER_VISITOR_PER_HOUR) return json(req, { ok: false, error: "That's a lot of names for one hour. Try again later." }, 429);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM tracked").first();
  if (total.n >= MAX_TRACKED) return json(req, { ok: false, error: "The tracking list is full right now." }, 503);

  await env.DB.prepare("INSERT OR IGNORE INTO tracked (key, name, added_at, added_by) VALUES (?, ?, ?, ?)").bind(k, name, now, who).run();
  return json(req, { ok: true, name, already: false });
}

async function names(req, env) {
  const { results } = await env.DB.prepare("SELECT name, added_at FROM tracked ORDER BY added_at").all();
  return json(req, { count: results.length, names: results.map(r => r.name) }, 200, { "Cache-Control": "no-store" });
}

async function count(req, env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM tracked").first();
  return json(req, { count: r.n }, 200, { "Cache-Control": "public, max-age=60" });
}

async function probe(req) {
  const H = "https://secure.runescape.com/m=hiscore_oldschool_hardcore_ironman";
  const urls = [`${H}/overall?table=0&page=2`, `${H}/ranking.json?table=0&category=0&size=50`, `${H}/index_lite.json?player=Lynx%20Titan`];
  const out = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "DeathToll/1.0 (+https://deathtoll.gg)" }, redirect: "manual" });
      const text = await r.text();
      out.push({ url: u, status: r.status, cloudflare_block: /cloudflare|just a moment|attention required/i.test(text) && r.status >= 400,
        rows: (text.match(/personal-hiscores__row/g) || []).length, bytes: text.length });
    } catch (e) { out.push({ url: u, error: String(e) }); }
  }
  return json(req, { from: "cloudflare-worker", at: new Date().toISOString(), results: out }, 200, { "Cache-Control": "no-store" });
}

// One player's hiscore entry for the site's player page (browsers can't read Jagex's hiscores directly).
// Cached for 5 minutes per player so a popular page never hammers Jagex.
async function player(req, ctx) {
  const q = new URL(req.url).searchParams;
  const mode = q.get("mode") || "", name = (q.get("name") || "").replace(/\s+/g, " ").trim();
  if (!/^hiscore_oldschool[a-z_]{0,40}$/.test(mode) || !NAME_RE.test(name)) return json(req, { ok: false, error: "Bad request." }, 400);
  const cacheKey = new Request(`https://cache.deathtoll/player/${mode}/${encodeURIComponent(key(name))}`);
  const cache = caches.default;
  let hit = await cache.match(cacheKey);
  if (!hit) {
    const r = await fetch(`https://secure.runescape.com/m=${mode}/index_lite.json?player=${encodeURIComponent(name)}`, {
      headers: { "User-Agent": "DeathToll/1.0 (+https://deathtoll.gg)" }, redirect: "manual" });
    const text = await r.text();
    let body;
    if (r.status === 404 || (r.status === 200 && text.trim().startsWith("<"))) body = { ok: true, found: false };
    else if (r.status === 200) { try { body = { ok: true, found: true, player: JSON.parse(text) }; } catch { body = null; } }
    if (!body) return json(req, { ok: false, error: "The hiscores didn't answer. Try again in a minute." }, 502);
    hit = new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    ctx.waitUntil(cache.put(cacheKey, hit.clone()));
  }
  return json(req, await hit.json(), 200, { "Cache-Control": "public, max-age=120" });
}

async function tracked(req, env) {
  const name = (new URL(req.url).searchParams.get("name") || "").replace(/\s+/g, " ").trim();
  if (!NAME_RE.test(name)) return json(req, { ok: false, error: "Bad request." }, 400);
  const row = await env.DB.prepare("SELECT name, added_at FROM tracked WHERE key = ?").bind(key(name)).first();
  return json(req, { ok: true, tracked: !!row, name: row ? row.name : name, added_at: row ? row.added_at : null }, 200, { "Cache-Control": "no-store" });
}

// Locked to one URL shape on Jagex's hiscores and to the pipeline's key, so it can't be used as an open proxy.
async function hiscorePage(req, env) {
  const given = req.headers.get("X-Ledger-Key") || "";
  if (!env.LEDGER_KEY || given.length !== env.LEDGER_KEY.length ||
      !crypto.subtle.timingSafeEqual(new TextEncoder().encode(given), new TextEncoder().encode(env.LEDGER_KEY))) {
    return new Response("Forbidden", { status: 403 });
  }
  const q = new URL(req.url).searchParams;
  const mode = q.get("mode") || "", table = q.get("table") || "0", page = q.get("page") || "1";
  if (!/^hiscore_oldschool[a-z_]{0,40}$/.test(mode) || !/^\d{1,3}$/.test(table) || !/^\d{1,6}$/.test(page)) {
    return new Response("Bad request", { status: 400 });
  }
  const r = await fetch(`https://secure.runescape.com/m=${mode}/overall?table=${table}&page=${page}`, {
    headers: { "User-Agent": "DeathToll/1.0 (+https://deathtoll.gg)" }, redirect: "manual" });
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    try {
      if (pathname === "/track" && req.method === "POST") return await track(req, env);
      if (pathname === "/names" && req.method === "GET") return await names(req, env);
      if (pathname === "/count" && req.method === "GET") return await count(req, env);
      if (pathname === "/probe" && req.method === "GET") return await probe(req);
      if (pathname === "/hs" && req.method === "GET") return await hiscorePage(req, env);
      if (pathname === "/player" && req.method === "GET") return await player(req, ctx);
      if (pathname === "/tracked" && req.method === "GET") return await tracked(req, env);
      return json(req, { ok: false, error: "Not found." }, 404);
    } catch (e) {
      return json(req, { ok: false, error: "Something went wrong. Try again in a minute." }, 500);
    }
  },
};
