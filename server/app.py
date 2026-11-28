"""Q-notes — sync server + read-only mobile site.

The extension sends its whole notes snapshot here (PUT /api/snapshot); the
site at / shows it on a phone. Every /api call needs
`Authorization: Bearer <token>`: either LAZYNOTES_KEY (the server owner, as
before) or a login token from POST /api/login (an account; each account has
its own notes). Accounts: SIGNUPS = "invite" (default: new accounts need the
invite code INVITE_CODE; when that isn't set, "open") | "open" | "closed". Shared topics: POST /api/share → a link anyone can read (/s/<id>),
optionally sent to another account's inbox (GET /api/inbox).

    LAZYNOTES_KEY=your-secret python app.py          # http://0.0.0.0:8787
    python app.py --dev                               # makes up a key and prints it

Storage: Postgres when DATABASE_URL is set (Render), else a SQLite file at
LAZYNOTES_DB (default: lazynotes.db next to this file). The latest snapshot
and the 5 before it are kept.
"""

import hashlib
import io
import zipfile
import hmac
import json
import re
import os
import secrets
import socket
import smtplib
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import Flask, Response, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = 6                       # latest + 5 previous
MAX_BODY = 30 * 1024 * 1024    # figures travel as data URLs

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY
# Render sits in front (https): believe its X-Forwarded-Proto / Host, so the
# Google sign-in return address is https://…onrender.com/…
from werkzeug.middleware.proxy_fix import ProxyFix  # noqa: E402
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

