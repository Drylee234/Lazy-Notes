# Lazy Notes server

Keeps a copy of your notes (sent by the extension) and shows them on your
phone as a read-only website.

## Run it on your computer

```bash
cd server
pip install -r requirements.txt
LAZYNOTES_KEY=pick-a-long-secret python app.py
```

Or `python app.py --dev`, which makes up a key and prints it.

It listens on port 8787. On your phone (same Wi-Fi), open
`http://<your computer's IP>:8787` and type the key. In the extension, set the
server address to `http://<your computer's IP>:8787` (or
`http://localhost:8787`) with the same key.

Without `DATABASE_URL`, notes are kept in `server/lazynotes.db` (SQLite;
change with `LAZYNOTES_DB`).

## Put it online (Render, free)

1. Push this repo to GitHub, then in Render: **New → Blueprint** and pick the
   repo. `render.yaml` creates the web service and a free Postgres database.
2. Open the service's **Environment** tab and copy `LAZYNOTES_KEY` (Render
   generated it). Use it in the extension and on your phone.
3. Your site is `https://lazy-notes-xxxx.onrender.com`.

Free services sleep after about 15 minutes without visits and wake on the
next request (up to a minute). The extension checks `/api/health` and retries,
so syncs still arrive. Render's free Postgres expires after a while (see
their current limits), so keep downloading backups from the extension too.

## API

All `/api` calls except health need `Authorization: Bearer <LAZYNOTES_KEY>`.

| Call | Does |
|---|---|
| `GET /api/health` | `{"ok": true, "app": "lazy-notes"}`, no key needed |
| `PUT /api/snapshot` | body `{"app":"lazy-notes","version":1,"sentAt":…,"data":{"lazynotes":…,"lnDocs":…}}` → `{"ok":true,"savedAt":…}` (max 30 MB) |
| `GET /api/snapshot` | `{"savedAt":…,"data":…}`, or 404 before the first sync |
| `POST /api/ai` | body `{"system":…,"prompt":…,"max_tokens":…}` → `{"ok":true,"text":…}` — see **AI key** below |

The latest snapshot and the 5 before it are kept.

## Accounts and sharing

`LAZYNOTES_KEY` still works and is "the owner" (the notes you already synced).
People can also make accounts (extension: Settings › Sync › Create account; the
phone site logs in with the same username and password). Each account has its
own notes; a login gives a token that works everywhere the key does (sync, AI).

| Variable | Meaning |
|---|---|
| `INVITE_CODE` | optional: new accounts must type this code |
| `SIGNUPS` | `open` (default without `INVITE_CODE`) · `invite` (default with one) · `closed` |

Never give out `LAZYNOTES_KEY` as an invite: it opens the owner's own notes.

Routes: `GET /api/signup-info`, `POST /api/signup {username, password, invite}` (only from the extension: `Origin: chrome-extension://…`; the phone site only logs in),
`POST /api/login`, `POST /api/logout`, `GET /api/me`.
Sharing: `POST /api/share {course, topic, notes, to?}` → `{url: /s/<id>}`, a
read-only copy anyone with the link can open (`GET /api/share/<id>`); with
`to`, it also lands in that account's inbox (`GET /api/inbox`). Accounts can use
the server's AI too.

### Forgot password

`/reset` is the "Forgot your password?" page (linked from the phone login and
the extension's Account & sync). Routes: `POST /api/forgot {username}` (emails a
30-minute, one-use link `…/reset#t=…` when the username is an email; always the
same answer, 5 an hour per IP and per username), `POST /api/reset {token, password}`
(sets it, logs the account out everywhere, returns a new login token), and
`POST /api/reset-link {username}` with the server key → `{link}` valid 24 h, to
send a tester by hand when there's no email:

    curl -X POST https://<server>/api/reset-link -H "Authorization: Bearer $LAZYNOTES_KEY" \
         -H "Content-Type: application/json" -d '{"username":"friend@gmail.com"}'

