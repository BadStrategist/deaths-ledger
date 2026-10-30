"""Local preview: serves site/ and maps /data/ to LEDGER_DATA_DIR (same layout as the live site)."""
import http.server
import os
import sys

from common import DATA_DIR, ROOT

SITE = os.path.join(ROOT, "site")
DATA = sys.argv[2] if len(sys.argv) > 2 else DATA_DIR


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/data/"):
            return os.path.join(DATA, os.path.basename(clean))
        return super().translate_path(path)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    handler = lambda *a, **k: Handler(*a, directory=SITE, **k)
    print(f"serving {SITE} with data from {DATA} on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
