"""Delete one post from the shop account, through the same OAuth 1.0a keys the
pipeline posts with. Used for corrections: Hermes never holds the keys, GitHub
Actions does.

Usage (inside Actions only):
    TWEET_ID=2117827473194791076 X_API_KEY=... python scraper/x_delete.py
"""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from xposts import _keys, _oauth_header  # noqa: E402


def delete(tweet_id: str, keys) -> tuple[bool, int, str]:
    url = f"https://api.x.com/2/tweets/{tweet_id}"
    req = urllib.request.Request(url, method="DELETE", headers={"Authorization": _oauth_header("DELETE", url, keys)})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
            data = json.loads(body or "{}")
            return bool((data.get("data") or {}).get("deleted")), r.status, body[:300]
    except urllib.error.HTTPError as e:
        return False, e.code, e.read().decode("utf-8", "replace")[:300]
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, 0, str(e)[:300]


def main(argv):
    tweet_id = (os.environ.get("TWEET_ID") or (argv[0] if argv else "")).strip()
    if not tweet_id.isdigit():
        print(f"bad tweet id: {tweet_id!r}")
        return 2
    keys = _keys()
    if not keys:
        print("missing X_* secrets")
        return 2
    ok, status, detail = delete(tweet_id, keys)
    print(f"{'deleted' if ok else 'failed'} {tweet_id} status={status} {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