KEY = os.environ.get("LAZYNOTES_KEY", "")
INVITE_CODE = os.environ.get("INVITE_CODE", "").strip()
# open (default, when there's no INVITE_CODE) | invite (default when there is
# one) | closed. Never falls back to LAZYNOTES_KEY: handing that out as an
# invite would give the owner's own notes away.
SIGNUPS = (os.environ.get("SIGNUPS", "").strip().lower() or ("invite" if INVITE_CODE else "open"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# AI help: the extension asks this server, and this server adds the AI key —
# so the key lives here (a Render environment variable) and never in Chrome.
#   AI_KEY       the AI service's key                     (required)
#   AI_PROVIDER  groq | gemini | anthropic | openrouter    (default groq)
#   AI_MODEL     the model name            (default: that provider's usual one)
#   AI_BASE      a different address, for anything OpenAI-shaped (optional)
AI_KEY_RAW = os.environ.get("AI_KEY", "")
AI_KEY = AI_KEY_RAW.strip()   # a pasted key often brings a space or newline with it
AI_PROVIDER = os.environ.get("AI_PROVIDER", "groq").strip().lower()
AI_MODEL = os.environ.get("AI_MODEL", "").strip()
AI_BASE = os.environ.get("AI_BASE", "").strip().rstrip("/")
AI_TIMEOUT = 55                 # seconds; the extension waits 60

# Many free AI services at once (GROQ_KEY, GEMINI_KEY, CEREBRAS_KEY, …), each
# question routed to whichever model has room: see ai_router.py. The old
# AI_KEY / AI_PROVIDER / AI_MODEL set-up is part of the pool.
from ai_router import Router as _AiRouter  # noqa: E402
AI_ROUTER = _AiRouter()

# Must match shared/ai-providers.js.
AI_SERVICES = {
    "groq":       {"shape": "openai",    "base": "https://api.groq.com/openai/v1",
                   "model": "openai/gpt-oss-120b"},
    "gemini":     {"shape": "gemini",    "base": "https://generativelanguage.googleapis.com/v1beta",
                   "model": "gemini-2.5-flash"},
    "anthropic":  {"shape": "anthropic", "base": "https://api.anthropic.com/v1",
                   "model": "claude-opus-5-5"},
    "openrouter": {"shape": "openai",    "base": "https://openrouter.ai/api/v1",
                   "model": "deepseek/deepseek-chat-v3.1:free"},
}


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
        serial = "BIGSERIAL PRIMARY KEY" if self.pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
        js = "JSONB" if self.pg else "TEXT"
        with self._conn() as c:
            c.execute(f"CREATE TABLE IF NOT EXISTS snapshots (id {serial}, saved_at TEXT NOT NULL, body {js} NOT NULL)")
            # Accounts: snapshots.user_id NULL = the server owner (LAZYNOTES_KEY).
            try:
                c.execute("ALTER TABLE snapshots ADD COLUMN user_id BIGINT")
            except Exception:
                pass   # already there
            c.execute(f"CREATE TABLE IF NOT EXISTS users (id {serial}, username TEXT UNIQUE NOT NULL, "
                      "pass_hash TEXT NOT NULL, created_at TEXT NOT NULL)")
            c.execute("CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL, created_at TEXT NOT NULL)")
            c.execute(f"CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, owner_id BIGINT, to_user_id BIGINT, "
                      f"created_at TEXT NOT NULL, title TEXT, body {js} NOT NULL)")
            # Documents (PDF / slides / Word) backed up from the extension, so
            # the phone can open them. One copy per account per file (sha256).
            blob = "BYTEA" if self.pg else "BLOB"
            c.execute(f"CREATE TABLE IF NOT EXISTS docs (sha TEXT NOT NULL, user_key TEXT NOT NULL, name TEXT, kind TEXT, "
                      f"size BIGINT, created_at TEXT NOT NULL, body {blob} NOT NULL, PRIMARY KEY (sha, user_key))")
            # The server only passes documents on: once a phone has kept one,
            # its copy here is deleted and a mark remembers "delivered" (so
            # the extension doesn't send it again) or "wanted" (a phone lost
            # it: the extension sends it again from the computer).
            # Usage reports (no notes: counts, settings, errors), kept apart from
            # the notes with a short history, so the owner (and Claude) can read
            # every tester's: GET /api/reports, /api/reports/summary.
            c.execute(f"CREATE TABLE IF NOT EXISTS reports (id {serial}, user_key TEXT NOT NULL, saved_at TEXT NOT NULL, body {js} NOT NULL)")
            # Password resets: only the link's hash is kept; one use, then gone.
            c.execute("CREATE TABLE IF NOT EXISTS resets (hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL, expires TEXT NOT NULL)")
            c.execute("CREATE TABLE IF NOT EXISTS doc_marks (sha TEXT NOT NULL, user_key TEXT NOT NULL, state TEXT NOT NULL, "
                      "name TEXT, kind TEXT, at TEXT NOT NULL, PRIMARY KEY (sha, user_key))")

    def q(self, sql):
        return sql.replace("?", "%s") if self.pg else sql

    def _owner(self, user_id):
        return ("user_id IS NULL", ()) if user_id is None else ("user_id = ?", (user_id,))

    def save(self, data, user_id=None):
        saved_at = now_iso()
        body = json.dumps(data, separators=(",", ":"))
        where, args = self._owner(user_id)
        with self._conn() as c:
            c.execute(self.q("INSERT INTO snapshots (saved_at, body, user_id) VALUES (?, ?, ?)"), (saved_at, body, user_id))
            # Keep only this account's newest KEEP rows.
            c.execute(self.q(f"DELETE FROM snapshots WHERE {where} AND id NOT IN "
                             f"(SELECT id FROM snapshots WHERE {where} ORDER BY id DESC LIMIT {KEEP})"), args + args)
        return saved_at

    def latest(self, user_id=None):
        where, args = self._owner(user_id)
        with self._conn() as c:
            row = c.execute(self.q(f"SELECT saved_at, body FROM snapshots WHERE {where} ORDER BY id DESC LIMIT 1"), args).fetchone()
        if not row:
            return None
        saved_at, body = row
        return saved_at, (body if isinstance(body, dict) else json.loads(body))

    def count(self):
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]

    # ── accounts ──
    def add_user(self, username, pass_hash):
        with self._conn() as c:
            try:
                c.execute(self.q("INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)"), (username, pass_hash, now_iso()))
            except Exception:
                return None   # taken
            return c.execute(self.q("SELECT id FROM users WHERE username = ?"), (username,)).fetchone()[0]

    def user_by_name(self, username):
        with self._conn() as c:
            return c.execute(self.q("SELECT id, pass_hash FROM users WHERE username = ?"), (username,)).fetchone()

    def username(self, user_id):
        with self._conn() as c:
            row = c.execute(self.q("SELECT username FROM users WHERE id = ?"), (user_id,)).fetchone()
        return row[0] if row else None

    def add_token(self, token_hash, user_id):
        with self._conn() as c:
            c.execute(self.q("INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)"), (token_hash, user_id, now_iso()))

    def token_user(self, token_hash):
        with self._conn() as c:
            row = c.execute(self.q("SELECT user_id FROM tokens WHERE hash = ?"), (token_hash,)).fetchone()
        return row[0] if row else None

    def drop_token(self, token_hash):
        with self._conn() as c:
            c.execute(self.q("DELETE FROM tokens WHERE hash = ?"), (token_hash,))

    def drop_user_tokens(self, user_id):
        """Logs the account out everywhere (after a password reset)."""
        with self._conn() as c:
            c.execute(self.q("DELETE FROM tokens WHERE user_id = ?"), (user_id,))

    def set_password(self, user_id, pass_hash):
        with self._conn() as c:
            c.execute(self.q("UPDATE users SET pass_hash = ? WHERE id = ?"), (pass_hash, user_id))

    # ── password resets ── (expires: now_iso() text, so it sorts as time)
    def add_reset(self, reset_hash, user_id, expires):
        with self._conn() as c:
            c.execute(self.q("DELETE FROM resets WHERE expires < ?"), (now_iso(),))   # tidy old ones
            c.execute(self.q("INSERT INTO resets (hash, user_id, expires) VALUES (?, ?, ?)"), (reset_hash, user_id, expires))

    def take_reset(self, reset_hash):
        """The account id for a reset link, once: the link is deleted. None if
        it's unknown, already used or expired."""
        with self._conn() as c:
            row = c.execute(self.q("SELECT user_id, expires FROM resets WHERE hash = ?"), (reset_hash,)).fetchone()
            if not row:
                return None
            gone = c.execute(self.q("DELETE FROM resets WHERE hash = ?"), (reset_hash,))
            if gone.rowcount != 1:   # someone else used it at the same moment
                return None
        user_id, expires = row
        return user_id if expires > now_iso() else None

    # ── usage reports ──
    REPORTS_KEEP = 30

    def report_add(self, user_key, body):
        with self._conn() as c:
            c.execute(self.q("INSERT INTO reports (user_key, saved_at, body) VALUES (?, ?, ?)"),
                      (user_key, now_iso(), json.dumps(body, separators=(",", ":"))))
            c.execute(self.q(f"DELETE FROM reports WHERE user_key = ? AND id NOT IN "
                             f"(SELECT id FROM reports WHERE user_key = ? ORDER BY id DESC LIMIT {self.REPORTS_KEEP})"), (user_key, user_key))

    def reports_latest(self):
        """[(user_key, saved_at, body, how_many_kept)] — each tester's newest."""
        with self._conn() as c:
            rows = c.execute("SELECT r.user_key, r.saved_at, r.body, (SELECT COUNT(*) FROM reports x WHERE x.user_key = r.user_key) "
                             "FROM reports r WHERE r.id = (SELECT MAX(id) FROM reports y WHERE y.user_key = r.user_key) "
                             "ORDER BY r.saved_at DESC").fetchall()
        return [(u, at, b if isinstance(b, dict) else json.loads(b), n) for (u, at, b, n) in rows]

    # ── documents ── (user_key: "owner" or the account id, as text)
    def doc_list(self, user_key):
        with self._conn() as c:
            rows = c.execute(self.q("SELECT sha, name, kind, size, created_at FROM docs WHERE user_key = ? ORDER BY created_at DESC"), (user_key,)).fetchall()
            marks = c.execute(self.q("SELECT sha, name, kind, state, at FROM doc_marks WHERE user_key = ?"), (user_key,)).fetchall()
        items = [{"sha": r[0], "name": r[1], "kind": r[2], "size": r[3], "createdAt": r[4], "state": "stored"} for r in rows]
        have = {i["sha"] for i in items}
        items += [{"sha": m[0], "name": m[1], "kind": m[2], "state": m[3], "createdAt": m[4]} for m in marks if m[0] not in have]
        return items

    def doc_mark(self, user_key, sha, state, name=None, kind=None):
        with self._conn() as c:
            c.execute(self.q("DELETE FROM doc_marks WHERE sha = ? AND user_key = ?"), (sha, user_key))
            if state:
                c.execute(self.q("INSERT INTO doc_marks (sha, user_key, state, name, kind, at) VALUES (?, ?, ?, ?, ?, ?)"),
                          (sha, user_key, state, name, kind, now_iso()))

    def doc_delete(self, user_key, sha):
        with self._conn() as c:
            row = c.execute(self.q("SELECT name, kind FROM docs WHERE sha = ? AND user_key = ?"), (sha, user_key)).fetchone()
            c.execute(self.q("DELETE FROM docs WHERE sha = ? AND user_key = ?"), (sha, user_key))
        return row

    def doc_used(self, user_key):
        with self._conn() as c:
            return c.execute(self.q("SELECT COALESCE(SUM(size), 0) FROM docs WHERE user_key = ?"), (user_key,)).fetchone()[0] or 0

    def doc_put(self, user_key, sha, name, kind, body):
        with self._conn() as c:
            if c.execute(self.q("SELECT 1 FROM docs WHERE sha = ? AND user_key = ?"), (sha, user_key)).fetchone():
                return False
            c.execute(self.q("INSERT INTO docs (sha, user_key, name, kind, size, created_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)"),
                      (sha, user_key, name, kind, len(body), now_iso(), body))
        return True

    def doc_get(self, user_key, sha):
        with self._conn() as c:
            row = c.execute(self.q("SELECT name, kind, body FROM docs WHERE sha = ? AND user_key = ?"), (sha, user_key)).fetchone()
        return (row[0], row[1], bytes(row[2])) if row else None

    # ── shared topics ──
    def add_share(self, share_id, owner_id, to_user_id, title, body):
        with self._conn() as c:
            c.execute(self.q("INSERT INTO shares (id, owner_id, to_user_id, created_at, title, body) VALUES (?, ?, ?, ?, ?, ?)"),
                      (share_id, owner_id, to_user_id, now_iso(), title, json.dumps(body, separators=(",", ":"))))

    def share(self, share_id):
        with self._conn() as c:
            row = c.execute(self.q("SELECT owner_id, created_at, title, body FROM shares WHERE id = ?"), (share_id,)).fetchone()
        if not row:
            return None
        owner_id, created_at, title, body = row
        return {"owner_id": owner_id, "createdAt": created_at, "title": title,
                "body": body if isinstance(body, dict) else json.loads(body)}

    def inbox(self, user_id):
        with self._conn() as c:
            rows = c.execute(self.q("SELECT id, owner_id, created_at, title FROM shares WHERE to_user_id = ? "
                                    "ORDER BY created_at DESC LIMIT 50"), (user_id,)).fetchall()
        return rows


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
        resp.headers["Access-Control-Allow-Methods"] = "GET, PUT, POST, DELETE, OPTIONS"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


OWNER = "owner"   # who() for LAZYNOTES_KEY: the snapshot with user_id NULL


def bearer():
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.startswith("Bearer ") else ""


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def who():
    """OWNER (the server key), an account's id, or None (not allowed)."""
    given = bearer()
    if not given:
        return None
    if KEY and hmac.compare_digest(given.encode(), KEY.encode()):
        return OWNER
    return store.token_user(token_hash(given))


def authorized():
    return who() is not None


def user_id_of(w):
    return None if w == OWNER else w


def hash_password(password, salt=None, rounds=200_000):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds).hex()
    return f"pbkdf2${rounds}${salt}${digest}"


