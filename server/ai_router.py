"""AI routing: many free AI services and models, picked automatically.

Each service gets ONE key, set on Render (lazy-notes › Environment). A service
without a key is simply skipped. Free plans limit each account per model per
day; this spreads the questions over every model you have a key for, so the
total free allowance is the sum of all of them.

    GROQ_KEY          https://console.groq.com/keys                 (gsk_…)
    GEMINI_KEY        https://aistudio.google.com/apikey            (AIza…)
    CEREBRAS_KEY      https://cloud.cerebras.ai  › API keys         (csk-…)
    OPENROUTER_KEY    https://openrouter.ai/keys                    (sk-or-…)
    MISTRAL_KEY       https://console.mistral.ai/api-keys           (free "Experiment" plan)
    GITHUB_MODELS_KEY https://github.com/settings/tokens  fine-grained token with "Models: read"
    CLOUDFLARE_KEY    https://dash.cloudflare.com › AI › Workers AI › API token
      + CLOUDFLARE_ACCOUNT_ID  (the account id shown on that page)
    SAMBANOVA_KEY     https://cloud.sambanova.ai/apis

The old single-service set-up (AI_KEY + AI_PROVIDER + AI_MODEL) still works and
is added to the pool.

Optional:
    AI_MODELS_<SERVICE>   your own comma-separated model list for a service,
                          e.g. AI_MODELS_GROQ=llama-3.3-70b-versatile,openai/gpt-oss-20b
    AI_BASE_<SERVICE>     a different address (used by the tests)
    AI_DAILY_CAP          questions per account per day (default 40; 0 = no cap).
                          The server owner (LAZYNOTES_KEY) has no cap.

How a question is routed
  1. Only routes (service + model) that aren't resting and have room left
     this minute and today are considered.
  2. The best tier first (big models), and inside a tier the route with the
     largest share of today's allowance still unused, so the load spreads.
  3. "Too many requests" → that route rests (until the time the service gives,
     or a minute, or till midnight UTC for a daily limit) and the next is tried.
     Model not found → skipped for a day. Key refused → that service skipped
     for an hour. Service error / timeout → rests 2 minutes.
  4. At most 5 tries and ~50 seconds in all (the extension waits 60).

Counts live in memory (one gunicorn worker); a restart forgets them, and the
services' own "too many requests" answers teach them again.

Free limits change often; the numbers below are a best guess (late 2026) and
only steer the spreading. A wrong model name costs one quick skip.
"""
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# rpm = requests per minute, rpd = per day, tier 1 = best. "bucket": routes
# that share one allowance (OpenRouter, Mistral, Cloudflare count per account).
SERVICES = {
    "groq": {
        "env": "GROQ_KEY", "shape": "openai", "base": "https://api.groq.com/openai/v1",
        "models": [
            ("openai/gpt-oss-120b", 1, 30, 1000),
            ("llama-3.3-70b-versatile", 1, 30, 1000),
            ("moonshotai/kimi-k2-instruct", 1, 60, 1000),
            ("qwen/qwen3-32b", 2, 60, 1000),
            ("openai/gpt-oss-20b", 2, 30, 1000),
            ("meta-llama/llama-4-scout-17b-16e-instruct", 2, 30, 1000),
            ("llama-3.1-8b-instant", 3, 30, 14400),
        ],
    },
    "gemini": {
        "env": "GEMINI_KEY", "shape": "gemini", "base": "https://generativelanguage.googleapis.com/v1beta",
        "models": [
            ("gemini-2.5-flash", 1, 10, 20),
            ("gemini-flash-latest", 1, 10, 20),
            ("gemini-2.5-flash-lite", 2, 15, 1000),
            ("gemini-flash-lite-latest", 2, 15, 1000),
            ("gemini-2.0-flash", 2, 15, 200),
        ],
    },
    "cerebras": {
        "env": "CEREBRAS_KEY", "shape": "openai", "base": "https://api.cerebras.ai/v1",
        "models": [
            ("gpt-oss-120b", 1, 30, 14400),
            ("llama-3.3-70b", 1, 30, 14400),
            ("qwen-3-235b-a22b-instruct-2507", 1, 30, 14400),
            ("qwen-3-32b", 2, 30, 14400),
            ("llama3.1-8b", 3, 30, 14400),
        ],
    },
    "openrouter": {
        "env": "OPENROUTER_KEY", "shape": "openai", "base": "https://openrouter.ai/api/v1", "bucket": 50,
        "models": [
            ("deepseek/deepseek-chat-v3.1:free", 1, 20, 50),
            ("meta-llama/llama-3.3-70b-instruct:free", 1, 20, 50),
            ("qwen/qwen3-235b-a22b:free", 1, 20, 50),
            ("openai/gpt-oss-120b:free", 1, 20, 50),
            ("mistralai/mistral-small-3.2-24b-instruct:free", 2, 20, 50),
        ],
    },
    "mistral": {
        "env": "MISTRAL_KEY", "shape": "openai", "base": "https://api.mistral.ai/v1", "bucket": 2000,
        "models": [
            ("mistral-medium-latest", 1, 60, 2000),
            ("mistral-small-latest", 2, 60, 2000),
            ("open-mistral-nemo", 3, 60, 2000),
        ],
    },
    "github": {
        "env": "GITHUB_MODELS_KEY", "shape": "openai", "base": "https://models.github.ai/inference",
        "models": [
            ("openai/gpt-4.1-mini", 1, 15, 150),
            ("openai/gpt-4o-mini", 2, 15, 150),
            ("meta/Llama-3.3-70B-Instruct", 1, 15, 150),
        ],
    },
    "cloudflare": {
        "env": "CLOUDFLARE_KEY", "shape": "openai", "bucket": 300,
        "base": "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
        "models": [
            ("@cf/openai/gpt-oss-120b", 1, 60, 300),
            ("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 1, 60, 300),
            ("@cf/meta/llama-3.1-8b-instruct", 3, 60, 300),
        ],
    },
    "sambanova": {
        "env": "SAMBANOVA_KEY", "shape": "openai", "base": "https://api.sambanova.ai/v1",
        "models": [
            ("Meta-Llama-3.3-70B-Instruct", 1, 20, 400),
            ("DeepSeek-V3.1", 1, 20, 400),
            ("Meta-Llama-3.1-8B-Instruct", 3, 20, 400),
        ],
    },
}

# The old single-service names (AI_PROVIDER) → this table.
LEGACY = {"groq": "groq", "gemini": "gemini", "openrouter": "openrouter", "anthropic": "anthropic"}

MAX_TRIES = 5
TOTAL_SECONDS = 50
TRY_SECONDS = 30
UA = "LazyNotesServer/1.0"   # Cloudflare in front of Groq blocks Python's default UA


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _secs_to_midnight():
    now = datetime.now(timezone.utc)
    return 86400 - (now.hour * 3600 + now.minute * 60 + now.second) + 5


class Route:
    def __init__(self, service, model, tier, rpm, rpd, key, shape, base, bucket):
        self.service, self.model, self.tier, self.rpm, self.rpd = service, model, tier, rpm, rpd
        self.key, self.shape, self.base, self.bucket = key, shape, base, bucket

    @property
    def name(self):
        return f"{self.service}:{self.model}"


class Router:
    def __init__(self, env=None):
        self.env = env if env is not None else os.environ
        self.lock = threading.Lock()
        self.routes = self._build()
        self.day = _today()
        self.used = {}        # route/bucket name → count today
        self.minute = {}      # route name → [timestamps in the last 60 s]
        self.rest = {}        # route name or "svc:<service>" → until (epoch s)
        self.why = {}         # same keys → last reason (for /api/ai/status)
        self.users = {}       # user key → count today
        try:
            self.cap = int(self.env.get("AI_DAILY_CAP", "40"))
        except ValueError:
            self.cap = 40

    # ── set-up ──
    def _build(self):
        routes = []
        e = self.env
        for svc, s in SERVICES.items():
            key = (e.get(s["env"]) or "").strip()
            if not key:
                continue
            base = (e.get(f"AI_BASE_{svc.upper()}") or s["base"]).rstrip("/")
            if "{account}" in base:
                acct = (e.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
                if not acct:
                    continue
                base = base.replace("{account}", acct)
            models = s["models"]
            own = [m.strip() for m in (e.get(f"AI_MODELS_{svc.upper()}") or "").split(",") if m.strip()]
            if own:
                known = {m[0]: m for m in models}
                models = [known.get(m, (m, 1, 20, 500)) for m in own]
            bucket = f"{svc}:*" if s.get("bucket") else None
            for (model, tier, rpm, rpd) in models:
                routes.append(Route(svc, model, tier, rpm, rpd, key, s["shape"], base, bucket))
        # The old one-service set-up: AI_KEY (+ AI_PROVIDER, AI_MODEL, AI_BASE).
        old_key = (e.get("AI_KEY") or "").strip()
        if old_key:
            prov = (e.get("AI_PROVIDER") or "groq").strip().lower()
            model = (e.get("AI_MODEL") or "").strip()
            base = (e.get("AI_BASE") or "").strip().rstrip("/")
            if prov == "anthropic":
                routes.append(Route("anthropic", model or "claude-opus-5-5", 1, 50, 100000, old_key, "anthropic",
                                    base or "https://api.anthropic.com/v1", None))
            elif prov in SERVICES and not any(r.service == prov and r.key == old_key for r in routes):
                s = SERVICES[prov]
                for (m, tier, rpm, rpd) in ([x for x in s["models"] if x[0] == model] or [(model, 1, 30, 1000)] if model else s["models"]):
                    routes.append(Route(prov, m, tier, rpm, rpd, old_key, s["shape"], base or s["base"],
                                        f"{prov}:*" if s.get("bucket") else None))
            elif prov not in SERVICES and base:
                routes.append(Route(prov, model or "default", 1, 30, 1000, old_key, "openai", base, None))
        return routes

    def services(self):
        return sorted({r.service for r in self.routes})

    # ── bookkeeping ──
    def _roll(self):
        if self.day != _today():
            self.day, self.used, self.users = _today(), {}, {}

    def _limit_of(self, r):
        return SERVICES.get(r.service, {}).get("bucket") or r.rpd

    def _count(self, r):
        return self.used.get(r.bucket or r.name, 0)

    def _ok_now(self, r, now):
        if self.rest.get(r.name, 0) > now or self.rest.get(f"svc:{r.service}", 0) > now:
            return False
        if self._count(r) >= self._limit_of(r):
            return False
        recent = [t for t in self.minute.get(r.name, []) if t > now - 60]
        self.minute[r.name] = recent
        return len(recent) < r.rpm

    def _pick(self, tried):
        now = time.time()
        free = [r for r in self.routes if r.name not in tried and self._ok_now(r, now)]
        if not free:
            return None
        best_tier = min(r.tier for r in free)
        tier = [r for r in free if r.tier == best_tier]
        # Most of today's allowance left (as a share) first; ties → fewest used.
        return max(tier, key=lambda r: (1 - self._count(r) / max(1, self._limit_of(r)), -self._count(r)))

    def _note_use(self, r):
        self.used[r.bucket or r.name] = self._count(r) + 1
        self.minute.setdefault(r.name, []).append(time.time())

    def _rest(self, key, seconds, why):
        self.rest[key] = time.time() + seconds
        self.why[key] = why

    # ── the per-account cap ──
    def over_cap(self, user_key):
        """True when this account has used today's questions (owner: never)."""
        if user_key is None or self.cap <= 0:
            return False
        with self.lock:
            self._roll()
            return self.users.get(user_key, 0) >= self.cap

    def _count_user(self, user_key):
        if user_key is not None:
            self.users[user_key] = self.users.get(user_key, 0) + 1

    # ── asking ──
    def ask(self, system, prompt, max_tokens, user_key=None, opener=None):
        """→ (True, {text, model, provider}) or (False, (code, reason, status, upstream))."""
        opener = opener or urllib.request.urlopen
        if not self.routes:
            return False, ("NO_AI_KEY", "This server has no AI key: add GROQ_KEY or GEMINI_KEY (or another service's key) in Render › lazy-notes › Environment.", 503, None)
        if self.over_cap(user_key):
            return False, ("AI_DAILY_CAP", f"You've used today's {self.cap} AI questions. They come back at midnight (UTC). The offline helpers still work.", 429, None)
        start = time.time()
        tried, last = set(), None
        while len(tried) < MAX_TRIES and time.time() - start < TOTAL_SECONDS - 3:
            with self.lock:
                self._roll()
                r = self._pick(tried)
                if r is None:
                    break
                self._note_use(r)
            tried.add(r.name)
            left = max(5, min(TRY_SECONDS, TOTAL_SECONDS - (time.time() - start)))
            ok, out = self._call(r, system, prompt, max_tokens, left, opener)
            if ok:
                with self.lock:
                    self._count_user(user_key)
                return True, {"text": out, "model": r.model, "provider": r.service}
            code, reason, status, upstream, rest = out
            last = (code, reason, status, upstream)
            with self.lock:
                if rest:
                    self._rest(*rest)
            if code in ("AI_BAD_REQUEST",) and upstream == 400 and "context" in reason.lower():
                continue   # too long for this model: another may take it
        if last is None:
            return False, ("AI_RATE_LIMIT", "Every free AI model is used up for now. Try again in a minute; the daily ones come back at midnight (UTC). The offline helpers still work.", 503, None)
        if last[0] in ("AI_RATE_LIMIT",) or len(tried) > 1:
            return False, ("AI_RATE_LIMIT" if last[0] == "AI_RATE_LIMIT" else last[0],
                           f"Tried {len(tried)} AI model(s), none answered. Last: {last[1]}", last[2], last[3])
        return False, last

    # ── one service call ──
    def _request(self, r, system, prompt, max_tokens):
        model = r.model
        if r.shape == "gemini":
            url = f"{r.base}/models/{model}:generateContent"
            headers = {"x-goog-api-key": r.key}
            gen = {"maxOutputTokens": max_tokens, "temperature": 0.2}
            if "2.5" in model:
                gen["thinkingConfig"] = {"thinkingBudget": 0}   # answer, don't think (thinking eats the room)
            else:
                gen["maxOutputTokens"] = max(max_tokens * 2, 1024)
            payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": gen}
            if system:
                payload["systemInstruction"] = {"parts": [{"text": system}]}
        elif r.shape == "anthropic":
            url = f"{r.base}/messages"
            headers = {"x-api-key": r.key, "anthropic-version": "2023-06-01"}
            payload = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
            if system:
                payload["system"] = system
        else:
            url = f"{r.base}/chat/completions"
            headers = {"Authorization": f"Bearer {r.key}"}
            messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
            thinking = re.search(r"gpt-oss|qwen3|qwen-3|deepseek-r1|reason", model, re.I)
            payload = {"model": model, "max_tokens": max(max_tokens, 400) if thinking else max_tokens,
                       "temperature": 0.2, "messages": messages}
            if "gpt-oss" in model.lower() and r.service in ("groq", "cerebras", "openrouter"):
                payload["reasoning_effort"] = "low"
        headers.update({"Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
        return url, headers, payload

    def _call(self, r, system, prompt, max_tokens, timeout, opener):
        """→ (True, text) or (False, (code, reason, status, upstream, rest))
        where rest = (key, seconds, why) or None."""
        url, headers, payload = self._request(r, system, prompt, max_tokens)
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        who = f"{r.service} · {r.model}"
        try:
            with opener(req, timeout=timeout) as answer:
                raw = answer.read().decode("utf-8", "replace")
            data = json.loads(raw or "{}")
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", "replace")[:600]
            detail = raw
            try:
                j = json.loads(raw)
                e = j.get("error") if isinstance(j, dict) else None
                if isinstance(j, list) and j:
                    e = (j[0] or {}).get("error")
                detail = (e.get("message") if isinstance(e, dict) else e) or (j.get("message") if isinstance(j, dict) else None) or raw
            except Exception:
                pass
            detail = str(detail).strip()[:240]
            st = err.code
            if st == 429:
                retry = err.headers.get("retry-after") if err.headers else None
                try:
                    wait = float(retry) if retry else None
                except ValueError:
                    wait = None
                if wait is None:   # Gemini puts it in the body: "retryDelay": "34s"
                    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', raw)
                    wait = float(m.group(1)) if m else None
                daily = re.search(r"per.?day|daily|RPD|TPD|requests per day|tokens per day", raw, re.I)
                secs = _secs_to_midnight() if daily else (wait if wait and wait < 6 * 3600 else 60)
                # Account-wide services (OpenRouter, Mistral, Cloudflare) rest as a whole.
                rest_key = f"svc:{r.service}" if r.bucket else r.name
                return False, ("AI_RATE_LIMIT", f"{who}: allowance used up. {detail}", 502, st, (rest_key, secs, "used up"))
            if st in (401, 403) and ("1010" in raw or "cloudflare" in raw.lower()) and r.service != "cloudflare":
                return False, ("AI_BLOCKED", f"{who}: the service's firewall blocked this server. {detail}", 502, st, (f"svc:{r.service}", 3600, "blocked"))
            if st in (401, 403):
                return False, ("AI_KEY_REFUSED", f"{who}: the key was refused; check {SERVICES.get(r.service, {}).get('env', 'AI_KEY')} on Render. {detail}", 502, st, (f"svc:{r.service}", 3600, "key refused"))
            if st == 404 or (st == 400 and re.search(r"model.*(not|does not|doesn't) (exist|found|available|supported)|unknown model|invalid model|decommissioned|deprecated", raw, re.I)):
                return False, ("AI_MODEL_NOT_FOUND", f"{who}: no such model any more. {detail}", 502, st, (r.name, 86400, "model not found"))
            if st == 400 or st == 413:
                return False, ("AI_BAD_REQUEST", f"{who}: didn't accept the request. {detail}", 502, st, None)
            return False, ("AI_SERVICE_ERROR", f"{who}: service problem ({st}). {detail}", 502, st, (r.name, 120, f"error {st}"))
        except (socket.timeout, TimeoutError):
            return False, ("AI_TIMEOUT", f"{who}: took too long.", 504, None, (r.name, 120, "timeout"))
        except urllib.error.URLError as err:
            why = getattr(err, "reason", err)
            if isinstance(why, (socket.timeout, TimeoutError)):
                return False, ("AI_TIMEOUT", f"{who}: took too long.", 504, None, (r.name, 120, "timeout"))
            return False, ("AI_UNREACHABLE", f"{who}: couldn't reach {urllib.parse.urlsplit(url).hostname} ({why}).", 502, None, (f"svc:{r.service}", 120, "unreachable"))
        except ValueError:
            return False, ("AI_BAD_REPLY", f"{who}: answered with something that isn't JSON.", 502, None, (r.name, 120, "bad reply"))
        except Exception as err:
            return False, ("AI_UNREACHABLE", f"{who}: {type(err).__name__}: {err}", 502, None, (r.name, 120, "error"))

        if r.shape == "gemini":
            parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text") or "" for p in parts if not p.get("thought"))
        elif r.shape == "anthropic":
            text = "".join(b.get("text") or "" for b in (data.get("content") or []) if b.get("type") == "text")
        else:
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        text = re.sub(r"^\s*<think>.*?</think>\s*", "", text or "", flags=re.S).strip()
        if not text:
            finish = (data.get("choices") or [{}])[0].get("finish_reason") if r.shape == "openai" else ""
            if finish == "length":
                return False, ("AI_TOO_SHORT", f"{who}: used all its room thinking and wrote no answer.", 502, None, None)
            return False, ("AI_EMPTY", f"{who}: answered with nothing.", 502, None, None)
        return True, text

    # ── for /api/ai/status ──
    def status(self, detail=False):
        now = time.time()
        with self.lock:
            self._roll()
            out = {"services": self.services(), "routes": len(self.routes), "daily_cap": self.cap,
                   "ready": sum(1 for r in self.routes if self._ok_now(r, now))}
            if detail:
                out["table"] = [{
                    "route": r.name, "tier": r.tier, "used_today": self._count(r), "limit_today": self._limit_of(r),
                    "resting_for_s": int(max(self.rest.get(r.name, 0), self.rest.get(f"svc:{r.service}", 0)) - now) if max(self.rest.get(r.name, 0), self.rest.get(f"svc:{r.service}", 0)) > now else 0,
                    "why": self.why.get(r.name) or self.why.get(f"svc:{r.service}") or "",
                } for r in self.routes]
                out["accounts_today"] = len(self.users)
            return out
