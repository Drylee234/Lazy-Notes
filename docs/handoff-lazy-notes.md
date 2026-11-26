# active-memory handoff: Lazy Notes (Chrome extension)

**Handoff #2** · 2026-11-26 · Lineage: #1 (2026-11-25): PDF prompt, slides reader, Study-tab note-taker, hover dropdowns, Enter-to-save, new types, editor, undo, PDF selection fix; #2 (2026-11-26): slides look like PPT, themes, Home/Study redesign, rich note box, spell check, chips + number keys, list splitting, join, outline headings, figures, reorder/indent, backup, sync server on Render, built-in Notes panel in readers, zoom/rotate/caret, Word reader

## 0. Instructions for Claude (read first)

You are continuing work from a previous chat. That chat is gone; this file is the complete context and the source of truth.

1. Read this whole file before replying.
2. Follow sections 3 (Style), 4 (Hard rules) and 5 (Corrections) in every reply, for the rest of this chat. They override your defaults.
3. Use the values in section 8 exactly. Never round, re-estimate, or "correct" them.
4. Do not suggest anything listed in section 7 (Changed / rejected) again unless the user brings it up.
5. Code word: None active. If the user types /amcodeword, start every reply with the phrase they choose (default "Yes Boss!").
6. Your first reply: at most 5 lines covering the goal, the current state, and the next step (section 11). Mention any files from section 13 that were not attached. Ask the questions in section 12 if there are any. End with "Ready to continue with <next step>?" Then wait for the user's go.

## 1. Mission
- **Goal:** Improve "Lazy Notes", a Manifest V3 Chrome extension for students: highlight text on web pages, PDFs, .pptx slides and .docx in its own readers; tag it (course › topic › type); study it as notes; sync a read-only copy to a phone site.
- **Done looks like:** features work in real Chrome, tested in Chromium (Playwright), pushed to `main`.
- **Why it matters / context:** user studies from lecture PDFs/slides (courses e.g. "Get 205", "BME213 (Physiology)", "GET 201", "GET 211"; topics e.g. "Basics", "Introduction").

## 2. About the user (as relevant to this work)
- Student; GitHub repo owner `Drylee234/Lazy-Notes`. Uses Chrome with the extension loaded unpacked; Windows-style trackpad (two-finger pinch zoom).
- Compares UX with the "Web Highlights" extension (finds its panel smoother).
- Types fast with typos/slang ("sha", "na", "lwk", "idrk", "yk", "ass" = bad). Interpret charitably; ask when truly ambiguous.
- Cares a lot about UX and speed of taking notes (keyboard-first, fewer mouse trips). Likes images/mockups to explain options.
- Has a Render account (workspace "Alfred's workspace") and GitHub connected to Render.

## 3. Style & communication
- **Language:** English.
- **Tone:** direct, plain, friendly; briefly explain what you're doing ("id enjoy if you explained what youre doing").
- **Reply length:** short; lead with the outcome; bullets/tables.
- **Formatting:** short sections, bullets, tables; commit hashes in backticks; send screenshots/mockups (SendUserFile) and say which image is which ("u didn't say which was which" was a complaint).
- **Working style:** act on clear requests; ask (AskUserQuestion) only for genuinely ambiguous choices; brainstorm with mockups when user says "brainstorm"/"show me". Test in Chromium before pushing. Parallel background workers are welcome for big batches ("use background workers in paralel"), on separate files; re-test everything together before pushing to main.
- **Avoid:** wasting tokens; long investigations; overlapping UI; covering text; deleting things outright (hide behind a setting instead).

