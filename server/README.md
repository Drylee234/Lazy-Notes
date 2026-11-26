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

The latest snapshot and the 5 before it are kept.
