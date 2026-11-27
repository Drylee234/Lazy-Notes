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
import re
import os
import secrets
import socket
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = 6                       # latest + 5 previous
MAX_BODY = 30 * 1024 * 1024    # figures travel as data URLs

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY

KEY = os.environ.get("LAZYNOTES_KEY", "")
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
        resp.headers["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
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


@app.get("/api/report")
def get_report():
    """The usage + error report from the last sync (no notes), for debugging."""
    if not authorized():
        return jsonify(ok=False, reason="wrong or missing key"), 401
    latest = store.latest()
    if not latest:
        return jsonify(ok=False, reason="nothing synced yet"), 404
    saved_at, data = latest
    return jsonify(savedAt=saved_at, report=(data or {}).get("lnReport"))


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
def ai_fail(code, reason, status, upstream=None):
    out = {"ok": False, "code": code, "reason": reason, "provider": AI_PROVIDER}
    if upstream is not None:
        out["upstream_status"] = upstream
    return jsonify(out), status


def ai_config_problem():
    if not AI_KEY:
        return ("NO_AI_KEY", "This server has no AI key: add AI_KEY in Render › lazy-notes › Environment.")
    if AI_PROVIDER not in AI_SERVICES and not AI_BASE:
        return ("BAD_PROVIDER", f"AI_PROVIDER '{AI_PROVIDER}' isn't one I know (groq, gemini, anthropic, openrouter), and no AI_BASE was given.")
    return None


@app.get("/api/ai/status")
def ai_status():
    """What the server's AI set-up looks like, without asking the AI: is a key
    there, which service and model. Never returns the key itself."""
    if not authorized():
        return ai_fail("SYNC_KEY_WRONG", "Your server refused the sync key (LAZYNOTES_KEY).", 401)
    service = AI_SERVICES.get(AI_PROVIDER) or {}
    problem = ai_config_problem()
    return jsonify(ok=not problem, code=problem[0] if problem else "READY",
                   reason=problem[1] if problem else "AI is set up on this server.",
                   has_key=bool(AI_KEY), key_length=len(AI_KEY),
                   key_looks_like=("groq (gsk_…)" if AI_KEY.startswith("gsk_") else "google (AIza…)" if AI_KEY.startswith("AIza")
                                   else "anthropic (sk-ant-…)" if AI_KEY.startswith("sk-ant-") else "openrouter (sk-or-…)" if AI_KEY.startswith("sk-or-")
                                   else "unknown" if AI_KEY else "none"),
                   key_had_spaces=AI_KEY_RAW != AI_KEY,
                   provider=AI_PROVIDER, model=AI_MODEL or service.get("model", ""),
                   base=AI_BASE or service.get("base", ""))


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
    service = AI_SERVICES.get(AI_PROVIDER) or {"shape": "openai", "base": AI_BASE, "model": AI_MODEL}

    body = request.get_json(silent=True) or {}
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        return ai_fail("EMPTY_PROMPT", "Nothing to ask.", 400)
    system = str(body.get("system") or "")
    try:
        max_tokens = max(1, min(int(body.get("max_tokens") or 1000), 4000))
    except (TypeError, ValueError):
        max_tokens = 1000

    model = AI_MODEL or service["model"]
    base = AI_BASE or service["base"]
    shape = service["shape"]

    if shape == "gemini":
        url = f"{base}/models/{model}:generateContent"
        headers = {"Content-Type": "application/json", "x-goog-api-key": AI_KEY}
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                   "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2}}
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
    elif shape == "anthropic":
        url = f"{base}/messages"
        headers = {"Content-Type": "application/json", "x-api-key": AI_KEY,
                   "anthropic-version": "2023-06-01"}
        payload = {"model": model, "max_tokens": max_tokens,
                   "messages": [{"role": "user", "content": prompt}]}
        if system:
            payload["system"] = system
    else:
        url = f"{base}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {AI_KEY}"}
        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": prompt}]
        thinking = re.search(r"gpt-oss|qwen3|deepseek-r1|reason", model, re.I)
        payload = {"model": model, "max_tokens": max(max_tokens, 400) if thinking else max_tokens,
                   "temperature": 0.2, "messages": messages}
        if "gpt-oss" in model.lower():
            payload["reasoning_effort"] = "low"   # think briefly, or a short answer comes back empty

    # A real User-Agent: Cloudflare in front of some services (Groq) blocks
    # Python's default "Python-urllib/x" with a 403 "error code: 1010".
    headers["User-Agent"] = "LazyNotesServer/1.0"
    headers["Accept"] = "application/json"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=AI_TIMEOUT) as answer:
            raw = answer.read().decode("utf-8", "replace")
        try:
            data = json.loads(raw or "{}")
        except ValueError:
            return ai_fail("AI_BAD_REPLY", f"The AI service answered with something that isn't JSON: {raw[:120]}", 502)
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")[:400]
        detail = raw
        try:
            j = json.loads(raw)
            e = j.get("error")
            detail = (e.get("message") if isinstance(e, dict) else e) or j.get("message") or raw
        except Exception:
            pass
        detail = str(detail).strip()[:300]
        st = err.code
        if st in (401, 403) and ("1010" in raw or "cloudflare" in raw.lower()):
            return ai_fail("AI_BLOCKED", f"The AI service's firewall blocked this server ({st}). {detail}", 502, st)
        if st == 401:
            return ai_fail("AI_KEY_REFUSED", f"The AI service refused AI_KEY: check it's complete and still valid. {detail}", 502, st)
        if st == 403:
            return ai_fail("AI_FORBIDDEN", f"The AI service won't let this key do that (403). {detail}", 502, st)
        if st == 404:
            return ai_fail("AI_MODEL_NOT_FOUND", f"Model '{model}' isn't there: set AI_MODEL on Render. {detail}", 502, st)
        if st == 429:
            return ai_fail("AI_RATE_LIMIT", f"The AI service's allowance is used up for now. {detail}", 502, st)
        if st == 400:
            return ai_fail("AI_BAD_REQUEST", f"The AI service didn't accept the request. {detail}", 502, st)
        return ai_fail("AI_SERVICE_ERROR", f"The AI service had a problem ({st}). {detail}", 502, st)
    except socket.timeout:
        return ai_fail("AI_TIMEOUT", f"The AI service took over {AI_TIMEOUT}s to answer.", 504)
    except urllib.error.URLError as err:
        why = getattr(err, "reason", err)
        if isinstance(why, socket.timeout):
            return ai_fail("AI_TIMEOUT", f"The AI service took over {AI_TIMEOUT}s to answer.", 504)
        return ai_fail("AI_UNREACHABLE", f"This server couldn't reach {urllib.parse.urlsplit(url).hostname} ({why}).", 502)
    except Exception as err:
        return ai_fail("AI_UNREACHABLE", f"Couldn't reach the AI service ({type(err).__name__}: {err}).", 502)

    if shape == "gemini":
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text") or "" for p in parts)
    elif shape == "anthropic":
        text = "".join(b.get("text") or "" for b in (data.get("content") or [])
                       if b.get("type") == "text")
    else:
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""

    text = text.strip()
    if not text:
        finish = ""
        if shape == "openai":
            finish = (data.get("choices") or [{}])[0].get("finish_reason") or ""
        if finish == "length":
            return ai_fail("AI_TOO_SHORT", f"Model '{model}' used all its room thinking and wrote no answer. Allow more tokens or pick a non-thinking model (AI_MODEL).", 502)
        return ai_fail("AI_EMPTY", f"The AI service answered with nothing (model '{model}'{', stop: ' + finish if finish else ''}).", 502)
    # No prompt, no key, no note text is stored or logged here.
    return jsonify(ok=True, text=text, model=model, provider=AI_PROVIDER)


@app.errorhandler(413)
def too_big(_e):
    return jsonify(ok=False, reason="snapshot over 30 MB"), 413


# --------------------------------------------------------------------------
# Mobile site
# --------------------------------------------------------------------------

# The name shown on the phone site (and when installed). Change it any time
# with the APP_NAME environment variable; default "Lazy Notes".
APP_NAME = os.environ.get("APP_NAME", "Lazy Notes").strip() or "Lazy Notes"


def _named(filename, mimetype):
    with open(os.path.join(HERE, "static", filename), encoding="utf-8") as f:
        text = f.read().replace("Lazy Notes", APP_NAME.replace('"', "'"))
    r = Response(text, mimetype=mimetype)
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/")
def index():
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
    print(f"  Lazy Notes server on http://0.0.0.0:{port}  (open http://<this computer's IP>:{port} on your phone)")
    app.run(host="0.0.0.0", port=port)
else:
    # gunicorn app:app
    setup()