## 4. Hard rules (word for word)
1. "when i say push to main unless i say otherwise later i mean always push to main you test it on your device first anyway" → after testing, push to `main` AND the session's working branch.
2. "whatever thing ive removed or perhaps ask to be removed in the future simply add a setting to turn it on or off" (so work isn't wasted).
3. "let clicking the enter button be able to replae the need to manually drag the mouse to click in places where its possible".
4. "seriously consider Ux" / "be careful" (reorder: never lose or scramble notes).
5. Do not create pull requests unless asked. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the session's `Claude-Session:` line (new session gets its own; branch name also comes from the new environment).
6. Unfinished worker work goes to the working branch only (WIP commit), never to `main` until tested.

## 5. Corrections log
| # | Claude did | The user wanted |
|---|---|---|
| 1 | Hover dropdown closed 0.25s/0.7s after leaving | Rest ~0.5s to open (pass-by does nothing), click opens instantly; hover-opened list closes when mouse leaves (0.4s) |
| 2 | Dropdown list looked see-through / ugly purple blocks | Solid, quiet list (grey hover, tick + accent for current) |
| 3 | Study tab had two big course/topic boxes | One quiet "Course › Topic" breadcrumb line |
| 4 | Edit/editor didn't close on click outside (incl. clicking the web page) | Close (save if changed) on any outside click, incl. the page |
| 5 | Mockup images sent without saying which was which | Always label which image is which |
| 6 | Shift+Tab outdents, Tab indents in note-box lists | Tab always → "Save as" picker; Shift+Tab indents; Alt+Shift+Tab or Backspace at point start outdents |
| 7 | Annotation/More fields stacked vertically, editor too big | Folds side by side ("List point › Annotation › Context ›"); type list floats beside a small button |
| 8 | Autocorrect "toxic in a bad way", suggested words Chrome still underlines, sHE→SHe | Rank by word frequency + your notes; only common words; mixed caps lowered |
| 9 | Side panel's async onMessage listener swallowed replies (Join's Undo deleted the note) | Fixed: non-async listener |
| 10 | "pick one" (computer vs Render) was unclear | They were alternatives; Render chosen and deployed |
| 11 | Mouse-button "save instantly" idea | Rejected: can't edit before saving |
| 12 | "Saving to …" line in save pop-up | Removed (shown only in red when no topic) |

## 6. Decisions
| Decision | Why |
|---|---|
| Types: Header(1) H, Sub topic(2) H2, Definition(3) Def, Formula(4) ƒx, List point(5) •, Important(6) ! [stored "note"], Summary(7) Σ, Plain(0) ¶ [stored "generic"]; My note = 9 in note box | user approved trimmed types + compact chips |
| List head not offered; a Plain line directly above list points renders bold with a colon | trim types; user later asked list heads back "at least in the reader" (open) |
| Save pop-up: compact chips, number keys save, Enter saves lit (guessed) type, Tab from text box to chips | faster type selection |
| Pop-up position setting: Above/Below/Left/Right/Split (split = boxes either side of the mouse) | user's request |
| Note box = rich "formatted while typing" box (Option 2) storing the same markdown-ish text | user chose Option 2 |
| Study keyboard: picker ←/→; notes ↑/↓ Home/End, Enter/Space edit, Delete twice deletes, Alt+↑/↓ move, Alt+←/→ indent; note box; Save as (Tab, numbers, Enter) | user's tab-order idea |
| Server on Render (free web + free Postgres), read-only phone site | user said "deply" |
| Built-in Notes panel inside readers (iframe of sidepanel.html?embedded=1), Ctrl+. jump, Ctrl+/ show/hide | user's idea |
| Floating panel direction: Claude recommends slim edge tab + pop-up note box at cursor (1+2) | suggestion only — awaiting user choice |

