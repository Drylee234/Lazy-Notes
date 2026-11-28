# Analysing testers' usage reports (for Claude)

Testers' Q-notes extensions send a **usage report** with every sync (Settings ›
Problems › "Send usage & error reports", and "Also record habits"). Reports
hold **counts, settings and errors only**: never note text, never keys. The
server keeps each tester's last 30 in the `reports` table (`server/app.py`).

## How to read them

**A. Render database (works from any Claude session with the Render connector).**
Service `lazy-notes` (`srv-dc3uo7e1egvs73er4o30`), database `lazy-notes-db`
(`dpg-dc3uki6i0phs738klbog-a`), workspace `tea-d9tu9qm417fc73fa0br0`. Use the
Render tool `query_render_postgres` (read-only):

```sql
-- each tester's newest report, with their account name
SELECT DISTINCT ON (r.user_key) COALESCE(u.username, r.user_key) AS tester, r.saved_at, r.body
FROM reports r LEFT JOIN users u ON u.id::text = r.user_key
ORDER BY r.user_key, r.id DESC;

-- how a tester's use changed over time (counts only)
SELECT saved_at, body->'counts' AS counts, body->'habits' AS habits
FROM reports WHERE user_key = '<id>' ORDER BY id;

-- reports from before the reports table existed (inside the snapshots)
SELECT user_id, saved_at, body->'lnReport' FROM snapshots ORDER BY id DESC LIMIT 20;
```

**B. The server (with the owner's server key, LAZYNOTES_KEY):**
`GET /api/reports` (each tester's latest) and `GET /api/reports/summary`
(all added up), header `Authorization: Bearer <LAZYNOTES_KEY>`. The key is on
Render › lazy-notes › Environment; never paste it into chat or commit it.

## What a report holds

| Field | Meaning |
|---|---|
| `counts` | courses, topics, highlights, typed notes |
| `usage` | per day: actions (`save:<type>[:typed][:reader]`, `DELETE_HIGHLIGHT`, `SET_ARRANGEMENT`, `ai:<job>`, `JOIN_TO_LAST` …) |
| `habits` | per day (if habits are on): shortcuts used (`key-alt-indent`, `key-ctrl-up`, `pick-notes`), `undo-save`, `undo-arrange`, `popup-dismissed`, `howto`, `share`, `quick-note`, and struggle signs `delete-soon` / `edit-soon` / `indent-new` (within a minute of saving) |
| `neverUsed` | features with no use in 30 days |
| `errors` | last errors: where + message (code errors, no note text) |
| `settings` | which switches the tester changed |
| `version`, `browser` | build and Chrome version |

## What to look for (write findings into docs/roadmap.md with a **Why**)

1. **Struggle:** high `delete-soon`, `edit-soon`, `indent-new`, `undo-*`, `popup-dismissed` → something is easy to get wrong (save type guesses, indents, the pop-up).
2. **Never used / rarely used** across testers → not discoverable (teach it: tour, How to use, hints) or not wanted.
3. **Errors** shared by several testers → bugs to fix first.
4. **Habits by type:** which note types people actually save (`save:generic` vs `save:definition` …) → defaults and type guessing.
5. **Settings changed by many** → maybe the default is wrong.
Report findings to the owner as a short table (finding · how many testers · suggested change), then log them in the roadmap; don't build without asking (CLAUDE.md "Reports = notes, not builds").