def check_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
        return hmac.compare_digest(hash_password(password, salt, int(rounds)).split("$")[3], digest)
    except (ValueError, IndexError):
        return False


# A username (3–32 letters, numbers, . _ -) or an email address.
USERNAME_RE = re.compile(r"^(?:[a-z0-9_.-]{3,32}|[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24})$")


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
        return jsonify(ok=False, reason="not a Q-notes snapshot"), 400
    w = who()
    saved_at = store.save(payload["data"], user_id_of(w))
    rep_body = payload["data"].get("lnReport")
    if isinstance(rep_body, dict):
        try:
            store.report_add("owner" if w == OWNER else str(w), rep_body)
        except Exception:
            pass   # a report must never stop the notes from saving
    return jsonify(ok=True, savedAt=saved_at)


@app.get("/api/snapshot")
def get_snapshot():
    if not authorized():
        return jsonify(ok=False, reason="wrong or missing key"), 401
    latest = store.latest(user_id_of(who()))
    if not latest:
        return jsonify(ok=False, reason="nothing synced yet"), 404
    saved_at, data = latest
    return jsonify(savedAt=saved_at, data=data)


@app.get("/api/report")
def get_report():
    """The usage + error report from the last sync (no notes), for debugging."""
    if not authorized():
        return jsonify(ok=False, reason="wrong or missing key"), 401
    latest = store.latest(user_id_of(who()))
    if not latest:
        return jsonify(ok=False, reason="nothing synced yet"), 404
    saved_at, data = latest
    return jsonify(savedAt=saved_at, report=(data or {}).get("lnReport"))


# --------------------------------------------------------------------------
# Testers' usage reports, for the owner (and Claude) — server key only.
#   GET /api/reports           each tester's latest report
#   GET /api/reports/summary   all of them added up: what's used, never used,
#                              struggle signs, the commonest errors
# Reports hold counts, settings and errors: never note text or keys.
# --------------------------------------------------------------------------

def _owner_only():
    return who() == OWNER


