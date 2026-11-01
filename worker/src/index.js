// Death Toll tracking API (Cloudflare Worker + D1).
//   POST /track   {"name": "..."}  add a player to the tracked list (validated, rate limited per visitor)
//   GET  /names                    every tracked name, for the pipeline to poll
//   GET  /count                    how many players are tracked (for the site)
//   GET  /probe                    which Jagex hiscore endpoints answer from Cloudflare's network
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

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    try {
      if (pathname === "/track" && req.method === "POST") return await track(req, env);
      if (pathname === "/names" && req.method === "GET") return await names(req, env);
      if (pathname === "/count" && req.method === "GET") return await count(req, env);
      if (pathname === "/probe" && req.method === "GET") return await probe(req);
      return json(req, { ok: false, error: "Not found." }, 404);
    } catch (e) {
      return json(req, { ok: false, error: "Something went wrong. Try again in a minute." }, 500);
    }
  },
};
