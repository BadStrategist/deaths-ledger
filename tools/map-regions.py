#!/usr/bin/env python3
"""Build site/assets/map-regions.json: OSRS region id (64x64 tiles) -> place name.

Names come from RuneLite's Discord plugin, which keys every named area to the
region ids it covers. Only ids listed there get a name; the death map shows the
coordinates of every other region instead of guessing.

    python3 tools/map-regions.py            # fetches the current file from GitHub
    python3 tools/map-regions.py FILE.java  # or reads a local copy
"""
import json, re, sys, urllib.request
from pathlib import Path

SRC = "https://raw.githubusercontent.com/runelite/runelite/master/runelite-client/src/main/java/net/runelite/client/plugins/discord/DiscordGameEventType.java"
OUT = Path(__file__).resolve().parent.parent / "site/assets/map-regions.json"
# When several areas claim one region, the most specific wins.
PRIORITY = ["BOSSES", "RAIDS", "MINIGAMES", "DUNGEONS", "CITIES", "REGIONS"]

text = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else urllib.request.urlopen(SRC).read().decode()
entry = re.compile(r'^\s*\w+\(\s*"([^"]+)"\s*,\s*DiscordAreaType\.(\w+)\s*((?:,\s*\d+\s*)+)\)', re.M)
best = {}
for name, kind, ids in entry.findall(text):
    for rid in map(int, re.findall(r"\d+", ids)):
        rank = PRIORITY.index(kind)
        if rid not in best or rank < best[rid][0]:
            best[rid] = (rank, name)

OUT.write_text(json.dumps({
    "note": "Region id = (x >> 6) << 8 | (y >> 6). Names from RuneLite's Discord plugin "
            "(DiscordGameEventType.java), Copyright (c) 2018 Tomas Slusny, PandahRS, (c) 2020 Brooklyn; BSD 2-Clause.",
    "source": SRC.replace("raw.githubusercontent.com/runelite/runelite/master", "github.com/runelite/runelite/blob/master"),
    "regions": {str(k): best[k][1] for k in sorted(best)},
}, indent=0, ensure_ascii=False) + "\n")
print(f"{len(best)} named regions -> {OUT}")
