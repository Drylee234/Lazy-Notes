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
| AI_TIMEOUT / AI_UNREACHABLE | No answer / network from Render |
| Extension only: SERVER_WAKING, SERVER_OLD, UNREACHABLE, TIMEOUT, OFFLINE, KEY_REFUSED, RATE_LIMIT… | Shown when the server can't answer, or on the direct route |
