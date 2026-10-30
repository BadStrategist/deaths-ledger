# Death's Ledger

A live graveyard for Old School RuneScape **Hardcore Worlds** (launched 4 November 2026).
Every death comes from the official hiscores. No plugin and no player input.

- **Graveyard** (landing page): every Hardcore Worlds death with total level, exact time, world and stats at death.
- **Population**: live players on Hardcore Worlds, from RuneLite's public world list.
- **Data watcher**: spots the new hiscore table, world types and price feed the moment they appear, and switches the site over automatically.

## How it works

`.github/workflows/ledger.yml` runs every 10 minutes:

1. `scraper/population.py` saves a world-list snapshot.
2. `scraper/watcher.py` reads every hiscore mode linked from the main hiscore page and probes likely names and wiki price routes. The first new `hardcore` table becomes `hiscore_mode`.
3. `scraper/graveyard.py` scans the overall ranking from page 1 down to the listing cutoff, resuming across runs:
   - **Skull rows**: dead players kept on the hiscores carry `Player died: DD-Mon-YYYY HH:MM`. The death is recorded with that exact time.
   - **XP drop** while ranked: a reset.
   - **Disappeared** for two full scans and the personal lookup 404s: recorded as *fallen*. If they later come back with less XP it becomes a *reset*. If they come back intact the record is removed.
   - Each new death gets one `index_lite.json` lookup for world, map tile, stats and boss kills at death.
4. The site (`site/`) and the public JSON are published to GitHub Pages. Scanner state is force-pushed to the `state` branch as one commit.

## Listing threshold

`config.json -> listing.scale_steps` raises the minimum total level as the hiscores grow. The overall ranking is sorted by total level, so a higher threshold also shortens the scan. Set `min_total_override` to pin it.

## Local run

```
py -3 scraper/run_all.py          # writes to data/
py -3 scraper/serve.py 8790       # preview at http://localhost:8790
```

Test against the Hardcore Ironman table by pointing `LEDGER_CONFIG` at a copy of `config.json` with `"mode": "hiscore_oldschool_hardcore_ironman"` and a high `min_total_override`.

Fan-made. Not affiliated with Jagex.