def _who_name(user_key):
    if user_key == "owner":
        return "owner"
    try:
        return store.username(int(user_key)) or f"account {user_key}"
    except ValueError:
        return user_key


@app.get("/api/reports")
def reports_all():
    if not _owner_only():
        return jsonify(ok=False, reason="only the server key can read everyone's reports"), 403
    out = [{"tester": _who_name(u), "savedAt": at, "reportsKept": n, "report": body} for (u, at, body, n) in store.reports_latest()]
    return jsonify(ok=True, testers=len(out), reports=out)


@app.get("/api/reports/summary")
def reports_summary():
    if not _owner_only():
        return jsonify(ok=False, reason="only the server key can read everyone's reports"), 403
    rows = store.reports_latest()
    usage, habits, never, errors = {}, {}, {}, {}
    testers = []
    for (u, at, body, _n) in rows:
        name = _who_name(u)
        counts = body.get("counts") or {}
        testers.append({"tester": name, "lastReport": at, "version": body.get("version"), "notes": counts,
                        "browser": (body.get("browser") or "")[:120]})
        for bucket, src in ((usage, body.get("usage") or {}), (habits, body.get("habits") or {})):
            for day in src.values():
                for k, v in (day or {}).items():
                    e = bucket.setdefault(k, {"total": 0, "testers": set()})
                    e["total"] += int(v or 0)
                    e["testers"].add(name)
        for f in body.get("neverUsed") or []:
            never.setdefault(f, set()).add(name)
        for err in body.get("errors") or []:
            key = f"{err.get('where', '')}: {err.get('msg', '')}"[:200]
            e = errors.setdefault(key, {"count": 0, "testers": set()})
            e["count"] += 1
            e["testers"].add(name)
    top = lambda d, k: sorted(({"what": w, **{kk: (len(vv) if isinstance(vv, set) else vv) for kk, vv in v.items()}} for w, v in d.items()),
                              key=lambda x: -x[k])
    return jsonify(ok=True, testers=testers,
                   used=top(usage, "total")[:60], habits=top(habits, "total")[:60],
                   neverUsed=sorted(({"feature": f, "testers": len(t)} for f, t in never.items()), key=lambda x: -x["testers"]),
                   errors=top(errors, "count")[:40])


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------

@app.get("/api/signup-info")
def signup_info():
    return jsonify(ok=True, signups=SIGNUPS, google=bool(GOOGLE_ID and GOOGLE_SECRET))


@app.post("/api/signup")
def signup():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")
    # Accounts are made in the extension (a computer): the phone site only logs in.
    if not request.headers.get("Origin", "").startswith("chrome-extension://"):
        return jsonify(ok=False, code="SIGNUP_IN_EXTENSION",
                       reason="Create your account in the Q-notes extension on your computer (Settings › Sync), then log in here."), 403
    if SIGNUPS == "closed":
        return jsonify(ok=False, code="SIGNUPS_CLOSED", reason="This server isn't taking new accounts."), 403
    if SIGNUPS != "open":
        code = INVITE_CODE
        if not code or not hmac.compare_digest(str(body.get("invite") or "").strip().encode(), code.encode()):
            return jsonify(ok=False, code="INVITE_WRONG", reason="That invite code isn't right. Ask whoever runs this server."), 403
    if not USERNAME_RE.match(username):
        return jsonify(ok=False, code="BAD_USERNAME", reason="Use your email address, or a username of 3–32 letters, numbers, dots, dashes or underscores."), 400
    if len(password) < 8:
        return jsonify(ok=False, code="SHORT_PASSWORD", reason="Use a password of at least 8 characters."), 400
    user_id = store.add_user(username, hash_password(password))
    if user_id is None:
        return jsonify(ok=False, code="USERNAME_TAKEN", reason="That username is taken."), 409
    token = secrets.token_urlsafe(32)
    store.add_token(token_hash(token), user_id)
    return jsonify(ok=True, token=token, username=username)


@app.post("/api/login")
def login():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lower()
    row = store.user_by_name(username)
    if not row or not check_password(str(body.get("password") or ""), row[1]):
        return jsonify(ok=False, code="LOGIN_WRONG", reason="Wrong username or password."), 401
    token = secrets.token_urlsafe(32)
    store.add_token(token_hash(token), row[0])
    return jsonify(ok=True, token=token, username=username)


@app.post("/api/logout")
def logout():
    if bearer():
        store.drop_token(token_hash(bearer()))
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    w = who()
    if w is None:
        return jsonify(ok=False, reason="not logged in"), 401
    return jsonify(ok=True, username=None if w == OWNER else store.username(w), owner=w == OWNER)


# --------------------------------------------------------------------------
# Forgot password. A reset link (/reset#t=<token>) sets a new password once.
# By email when SMTP is set up (off until then):
#   SMTP_HOST   e.g. smtp.gmail.com or smtp-relay.brevo.com
#   SMTP_PORT   587 (default, STARTTLS) or 465 (SSL)
#   SMTP_USER   the login (Gmail address / Brevo login)
#   SMTP_PASS   its password (Gmail: an App password)
#   MAIL_FROM   who the email is from (default SMTP_USER)
# Without email, the owner makes a link with POST /api/reset-link (server key)
# and sends it to the tester (WhatsApp…). Links hold only a hash here.
# --------------------------------------------------------------------------
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587").strip() or 587)
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "").strip() or SMTP_USER
# Where reset links point. Never taken from the request alone when Render
# says its address, so a faked Host header can't send someone a link elsewhere.
PUBLIC_URL = (os.environ.get("PUBLIC_URL", "") or os.environ.get("RENDER_EXTERNAL_URL", "")).strip().rstrip("/")
RESET_MINUTES = 30          # emailed links
RESET_LINK_HOURS = 24       # links the owner makes by hand

NO_MAIL = "Password reset by email isn't set up on this server yet. Ask whoever gave you Q-notes for a reset link."
FORGOT_SENT = ("If that account has an email address, a reset link is on its way. Check spam too. "
               "No email on the account? Ask whoever gave you Q-notes for a reset link.")