## 7. Changed / rejected
- Topics tab → renamed **Home**.
- "PDF reader" button → "Document reader" → hidden in footer (setting to bring back pending).
- "Open the slides reader" link → removed (one start page for PDF/.pptx/.docx).
- Course/topic rows in save pop-up → hidden (toggle pending).
- Generic → shown as **Plain**; Note → shown as **Important**; List head → not offered (toggle pending).
- Formatting option 1 (symbols + bar) → Option 2 (formatted while typing).
- Editor "More" → separate folds; type picker floats beside.
- Indent in Study notes: Tab → Alt+←/→ (Tab moves between sections).
- ❌ Mouse-button/Alt instant save without pop-up (can't edit first).
- ❌ Full pixel-faithful .pptx rendering (slides are laid out from positions instead).
- ❌ Parsing old binary .doc (message: save as .docx or PDF).

## 8. Data & facts (exact)
- Repo `Drylee234/Lazy-Notes`; last pushed commit on `main`: `050bee4` ("Readers: Ctrl+/ shows or hides the built-in Notes panel").
- Render: workspace `tea-d9tu9qm417fc73fa0br0` ("Alfred's workspace"); web service `lazy-notes` id `srv-dc3uo7e1egvs73er4o30`, URL https://lazy-notes-c07b.onrender.com, region frankfurt, free, auto-deploys from `main`, build `pip install -r server/requirements.txt`, start `cd server && gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120`, env PYTHON_VERSION 3.12.7, LAZYNOTES_KEY = [secret removed: re-enter it].
- Render Postgres `lazy-notes-db` id `dpg-dc3uki6i0phs738klbog-a`, v16, free, frankfurt, expires 2026-12-26. User must paste its Internal Database URL into the service env as `DATABASE_URL` (status unknown).
- Server API: GET /api/health (no auth) → {"ok":true,"app":"lazy-notes"}; PUT /api/snapshot (Bearer key) body {"app":"lazy-notes","version":1,"sentAt","data":{"lazynotes","lnDocs"}}; GET /api/snapshot; 30 MB max; keeps latest + 5.
- Extension sync: pushes ~20s after changes, every 6h; wakes server via /api/health (60s timeout); retries 1, 5, 15, 30, 60 min then hourly.
- Timings: dropdown hover open 500ms, switch 300ms, hover-opened close 400ms; undo toast 6000ms; double-click delay 230ms; editor blur-close 700ms.
- Storage keys: lazynotes (courses → topics → {highlights{id}, notes{id}}; fields incl. order, indent, image), activeCourse, activeTopic, highlighterActive, lastDrag, lnDocs, lnTheme, lnPopupSide, lnAutocorrectLevel (0 Off/1 Mild/2 Strong/3 Toxic), lnSpellIgnore, lnDocAutoSelect, pptxAutoOpen, lnLastBackup, lnSyncUrl, lnSyncKey, lnSyncState. IndexedDB: lazynotes-pdfs, lazynotes-slides, lazynotes-docs (store "files").
- Spell: Hunspell dictionary-en + nspell (lib/), word frequency list lib/dict/en-freq.txt (top 60,000, wordfreq 3.1.1, CC BY-SA 4.0 data).

## 9. People, terms & names
- **People:** user (repo owner, student).
- **Terms & nicknames:** "note typer"/"typer" = Study tab note box (composer); "side panel" = Lazy Notes panel; "pop up"/"highlighter popup" = save pop-up; "reader" = our PDF/slides/Word reader; "all notes home"/"main boss home page" = courses.html; "pop downs" = dropdowns.
- **Names in use (folders):** background/ (bg_*.js incl. bg_join.js, bg_sync.js, bg_arrange.js, bg_pptx.js), content/ (content.js save pop-up, pdf-prompt.js), readers/ (pdfreader.*, pptx*, docx*, docs-recent.js, figure-save.js, embedded-panel.*), sidepanel/ (sidepanel.*, study-page.js, study.css, hover-select.*, rich-box.js), notes/ (viewer.*, notes-render.js, notes.css, note-editor.js, exporter.js), shared/ (theme.*, utils.js, spell.js, settings.js/.css, recent-docs.js), lib/, server/ (app.py, static/), render.yaml, docs/. HTML pages stay top-level (saved links depend on pdfreader.html/pptxreader.html/docxreader.html).

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| Everything listed in Lineage #2 | final, on main | up to `050bee4` | tested in Chromium |
| Render deploy | live | lazy-notes-c07b.onrender.com | DATABASE_URL step by user; container couldn't reach onrender.com to test |
| Doc words in spell check + typing hints + "More options" feature toggles | NOT done | worker killed; partial diff only in a local git stash (likely lost) | redo |
| Drag PDF text into built-in panel | untested | — | headless can't drag into iframe |
| Requests below (section 11) | not started | — | — |

Tests: Playwright scripts lived in old scratchpad (gone). Pattern: `chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except=<repo>','--load-extension=<repo>']})`, seed chrome.storage via service worker, `python3 -m http.server 8765` for test pages/PDFs.

## 11. Next steps
1. **Next action:** get the user's choice for the floating/collapsible panel (Claude suggests slim edge tab + pop-up note box at cursor via Ctrl+.) and ask when the PDF cursor "moves around" during highlighting; then build.
2. Redo: open document's words feed spell check + typing hints (→ accepts); Settings "More options" toggles (doc words, typing hints, pop-up course/topic pickers, "Saving to" line, List head type, Document reader footer link, formatting bar, built-in Notes panel).
3. Pinch/Ctrl+wheel zoom in readers zooms only the document (toolbar stays fixed).
4. Save a highlight straight into the note box, with a Note/Quote switch.
5. Join PDF line breaks when saving highlights (same cleanup as paste).
6. Create a new topic from the Study tab.
7. Smoother panel (compare Web Highlights).
8. List heads in the reader + relationships: points belong to list head; items under Header/Sub topic grouped; filters show heads with their points; fold/unfold.

## 12. Open questions ⚠️
- Floating panel: 1 slim edge tab, 2 pop-up note box at cursor, 3 detachable window, 4 bottom drawer, or 1+2 (suggested)?
- When exactly does the PDF text cursor jump during highlighting?
- Has the user pasted DATABASE_URL into Render and connected the extension's Sync (address https://lazy-notes-c07b.onrender.com + key)? Does sync work?

## 13. Re-attach checklist
- Nothing to attach (code is in the repo; the sync key is in the Render service env and the user's extension settings).

---
<sub>Audit: 13/13 sections · 6 rules · 12 corrections · 30 data points · secrets removed: yes · generated by active-memory</sub>