Email is off until `SMTP_HOST` is set (without it `/api/forgot` says "ask
whoever gave you Q-notes"):

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` (Gmail) or `smtp-relay.brevo.com` (Brevo, free) |
| `SMTP_PORT` | `587` (default, STARTTLS) or `465` (SSL) |
| `SMTP_USER` | Gmail address / Brevo SMTP login |
| `SMTP_PASS` | Gmail **App password** (needs 2-step verification) / Brevo SMTP key |
| `MAIL_FROM` | sender address (default `SMTP_USER`; on Brevo a verified sender) |
| `PUBLIC_URL` | optional: the address links point to (Render's own address is used by default) |

### Sign in with Google (optional)

1. [Google Cloud Console](https://console.cloud.google.com/) › APIs & Services › **OAuth consent screen**: External, app name "Lazy Notes", your email; add yourself (and testers) under Test users, or publish it.
2. **Credentials › Create credentials › OAuth client ID** › Web application. Authorized redirect URI: `https://<your server>/auth/google/callback` (for Render: `https://lazy-notes-c07b.onrender.com/auth/google/callback`).
3. On Render › Environment add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The "Continue with Google" buttons appear by themselves (extension and phone).

New Google accounts are only made from the extension; on the phone Google only logs in to an existing account. Email addresses work as usernames too.

## Many free AI services at once (auto-routing)

Put one key per service on Render › lazy-notes › Environment. A service without
a key is skipped. Every question goes to the best model that still has free
allowance left today, spread evenly; "too many requests" → the next one is tried
at once. Full list, models and rules: `ai_router.py` (top of the file).

| Variable | Where to get it |
|---|---|
| `GEMINI_KEY` | https://aistudio.google.com/apikey |
| `GROQ_KEY` | https://console.groq.com/keys |
| `CEREBRAS_KEY` | https://cloud.cerebras.ai › API keys |
| `OPENROUTER_KEY` | https://openrouter.ai/keys |
| `MISTRAL_KEY` | https://console.mistral.ai/api-keys |
| `GITHUB_MODELS_KEY` | GitHub › Settings › Developer settings › fine-grained token, "Models: read" |
| `CLOUDFLARE_KEY` + `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com › AI › Workers AI |
| `SAMBANOVA_KEY` | https://cloud.sambanova.ai/apis |
| `AI_DAILY_CAP` | questions per account per day (default 40, 0 = no cap; the server key has none) |
| `AI_MODELS_<SERVICE>` | your own model list, comma-separated, e.g. `AI_MODELS_GROQ` |

`GET /api/ai/status` with the server key shows every route: used today, its
limit, and whether it's resting and why. Testers only see "ready" or not. The old
`AI_KEY` / `AI_PROVIDER` / `AI_MODEL` below still work and join the pool.

## AI key on the server (so it isn't in Chrome)

The extension can ask this server to do its AI jobs instead of holding an AI
key itself. The key then lives in one place — a Render environment variable —
works on every device you use, and can be changed without touching Chrome.

Set these on the service's **Environment** tab, then **Save** (Render
restarts it):

| Variable | What to put |
|---|---|
| `AI_KEY` | the AI service's key (required) — a **Groq API key** unless you set `AI_PROVIDER` to something else |
| `AI_PROVIDER` | `groq` (the default), `gemini`, `anthropic` or `openrouter` |
| `AI_MODEL` | a model name; left out, the provider's usual one is used |
| `AI_BASE` | only for something else OpenAI-shaped (Mistral, Cerebras, …) |

Then in the extension: **Settings › AI › Service → My Lazy Notes server**, and
press **Test connection**. There is no key or model to type: it uses the sync
address and sync key you already set, and the AI key never leaves Render.

`POST /api/ai` needs the same `LAZYNOTES_KEY` as everything else. The
extension still writes the jobs themselves (`background/bg_ai.js`), so this
endpoint only adds the key and translates between the services' request
shapes. Nothing it relays — no prompt, no note text, no key — is stored or
logged here.

A free Render service sleeps after a while, so the first AI press after a
quiet spell waits for it to wake (up to about a minute), exactly like sync.

## AI error codes
Every `/api/ai` failure returns `{ ok:false, code, reason }` and the extension shows `[CODE]`.
`GET /api/ai/status` (Bearer sync key) says how AI is set up without calling the AI: `has_key`, `key_length`, `key_looks_like`, `provider`, `model`. It never returns the key.

| Code | Meaning / fix |
|---|---|
| SYNC_KEY_WRONG | Extension's sync key ≠ `LAZYNOTES_KEY` |
| NO_AI_KEY | Add `AI_KEY` on Render |
| BAD_PROVIDER | `AI_PROVIDER` unknown and no `AI_BASE` |
| AI_KEY_REFUSED | The service said 401: wrong/expired key, or the key is for another service than `AI_PROVIDER` |
| AI_FORBIDDEN / AI_BLOCKED | 403 / firewall (Cloudflare) |
| AI_MODEL_NOT_FOUND | Fix `AI_MODEL` |
| AI_RATE_LIMIT | Free allowance used up |
| AI_BAD_REQUEST / AI_SERVICE_ERROR | 400 / 5xx from the service |
| AI_TOO_SHORT | A "thinking" model (gpt-oss…) used all its tokens thinking; the server now gives it room + reasoning_effort low |
| AI_TIMEOUT / AI_UNREACHABLE | No answer / network from Render |
| Extension only: SERVER_WAKING, SERVER_OLD, UNREACHABLE, TIMEOUT, OFFLINE, KEY_REFUSED, RATE_LIMIT… | Shown when the server can't answer, or on the direct route |