RESET_EXPIRED = "That reset link has expired or was already used. Ask for a new one."


def mail_on():
    return bool(SMTP_HOST and MAIL_FROM)


def send_mail(to, subject, text):
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["From"] = f"{APP_NAME} <{MAIL_FROM}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    tls = ssl.create_default_context()
    if SMTP_PORT == 465:
        s = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30, context=tls)
    else:
        s = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
        s.ehlo()
        if s.has_extn("starttls"):
            s.starttls(context=tls)
            s.ehlo()
        elif SMTP_USER:
            s.quit()
            raise RuntimeError("the mail server doesn't offer STARTTLS; not sending the password in the clear")
    try:
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)
    finally:
        try:
            s.quit()
        except Exception:
            pass


def _send_in_background(to, subject, text):
    def run():
        try:
            send_mail(to, subject, text)
        except Exception as e:   # never the link or the password in the log
            print(f"  reset email not sent: {type(e).__name__}: {e}", flush=True)
    threading.Thread(target=run, daemon=True).start()


def _base_url():
    return PUBLIC_URL or request.host_url.rstrip("/")


def _new_reset(user_id, minutes):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(timespec="seconds").replace("+00:00", "Z")
    store.add_reset(token_hash(token), user_id, expires)
    return f"{_base_url()}/reset#t={token}"   # a fragment: never in server logs


# A small rate limit (memory; one worker): 5 an hour per IP and per username,
# 60 an hour in all (free email plans allow a few hundred a day).
_forgot_hits = {}
_forgot_lock = threading.Lock()


def _rate_ok(keys, limits):
    now = time.time()
    with _forgot_lock:
        for k in list(_forgot_hits):
            _forgot_hits[k] = [t for t in _forgot_hits[k] if now - t < 3600]
            if not _forgot_hits[k]:
                del _forgot_hits[k]
        if any(len(_forgot_hits.get(k, [])) >= n for k, n in zip(keys, limits)):
            return False
        for k in keys:
            _forgot_hits.setdefault(k, []).append(now)
        return True


def _client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() if fwd else "") or request.remote_addr or "?"


@app.post("/api/forgot")
def forgot():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lower()[:260]
    if not mail_on():
        return jsonify(ok=False, code="NO_MAIL", reason=NO_MAIL)
    if not username:
        return jsonify(ok=False, code="NO_USERNAME", reason="Type the email address of your account."), 400
    if not _rate_ok(["ip:" + _client_ip(), "user:" + username, "all"], [5, 5, 60]):
        return jsonify(ok=False, code="TOO_MANY", reason="Too many reset requests. Try again in an hour."), 429
    # The same answer whether or not the account exists (and the email is
    # sent in the background, so the answer takes the same time too).
    row = store.user_by_name(username)
    if row and "@" in username and USERNAME_RE.match(username):
        link = _new_reset(row[0], RESET_MINUTES)
        _send_in_background(username, f"Reset your {APP_NAME} password", (
            f"Hi,\n\n"
            f"Someone (hopefully you) asked to reset the password of your {APP_NAME} account, {username}.\n\n"
            f"Choose a new password here (the link works once, for {RESET_MINUTES} minutes):\n\n{link}\n\n"
            f"Didn't ask? Just ignore this email: your password stays as it is.\n\n"
            f"{APP_NAME}\n"))
    return jsonify(ok=True, reason=FORGOT_SENT)


@app.post("/api/reset")
def reset_password():
    body = request.get_json(silent=True) or {}
    token = str(body.get("token") or "").strip()
    password = str(body.get("password") or "")
    if len(password) < 8:   # checked first, so a short one doesn't use up the link
        return jsonify(ok=False, code="SHORT_PASSWORD", reason="Use a password of at least 8 characters."), 400
    user_id = store.take_reset(token_hash(token)) if token else None
    username = store.username(user_id) if user_id is not None else None
    if not username:
        return jsonify(ok=False, code="RESET_EXPIRED", reason=RESET_EXPIRED), 400
    store.set_password(user_id, hash_password(password))
    store.drop_user_tokens(user_id)   # logged out everywhere (a lost phone too)
    login_token = secrets.token_urlsafe(32)
    store.add_token(token_hash(login_token), user_id)
    return jsonify(ok=True, token=login_token, username=username)


@app.post("/api/reset-link")
def reset_link():
    """The owner (server key) makes a 24-hour link to send a tester by hand."""
    if not _owner_only():
        return jsonify(ok=False, reason="only the server key can make reset links"), 403
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lower()
    row = store.user_by_name(username) if username else None
    if not row:
        return jsonify(ok=False, code="NO_ACCOUNT", reason=f"There's no account called '{username}'."), 404
    return jsonify(ok=True, link=_new_reset(row[0], RESET_LINK_HOURS * 60), username=username, validHours=RESET_LINK_HOURS)


# --------------------------------------------------------------------------
# Sign in with Google (optional: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET from a
# Google Cloud "OAuth client ID" of type Web application, with this redirect
# URI: https://<your server>/auth/google/callback). The account is the Google
# email. New accounts only when started from the extension (from=ext), like
# the rest of sign-up; the phone can only log in to an existing one.
# --------------------------------------------------------------------------
GOOGLE_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_AUTH = os.environ.get("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
GOOGLE_TOKEN = os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
GOOGLE_USERINFO = os.environ.get("GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo")
_google_states = {}   # state → (from, expires); one worker, so memory is fine


def _done(fragment):
    from flask import redirect
    return redirect("/auth/done#" + urllib.parse.urlencode(fragment))


@app.get("/auth/google")
def google_start():
    from flask import redirect
    if not (GOOGLE_ID and GOOGLE_SECRET):
        return _done({"error": "Google sign-in isn't set up on this server."})
    src = "ext" if request.args.get("from") == "ext" else "phone"
    state = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc).timestamp()
    for k in [k for k, v in _google_states.items() if v[1] < now]:
        _google_states.pop(k, None)
    _google_states[state] = (src, now + 600)
    q = {"client_id": GOOGLE_ID, "redirect_uri": request.host_url.rstrip("/") + "/auth/google/callback",
         "response_type": "code", "scope": "openid email", "state": state, "prompt": "select_account"}
    return redirect(f"{GOOGLE_AUTH}?{urllib.parse.urlencode(q)}")


