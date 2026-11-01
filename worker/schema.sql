CREATE TABLE IF NOT EXISTS tracked (
  key      TEXT PRIMARY KEY,   -- lower-cased name, spaces/_/- folded (same rule as scraper/graveyard.py key())
  name     TEXT NOT NULL,      -- as typed
  added_at INTEGER NOT NULL,   -- ms since epoch
  added_by TEXT NOT NULL       -- daily-rotating hash of the visitor's IP, for rate limiting only
);
CREATE INDEX IF NOT EXISTS tracked_by_visitor ON tracked (added_by, added_at);
