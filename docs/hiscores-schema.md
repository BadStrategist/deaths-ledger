# `data/hiscores.json`: what the Hiscores page reads

`site/hiscores.html` (script: `site/assets/hiscores.js`) reads exactly one file: `/data/hiscores.json`, published next to the
other pipeline files. Browsers can't call Jagex's hiscores directly (no CORS), so everything the page shows has to be in this file.

Until the file exists **and** has `"status": "live"`, the page shows `site/assets/sample-hiscores.json` instead, under a
"PREVIEW · sample rankings" banner. Publishing a live file switches the page over with no code change.

## Shape

```json
{
  "status": "live",
  "updated": "2026-11-05T14:10:00Z",
  "mode": "hiscore_oldschool_hardcore_worlds",
  "overall": [
    { "rank": 1, "name": "Some Player", "total": 1834, "xp": 21450980, "dead": false, "died_at": null },
    { "rank": 2, "name": "Other Player", "total": 1829, "xp": 20877001, "dead": true, "died_at": "2026-11-05T09:31:00Z" }
  ],
  "skills": {
    "Attack": [
      { "rank": 1, "name": "Some Player", "level": 99, "xp": 13034431, "dead": false }
    ]
  },
  "notes": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `status` | `"waiting"` \| `"live"` | Only `"live"` is shown. Anything else (or a missing file) shows the sample preview. |
| `updated` | ISO 8601 string (UTC) | When the pipeline last read the hiscores. Shown as "updated 5m ago". |
| `mode` | string \| null | The hiscore table the rows came from (e.g. the `hiscore_mode` the watcher found). |
| `overall` | array | Top N of the overall table (likely 50–100), in rank order. |
| `overall[].rank` | int | Rank as shown on the official hiscores. |
| `overall[].name` | string | Display name, as on the hiscores. |
| `overall[].total` | int | Total level. |
| `overall[].xp` | int | Total XP. |
| `overall[].dead` | bool | `true` for skull rows (the player died but stays ranked). |
| `overall[].died_at` | ISO 8601 string \| null | Time of death from `Player died: DD-Mon-YYYY HH:MM`, converted to UTC. `null` when alive or unknown. |
| `skills` | object, **optional** | Skill name (`"Attack"`, `"Slayer"`, … as the hiscores spell them) → top N rows for that skill. Omit the key entirely if not scraped; the skill tabs are then hidden. Key order is tab order. |
| `skills.<Skill>[].rank` | int | Rank in that skill. |
| `skills.<Skill>[].name` | string | Display name. |
| `skills.<Skill>[].level` | int | Level in that skill. |
| `skills.<Skill>[].xp` | int | XP in that skill. |
| `skills.<Skill>[].dead` | bool | Same flag as in `overall`. The page borrows `died_at` from the player's `overall` row when there is one. |
| `notes` | string \| null | Short plain-text note shown under the table (e.g. "Hiscores lagging ~1h"). |

## Notes for the pipeline

- Write the file atomically (temp file + rename) like the other `data/*.json`, so the page never reads half a file.
- The page escapes every string, so names need no HTML escaping.
- Dead rows link to `tombstone.html?name=<name>&total=<overall total>`, so keep names exactly as the hiscores show them.
- Extra fields are ignored, so adding more later is safe.