@app.get("/auth/google/callback")
def google_callback():
    st = _google_states.pop(request.args.get("state", ""), None)
    if not st or st[1] < datetime.now(timezone.utc).timestamp():
        return _done({"error": "That sign-in took too long or was already used. Try again."})
    src = st[0]
    code = request.args.get("code", "")
    if not code:
        return _done({"error": "Google sign-in was cancelled.", "from": src})
    try:
        data = urllib.parse.urlencode({"code": code, "client_id": GOOGLE_ID, "client_secret": GOOGLE_SECRET,
                                       "redirect_uri": request.host_url.rstrip("/") + "/auth/google/callback",
                                       "grant_type": "authorization_code"}).encode()
        with urllib.request.urlopen(urllib.request.Request(GOOGLE_TOKEN, data=data, headers={"User-Agent": "LazyNotesServer/1.0"}), timeout=20) as r:
            tok = json.loads(r.read().decode())
        req = urllib.request.Request(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {tok.get('access_token', '')}", "User-Agent": "LazyNotesServer/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            info = json.loads(r.read().decode())
    except Exception:
        return _done({"error": "Couldn't reach Google. Try again.", "from": src})
    email = str(info.get("email") or "").strip().lower()
    if not email or info.get("email_verified") in (False, "false"):
        return _done({"error": "Google didn't give a verified email address.", "from": src})
    row = store.user_by_name(email)
    if row:
        user_id = row[0]
    elif src != "ext":
        return _done({"error": "No account for that email yet: create it in the Q-notes extension on your computer first.", "from": src})
    elif SIGNUPS != "open":
        return _done({"error": "This server only takes new accounts with an invite code: create yours with email + password in the extension.", "from": src})
    else:
        user_id = store.add_user(email, "google$" + secrets.token_hex(16))   # no password: Google only (until one is set)
    token = secrets.token_urlsafe(32)
    store.add_token(token_hash(token), user_id)
    return _done({"token": token, "user": email, "from": src})


@app.get("/auth/done")
def auth_done():
    return _named("auth-done.html", "text/html")


@app.get("/reset")
def reset_page():
    # Forgot password (no #t=) or choose a new one (#t=<token> from the link).
    return _named("reset.html", "text/html")


# --------------------------------------------------------------------------
# Sharing a topic: a read-only link anyone can open, and optionally a copy in
# another account's inbox. The topic is copied at the moment you share it.
# --------------------------------------------------------------------------

@app.post("/api/share")
def share_topic():
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    body = request.get_json(silent=True) or {}
    topic = body.get("notes")
    if not isinstance(topic, dict):
        return jsonify(ok=False, reason="no notes to share"), 400
    to_id = None
    to = str(body.get("to") or "").strip().lower()
    if to:
        row = store.user_by_name(to)
        if not row:
            return jsonify(ok=False, code="NO_SUCH_USER", reason=f"There's no account called {to} on this server."), 404
        to_id = row[0]
    share_id = secrets.token_urlsafe(9)
    data = {"course": str(body.get("course") or ""), "topic": str(body.get("topic") or ""), "notes": topic,
            "from": "the server owner" if w == OWNER else store.username(w)}
    store.add_share(share_id, user_id_of(w), to_id, data["topic"], data)
    return jsonify(ok=True, id=share_id, url=f"{request.host_url.rstrip('/')}/s/{share_id}")


@app.get("/api/share/<share_id>")
def get_share(share_id):
    sh = store.share(share_id)
    if not sh:
        return jsonify(ok=False, reason="That shared link doesn't exist (or was mistyped)."), 404
    return jsonify(ok=True, createdAt=sh["createdAt"], **sh["body"])


@app.get("/api/inbox")
def inbox():
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    if w == OWNER:
        return jsonify(ok=True, items=[])
    items = [{"id": i, "from": store.username(o) if o else "the server owner", "createdAt": at, "title": t}
             for (i, o, at, t) in store.inbox(w)]
    return jsonify(ok=True, items=items)


# --------------------------------------------------------------------------
# Documents: the extension backs up the files you read, the phone opens them.
#   GET  /api/docs                 → { items: [{ sha, name, kind, state, … }], used, limit }
#        state: "stored" (here) | "delivered" (a phone kept it; deleted here) | "wanted"
#   DELETE /api/docs/<sha>         a phone kept it: delete it here, mark "delivered"
#   POST /api/docs/<sha>/want      a phone lost it: the extension sends it again
#   PUT  /api/docs/<sha>?name=&kind=   raw bytes (≤ 25 MB, ≤ 400 MB per account)
#   GET  /api/docs/<sha>           → the file
# --------------------------------------------------------------------------
DOC_MAX = 25 * 1024 * 1024
DOC_TOTAL = 400 * 1024 * 1024
DOC_TYPES = {"pdf": "application/pdf",
             "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
             "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def user_key_of(w):
    return "owner" if w == OWNER else str(w)


@app.get("/api/docs")
def docs_list():
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    k = user_key_of(w)
    return jsonify(ok=True, items=store.doc_list(k), used=store.doc_used(k), limit=DOC_TOTAL)


@app.put("/api/docs/<sha>")
def docs_put(sha):
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    if not re.match(r"^[0-9a-f]{64}$", sha):
        return jsonify(ok=False, reason="bad document id"), 400
    body = request.get_data(cache=False)
    if not body:
        return jsonify(ok=False, reason="empty document"), 400
    if len(body) > DOC_MAX:
        return jsonify(ok=False, code="DOC_TOO_BIG", reason="Documents over 25 MB aren't copied to your account."), 413
    if hashlib.sha256(body).hexdigest() != sha:
        return jsonify(ok=False, reason="the document arrived damaged; it will be sent again"), 400
    k = user_key_of(w)
    if store.doc_used(k) + len(body) > DOC_TOTAL:
        return jsonify(ok=False, code="DOCS_FULL", reason="Your account's document space (400 MB) is full."), 413
    kind = request.args.get("kind", "pdf")
    added = store.doc_put(k, sha, str(request.args.get("name", "document"))[:200], kind if kind in DOC_TYPES else "pdf", body)
    store.doc_mark(k, sha, None)   # stored again: no "delivered" / "wanted" mark
    return jsonify(ok=True, added=added)


@app.delete("/api/docs/<sha>")
def docs_delivered(sha):
    """A phone has kept the document: the server's copy goes."""
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    k = user_key_of(w)
    row = store.doc_delete(k, sha)
    if row:
        store.doc_mark(k, sha, "delivered", row[0], row[1])
    return jsonify(ok=True)


@app.post("/api/docs/<sha>/want")
def docs_want(sha):
    """A phone needs it again: the extension sends it on its next sync."""
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    body = request.get_json(silent=True) or {}
    store.doc_mark(user_key_of(w), sha, "wanted", str(body.get("name") or "")[:200], str(body.get("kind") or "pdf"))
    return jsonify(ok=True)


@app.get("/api/docs/<sha>")
def docs_get(sha):
    w = who()
    if w is None:
        return jsonify(ok=False, reason="wrong or missing key"), 401
    got = store.doc_get(user_key_of(w), sha)
    if not got:
        return jsonify(ok=False, reason="That document isn't in your account (open it once in the extension while logged in)."), 404
    name, kind, body = got
    r = Response(body, mimetype=DOC_TYPES.get(kind, "application/octet-stream"))
    r.headers["Content-Disposition"] = f"inline; filename*=UTF-8''{urllib.parse.quote(name)}"
    r.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return r


# Every AI failure says what went wrong as a short code the extension can show
# and look up, plus a plain reason. Codes:
#   SYNC_KEY_WRONG      the extension's sync key isn't this server's LAZYNOTES_KEY
#   NO_AI_KEY           AI_KEY isn't set on Render
#   BAD_PROVIDER        AI_PROVIDER unknown and no AI_BASE
#   EMPTY_PROMPT        nothing was sent
#   AI_KEY_REFUSED      the service said 401 to AI_KEY
#   AI_FORBIDDEN        403 (key lacks access to that model / region)
#   AI_BLOCKED          the service's firewall (Cloudflare) blocked the server
#   AI_MODEL_NOT_FOUND  404: AI_MODEL is wrong
#   AI_RATE_LIMIT       429: free allowance used up
#   AI_BAD_REQUEST      400 from the service
#   AI_SERVICE_ERROR    5xx / other from the service
#   AI_TIMEOUT          no answer in time
#   AI_UNREACHABLE      DNS / TLS / network from Render to the service
#   AI_BAD_REPLY / AI_EMPTY  an answer we couldn't use
# What testers see: plain words, no server workings (no key names, no Render,
# no service or model). The full reason goes to the server log, and to the
# owner (the server key) in the answer.
FRIENDLY = {
    "SYNC_KEY_WRONG": "You've been logged out. Log in again.",
    "EMPTY_PROMPT": "Nothing to ask.",
    "AI_RATE_LIMIT": "The AI is busy right now. Try again in a few minutes.",
    "AI_TIMEOUT": "The AI took too long to answer. Try again.",
    "AI_DAILY_CAP": f"You've used today's {AI_ROUTER.cap} AI questions. They come back tomorrow; the offline helpers still work.",
}
AI_DOWN = "The AI isn't available right now. Try again later."


def ai_fail(code, reason, status, upstream=None):
    app.logger.warning("AI %s (%s): %s", code, status, reason)
    if who() == OWNER:
        out = {"ok": False, "code": code, "reason": reason, "provider": AI_PROVIDER}
        if upstream is not None:
            out["upstream_status"] = upstream
    else:
        out = {"ok": False, "code": code, "reason": FRIENDLY.get(code, AI_DOWN)}
    return jsonify(out), status


def ai_config_problem():
    if not AI_ROUTER.routes:
        return ("NO_AI_KEY", "This server has no AI key: add GEMINI_KEY or GROQ_KEY (or another service's key, see server/ai_router.py) in Render › lazy-notes › Environment.")
    return None


@app.get("/api/ai/status")
def ai_status():
    """What the server's AI set-up looks like, without asking the AI: is a key
    there, which service and model. Never returns the key itself."""
    if not authorized():
        return ai_fail("SYNC_KEY_WRONG", "Your server refused the sync key (LAZYNOTES_KEY).", 401)
    service = AI_SERVICES.get(AI_PROVIDER) or {}
    problem = ai_config_problem()
    if who() != OWNER:   # testers: ready or not, nothing about the set-up
        return jsonify(ok=not problem, code=problem[0] if problem else "READY",
                       reason=AI_DOWN if problem else "The AI is ready.")
    return jsonify(ok=not problem, code=problem[0] if problem else "READY",
                   reason=problem[1] if problem else "AI is set up on this server.",
                   has_key=bool(AI_KEY), key_length=len(AI_KEY),
                   key_looks_like=("groq (gsk_…)" if AI_KEY.startswith("gsk_") else "google (AIza…)" if AI_KEY.startswith("AIza")
                                   else "anthropic (sk-ant-…)" if AI_KEY.startswith("sk-ant-") else "openrouter (sk-or-…)" if AI_KEY.startswith("sk-or-")
                                   else "unknown" if AI_KEY else "none"),
                   key_had_spaces=AI_KEY_RAW != AI_KEY,
                   provider=", ".join(AI_ROUTER.services()) or AI_PROVIDER, model="auto (routed)",
                   base=AI_BASE or service.get("base", ""), routing=AI_ROUTER.status(detail=True))


@app.post("/api/ai")
def ask_ai():
    """Relay one question to the AI service, adding our own AI key.

    The extension sends { system, prompt, max_tokens } — it builds the job, so
    the wording of every job stays in one place (background/bg_ai.js). This
    only adds the key and translates between the services' request shapes.
    """
    if not authorized():
        return ai_fail("SYNC_KEY_WRONG", "Your server refused the sync key (LAZYNOTES_KEY).", 401)
    problem = ai_config_problem()
    if problem:
        return ai_fail(*problem, 503)
    body = request.get_json(silent=True) or {}
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        return ai_fail("EMPTY_PROMPT", "Nothing to ask.", 400)
    system = str(body.get("system") or "")
    try:
        max_tokens = max(1, min(int(body.get("max_tokens") or 1000), 4000))
    except (TypeError, ValueError):
        max_tokens = 1000

    w = who()
    ok, out = AI_ROUTER.ask(system, prompt, max_tokens, user_key=None if w == OWNER else w)
    if not ok:
        return ai_fail(*out)
    # No prompt, no key, no note text is stored or logged here.
    return jsonify(ok=True, **out)


@app.errorhandler(413)
def too_big(_e):
    return jsonify(ok=False, reason="snapshot over 30 MB"), 413


# --------------------------------------------------------------------------
# Mobile site
# --------------------------------------------------------------------------

# The name shown on the phone site (and when installed). Change it any time
# with the APP_NAME environment variable; default "Q-notes".
APP_NAME = os.environ.get("APP_NAME", "Q-notes").strip() or "Q-notes"


def _named(filename, mimetype):
    with open(os.path.join(HERE, "static", filename), encoding="utf-8") as f:
        text = f.read().replace("Q-notes", APP_NAME.replace('"', "'"))
    r = Response(text, mimetype=mimetype)
    r.headers["Cache-Control"] = "no-cache"
    return r


# The site: / (what Q-notes is) → /get (download) → /login → /app (your
# notes). The landing and download pages live in ../site, the same files
# GitHub Pages publishes, so the two sites never drift apart.
SITE = os.path.join(os.path.dirname(HERE), "site")


def _site(filename, mimetype):
    with open(os.path.join(SITE, filename), encoding="utf-8") as f:
        text = f.read().replace("Q-notes", APP_NAME.replace('"', "'"))
    r = Response(text, mimetype=mimetype)
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/")
def index():
    return _site("index.html", "text/html")


@app.get("/login")
@app.get("/app")
def phone_app():
    # The notes reader (static/app.js): /login shows the login form, /app your notes.
    return _named("index.html", "text/html")


@app.get("/site.css")
def site_css():
    return send_from_directory(SITE, "site.css", mimetype="text/css")


@app.get("/site.js")
def site_js():
    return send_from_directory(SITE, "site.js", mimetype="text/javascript")


@app.get("/logo.svg")
def site_logo():
    return send_from_directory(SITE, "logo.svg", mimetype="image/svg+xml")


@app.get("/img/<path:name>")
def site_img(name):
    r = send_from_directory(os.path.join(SITE, "img"), name)
    r.headers["Cache-Control"] = "public, max-age=86400"
    return r


# --------------------------------------------------------------------------
# Download the extension: /get (a page with the steps) and
# /download/lazy-notes.zip (the extension's files, zipped from this deploy, so
# it's always the latest code on main). Render keeps the whole repo next to
# server/, so the zip is made from there; left out: the server, docs, tools.
# --------------------------------------------------------------------------

EXT_ROOT = os.path.dirname(HERE)
SKIP_TOP = {"server", "docs", "tools", "site", ".git", ".github", "node_modules", "test-bench-out"}
_zip_cache = None


def extension_zip():
    global _zip_cache
    if _zip_cache is None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for folder, dirs, files in os.walk(EXT_ROOT):
                rel_dir = os.path.relpath(folder, EXT_ROOT)
                top = rel_dir.split(os.sep)[0]
                if top in SKIP_TOP:
                    dirs[:] = []
                    continue
                dirs[:] = [d for d in dirs if not (rel_dir == "." and d in SKIP_TOP) and not d.startswith(".")]
                for f in files:
                    if f.startswith(".") or f.endswith((".md", ".db", ".pyc")) or f == "render.yaml":
                        continue
                    path = os.path.join(folder, f)
                    z.write(path, os.path.relpath(path, EXT_ROOT))   # top level: "Extract All" makes the folder
            # Which version this is, for the extension's "newer version" notice.
            sha = os.environ.get("RENDER_GIT_COMMIT", "")
            if sha:
                z.writestr("build.json", json.dumps({"sha": sha, "time": now_iso()}))
        _zip_cache = buf.getvalue()
    return _zip_cache


@app.get("/get")
@app.get("/get.html")
def get_page():
    return _site("get.html", "text/html")


@app.get("/qnotes.zip")                # the download page links it next to itself (as on GitHub Pages)
@app.get("/download/qnotes.zip")
@app.get("/download/lazy-notes.zip")   # the old name: links already sent keep working
def download_zip():
    if not os.path.exists(os.path.join(EXT_ROOT, "manifest.json")):
        return jsonify(ok=False, reason="The extension's files aren't on this server."), 404
    r = Response(extension_zip(), mimetype="application/zip")
    r.headers["Content-Disposition"] = 'attachment; filename="qnotes.zip"'
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/s/<share_id>")
def shared_page(share_id):
    # The phone site reads the id from the address and shows that topic.
    return _named("index.html", "text/html")


@app.get("/manifest.webmanifest")
def web_manifest():
    return _named("manifest.webmanifest", "application/manifest+json")


@app.get("/sw.js")
def service_worker():
    # At the site root so it can control every page.
    r = send_from_directory(os.path.join(HERE, "static"), "sw.js", mimetype="text/javascript")
    r.headers["Cache-Control"] = "no-cache"
    r.headers["Service-Worker-Allowed"] = "/"
    return r


@app.get("/static/app.js")
def app_js():
    return _named("app.js", "text/javascript")


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
    print(f"  Q-notes server on http://0.0.0.0:{port}  (open http://<this computer's IP>:{port} on your phone)")
    app.run(host="0.0.0.0", port=port)
else:
    # gunicorn app:app
    setup()
