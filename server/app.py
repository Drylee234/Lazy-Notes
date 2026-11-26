"""Lazy Notes — sync server + read-only mobile site.

The extension sends its whole notes snapshot here (PUT /api/snapshot); the
site at / shows it on a phone. Single user: every /api call needs
`Authorization: Bearer <LAZYNOTES_KEY>`.

    LAZYNOTES_KEY=your-secret python app.py          # http://0.0.0.0:8787
    python app.py --dev                               # makes up a key and prints it

Storage: Postgres when DATABASE_URL is set (Render), else a SQLite file at
LAZYNOTES_DB (default: lazynotes.db next to this file). The latest snapshot
and the 5 before it are kept.
"""

import hmac
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = 6                       # latest + 5 previous
MAX_BODY = 30 * 1024 * 1024    # figures travel as data URLs

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY

KEY = os.environ.get("LAZYNOTES_KEY", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

class Store:
    """snapshots(id, saved_at, body) in Postgres or SQLite."""

    def __init__(self):
        self.pg = bool(DATABASE_URL)
        if self.pg:
            import psycopg  # only needed on Render
            self._psycopg = psycopg
        else:
            self.path = os.environ.get("LAZYNOTES_DB", os.path.join(HERE, "lazynotes.db"))
        self._init()

    def _conn(self):
        if self.pg:
            return self._psycopg.connect(DATABASE_URL, autocommit=True)
        conn = sqlite3.connect(self.path)
        conn.isolation_level = None
        return conn

    def _init(self):
        with self._conn() as c:
            if self.pg:
                c.execute("CREATE TABLE IF NOT EXISTS snapshots "
                          "(id BIGSERIAL PRIMARY KEY, saved_at TEXT NOT NULL, body JSONB NOT NULL)")
            else:
                c.execute("CREATE TABLE IF NOT EXISTS snapshots "
                          "(id INTEGER PRIMARY KEY AUTOINCREMENT, saved_at TEXT NOT NULL, body TEXT NOT NULL)")

    def save(self, data):
        saved_at = now_iso()
        body = json.dumps(data, separators=(",", ":"))
        with self._conn() as c:
            ph = "%s" if self.pg else "?"
            c.execute(f"INSERT INTO snapshots (saved_at, body) VALUES ({ph}, {ph})", (saved_at, body))
            # Keep only the newest KEEP rows.
            c.execute(f"DELETE FROM snapshots WHERE id NOT IN "
                      f"(SELECT id FROM snapshots ORDER BY id DESC LIMIT {KEEP})")
        return saved_at

    def latest(self):
        with self._conn() as c:
            row = c.execute("SELECT saved_at, body FROM snapshots ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        saved_at, body = row
        return saved_at, (body if isinstance(body, dict) else json.loads(body))

    def count(self):
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]


store = None


# --------------------------------------------------------------------------
# CORS: the extension (chrome-extension://…) and the site itself
# --------------------------------------------------------------------------

def cors_origin():
    origin = request.headers.get("Origin", "")
    if origin.startswith("chrome-extension://") or origin == request.host_url.rstrip("/"):
        return origin
    return None


@app.after_request
def add_cors(resp):
    origin = cors_origin()
    if origin:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, PUT, OPTIONS"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


def authorized():
    header = request.headers.get("Authorization", "")
    given = header[7:] if header.startswith("Bearer ") else ""
    return bool(KEY) and hmac.compare_digest(given.encode(), KEY.encode())


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

@app.route("/api/<path:_any>", methods=["OPTIONS"])
def preflight(_any):
    return Response(status=204)


@app.get("/api/health")
def health():
    return jsonify(ok=True, app="lazy-notes")


@app.put("/api/snapshot")
def put_snapshot():
    if not authorized():
        return jsonify(ok=False, reason="wrong or missing key"), 401
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or payload.get("app") != "lazy-notes" \
            or not isinstance(payload.get("data"), dict) \
            or not isinstance(payload["data"].get("lazynotes"), dict):
        return jsonify(ok=False, reason="not a Lazy Notes snapshot"), 400
    saved_at = store.save(payload["data"])
    return jsonify(ok=True, savedAt=saved_at)


@app.get("/api/snapshot")
def get_snapshot():
    if not authorized():
        return jsonify(ok=False, reason="wrong or missing key"), 401
    latest = store.latest()
    if not latest:
        return jsonify(ok=False, reason="nothing synced yet"), 404
    saved_at, data = latest
    return jsonify(savedAt=saved_at, data=data)


@app.errorhandler(413)
def too_big(_e):
    return jsonify(ok=False, reason="snapshot over 30 MB"), 413


# --------------------------------------------------------------------------
# Mobile site
# --------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(os.path.join(HERE, "static"), "index.html")


@app.get("/static/<path:name>")
def static_file(name):
    return send_from_directory(os.path.join(HERE, "static"), name)


def setup():
    global KEY, store
    if "--dev" in sys.argv and not KEY:
        KEY = secrets.token_urlsafe(18)
        print(f"\n  Dev key (type it on the phone and in the extension):  {KEY}\n")
    if not KEY:
        sys.exit("LAZYNOTES_KEY is not set. Set it (any long secret), or run with --dev.")
    store = Store()


if __name__ == "__main__":
    setup()
    port = int(os.environ.get("PORT", "8787"))
    print(f"  Lazy Notes server on http://0.0.0.0:{port}  (open http://<this computer's IP>:{port} on your phone)")
    app.run(host="0.0.0.0", port=port)
else:
    # gunicorn app:app
    setup()
