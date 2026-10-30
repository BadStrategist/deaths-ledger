"""Shared helpers: polite HTTP, JSON files, time. Standard library only."""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.environ.get("LEDGER_CONFIG", os.path.join(ROOT, "config.json"))
# Persistent files live in DATA_DIR. In CI this is the checked-out `state` branch.
DATA_DIR = os.environ.get("LEDGER_DATA_DIR", os.path.join(ROOT, "data"))

USER_AGENT = "DeathToll/1.0 (+https://deathtoll.gg)"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def now_ms():
    return int(time.time() * 1000)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def data_path(name):
    return os.path.join(DATA_DIR, name)


def read_json(name, default):
    path = data_path(name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        # A half-written file must never kill the pipeline; keep the copy for inspection.
        os.replace(path, path + ".corrupt")
        return default


def write_json(name, obj, compact=False):
    """Atomic write: a crash mid-write leaves the previous file intact."""
    os.makedirs(DATA_DIR, exist_ok=True)
    path = data_path(name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


class Http:
    """Sequential client with a fixed delay between requests and backoff on errors.

    `follow_redirects=False` matters for the hiscores: an unknown hiscore mode answers
    303 to an error page, which is how the watcher tells "exists" from "not yet".
    """

    def __init__(self, delay=0.5, retries=4, timeout=30):
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self._last = 0.0
        self.requests = 0

    def _wait(self):
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last = time.monotonic()

    def get(self, url, follow_redirects=True):
        """Returns (status, body_text). Status 0 means the request never got an answer."""
        opener = urllib.request.build_opener() if follow_redirects else urllib.request.build_opener(_NoRedirect)
        backoff = 5
        for attempt in range(self.retries + 1):
            self._wait()
            self.requests += 1
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            try:
                with opener.open(req, timeout=self.timeout) as r:
                    return r.status, r.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308, 404):
                    return e.code, ""
                if e.code in (429, 500, 502, 503, 504) and attempt < self.retries:
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                return e.code, ""
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                if attempt < self.retries:
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                return 0, ""
        return 0, ""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
