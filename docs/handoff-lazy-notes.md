# active-memory handoff: Lazy Notes (Chrome extension)

**Handoff #5** · 2026-11-27 (owner away until Tuesday; may continue on a different account) · Lineage: #1 (2026-11-25): PDF prompt, slides reader, Study-tab note-taker, hover dropdowns, Enter-to-save, new types, editor, undo, PDF selection fix; #2 (2026-11-26): slides look like PPT, themes, Home/Study redesign, rich note box, spell check, chips + number keys, list splitting, join, outline headings, figures, reorder/indent, backup, sync server on Render, built-in Notes panel in readers, zoom/rotate/caret, Word reader; #3 (2026-11-26): edge-tab Notes panel + pop-out window, pop-up note box (5 ways to open), PDF caret-while-dragging fix, document words in spell check + typing hints, pinch zoom, Note/Quote on web pages, joined PDF lines, + New topic in Study, List head type back, fold/unfold + filters with heads, Settings › More options; #4 (2026-11-26/27): PDF snap-to-word + Home/End, nesting ownership + guide lines, floating panel (resize all edges, fade, hover-open + delays, view switcher with Home), our own panel on web pages (docked/floating) replacing Chrome's, readers full screen, How-to-use page, rename courses/topics, phone site PWA, app name soft-coded, Ctrl+↑ / Ctrl+Shift+., "perhaps" rule; #5 (2026-11-27 night, no new handoff number): tight note spacing, big ⋮⋮ ⇤ ⇥, All notes editing + arranging, settings regrouped (Fine-tuning / Old ways / ↺ / find), How-to-use tour on reload, PDF place-dialog + highlighter + type-guess + Join + definition-context fixes; #5b (2026-11-27 day): owner tested in real Chrome and sent ~25 usage reports → all logged in docs/roadmap.md (not built); AI layer: error codes on server + extension, /api/ai/status, AI_KEY trimmed, real User-Agent, room for thinking models → **AI now works through the Render server** (owner confirmed); pop-out window whole-number sizes; #6 (2026-11-27 evening, same handoff number): bugs fixed (deleted notes coming back = no save queue → `oneAtATime`; click on selection re-opening the pop-up; PDF caret ↑↓/←→; http:// sites `crypto.randomUUID`; topic dropdown loop), indent with children + Shift-pick + new notes keep indent, blank lines, one bullet style, AI Ask bar + offline helpers + phone AI, **accounts (login) + sharing** on the server, online status pill, habit reports, Ctrl+↑ edits last typed note in the box, open doc from a course, compact in-place edit card, small save toast, ↑ into suggestions, hover-open page panel, PDF drag across pages, Bottom panel mode, test bench (tools/make-test-bench.js). Designs waiting to be shown: roadmap section 0.

> **Renamed to Q-notes (2026-11-28).** The app is called **Q-notes** everywhere people see it. Internal names (storage keys `lazynotes`/`ln…`, sync format `app: "lazy-notes"`, repo `Drylee234/Lazy-Notes`, Render `lazy-notes-c07b`) stay as they are: never rename them, notes would be lost.

## 0. Instructions for Claude (read first)

**Read in this order:** `CLAUDE.md` → this file → `docs/roadmap.md` (every idea/bug with its Why, by group) → `docs/usage-notes.md` (real usage + slips). Together they are the full context; nothing lives only in a chat.

You are continuing work from a previous chat. That chat is gone; this file is the complete context and the source of truth.

1. Read this whole file before replying.
2. Follow sections 3 (Style), 4 (Hard rules) and 5 (Corrections) in every reply, for the rest of this chat. They override your defaults.
3. Use the values in section 8 exactly. Never round, re-estimate, or "correct" them.
4. Do not suggest anything listed in section 7 (Changed / rejected) again unless the user brings it up.
5. Code word: **Scholar** (active since 2026-11-27): start every reply with it. If the user types /amcodeword, start every reply with the phrase they choose (default "Yes Boss!").
6. Your first reply: at most 5 lines covering the goal, the current state, and the next step (section 11). Mention any files from section 13 that were not attached. Ask the questions in section 12 if there are any. End with "Ready to continue with <next step>?" Then wait for the user's go.

## 1. Mission
- **Goal:** Improve "Lazy Notes", a Manifest V3 Chrome extension for students: highlight text on web pages, PDFs, .pptx slides and .docx in its own readers; tag it (course › topic › type); study it as notes; sync a read-only copy to a phone site (installable PWA).
- **Done looks like:** features work in real Chrome, tested in Chromium (Playwright), pushed to `main` (and the session's working branch).
- **Why it matters / context:** user studies from lecture PDFs/slides (courses e.g. "BME213 (Physiology)", "GET 201", "Get 205", "GET 211"; topics e.g. "Basics", "Introduction", "TRANSPORT OF SUBSTACE THROUGH THE CELL MEMBRANE"; PDF "PIO 201. INTRODUCTION TO PHG AND BLOOD.Lecture two.pdf").

## 2. About the user (as relevant to this work)
- Student; GitHub repo owner `Drylee234/Lazy-Notes`. Chrome on Windows, extension loaded unpacked (reloads it to test); trackpad (pinch zoom). Phone = Android Chrome.
- Compares with the "Web Highlights" extension: it uses its own self-built panel everywhere (pages + its reader) instead of Chrome's — the user prefers that.
- Types fast with typos/slang ("sha", "na", "lwk", "idrk", "yk", "ass" = bad, "yhh" = yes, "lit" = good, "atp" = at this point). Interpret charitably; ask when truly ambiguous.
- Starts almost every request with "perhaps" (see rule 8).
- Cares about UX, keyboard-first, few mouse trips, no wasted space or duplicate labels, saving tokens. Wants IMAGES/mockups to pick between options.
- Render account (workspace "Alfred's workspace"), GitHub connected to Render; sync works.

## 3. Style & communication
- **Language:** English.
- **Tone:** direct, plain, friendly; briefly explain what you're doing.
- **Reply length:** short; lead with the outcome; bullets/tables.
- **Formatting:** short sections, bullets, tables; commit hashes in backticks; screenshots/mockups via SendUserFile, always say which image is which.
- **Working style:** act on clear requests; ask only for genuinely ambiguous choices (AskUserQuestion with options); test in Chromium before pushing; say plainly what was and wasn't tested (e.g. real toolbar click, real trackpad).
- **Avoid:** wasting tokens; long investigations; overlapping UI; covering text; deleting things outright (hide behind a setting); repeating the app name where it's already shown; opening new windows unasked.

## 4. Hard rules (word for word)
1. "when i say push to main unless i say otherwise later i mean always push to main you test it on your device first anyway" → after testing, push to `main` AND the session's working branch (CLAUDE.md says the same).
2. "whatever thing ive removed or perhaps ask to be removed in the future simply add a setting to turn it on or off" (so work isn't wasted).
3. "let clicking the enter button be able to replae the need to manually drag the mouse to click in places where its possible".
4. "seriously consider Ux" / "be careful" (reorder: never lose or scramble notes).
5. Do not create pull requests unless asked. Commit messages end with the `Co-Authored-By:` and `Claude-Session:` lines the session gives (new session → its own; branch name also comes from the new environment).
6. Unfinished worker work goes to the working branch only (WIP commit), never to `main` until tested.
7. "make all and make them togglable" → new ways of doing something are all built, each with an on/off switch (Settings › More options).
8. "i always say perhaps before all my decisions so if thers a better way using already existing tools tell me and also if any of my decision will revert a benefit i gave myself before alert me" (also in CLAUDE.md).
9. CLAUDE.md: read `docs/handoff-lazy-notes.md` and `docs/usage-notes.md` before work; add a usage-notes entry whenever the owner shares real notes or reports a slip.
10. **Reports = notes, not builds**: when the owner sends screenshots/observations, only log them in `docs/roadmap.md` (💡 idea / 📘 usage observation / 🐞 bug, each with **Why**). Build only when explicitly asked. "not everything i say has to be built immediately"; "not all my reports have to be worked on, some simply need me to change how i use it".
11. **Images for UX**: unclear UX request → clarify with labelled images (Image 1 / Image 2); prefer before/after screenshots.
12. **Never misplace the owner's notes**: no change may move, reorder, merge, drop or re-indent saved notes without the owner doing it.
13. Workarounds the owner finds (e.g. Ctrl+B to bold item names) are observations, not official methods, unless the owner says so.
14. Short replies ("we're low on tokens so short responses abeg").

## 5. Corrections log
| # | Claude did | The user wanted |
|---|---|---|
| 1 | Hover dropdown closed 0.25s/0.7s after leaving | Rest ~0.5s to open (pass-by does nothing), click opens instantly; hover-opened list closes when mouse leaves (0.4s) |
| 2 | Dropdown list see-through / ugly purple blocks | Solid, quiet list (grey hover, tick + accent for current) |
| 3 | Study tab had two big course/topic boxes | One quiet "Course › Topic" breadcrumb line |
| 4 | Editor didn't close on outside click | Close (save if changed) on any outside click, incl. the page |
| 5 | Mockup images unlabeled | Always label which image is which |
| 6 | Shift+Tab outdents, Tab indents in note-box lists | Tab → "Save as" picker; Shift+Tab indents; Alt+Shift+Tab or Backspace at point start outdents |
| 7 | Editor fields stacked, too big | Folds side by side; type list floats beside a small button |
| 8 | Autocorrect "toxic in a bad way" | Rank by frequency + your notes; only common words; mixed caps lowered |
| 9 | Async onMessage listener swallowed replies | Keep every onMessage listener non-async |
| 10 | "pick one" unclear | Alternatives; Render chosen |
| 11 | Mouse-button instant save | Rejected: can't edit before saving |
| 12 | "Saving to …" line in save pop-up | Removed (red only when no topic) |
| 13 | Options described in words only | Images to pick from |
| 14 | PDF caret drawn while dragging | Caret hidden while mouse down; lnDocCaret switch |
| 15 | Typing-hint bar over chips | Hint in the box's footer |
| 16 | Fold button in left margin | Right after the heading's words |
| 17 | Typed-as-type notes tidied; Shift+Enter blank lines | Never tidied; one Shift+Enter = one line |
| 18 | Study Save-as plain dropdown | Numbered chips like the save pop-up |
| 19 | Hover tools covered words | Tools only in the note's left margin; 2px between notes |
| 20 | Study opened first topic when none picked | Only the picked topic, else "Pick a topic" |
| 21 | Pop-out was an OS window | Floating in-page box by default |
| 22 | Fold button on its own line in typed notes (big gap) | At the end of the last line |
| 23 | New list item didn't follow the nested item above | List point saved after an indented note takes its indent |
| 24 | CSS `resize` corner (covered by iframe) | Handles on all edges/corners |
| 25 | Asked what "Ctrl+Up" / "hover gestures" meant | Ctrl+↑ from note box → last note (Enter edits); hover = fade when mouse away |
| 26 | Chrome panel still showing in reader after "fixed" | Reader tells background (READER_READY) → disable + close Chrome panel for that tab |
| 27 | "Saving to course › topic" shown with no document | Only while a document is open |
| 28 | Layout ask misread | "+ Open a document…" in the top right of the documents list |
| 29 | Only disabled Chrome panel in readers | Our own panel on web pages too (docked or floating), like Web Highlights |
| 30 | Extra "Lazy Notes" title above the panel's own header | Name not repeated |
| 31 | Small popup window on chrome:// pages | No new window; ✕ flash on toolbar icon |
| 32 | Hid Home → lost document list | Home in the title-bar view switcher |
| 33 | Single-click title cycled views | Hover (~0.5s) / click list to pick, closes 0.4s after leaving |
| 34 | Gap between nested notes | Guide lines + blank leading/trailing lines trimmed on display |

## 6. Decisions
| Decision | Why |
|---|---|
| Types: Header(1) H, Sub topic(2) H2, Definition(3), Formula(4), List point(5) •, Important(6) ! [stored "note"], Summary(7) Σ, List head(8) ≡, Plain(0) ¶ [stored "generic"]; My note = 9 | earlier chats |
| Indented note belongs to the nearest less-indented note above (any type); fold hides it; Study draws guide lines per level; hovering the owner lights them (accent) | user asked |
| PDF: press within 28px of a word starts the highlight (lnDocSnap); Home/End = visual line start/end, Shift extends | bug report |
| Readers' panel: Floating (default) / Edge tab / Docked (lnPanelMode); floating: drag title, 8 resize handles, fold −, fades to 0.45 when mouse away (lnPanelFade), hover tab/folded bar opens (lnPanelHover, lnPanelHoverMs, lnPanelHoverCloseMs) | user asked |
| Built-in panel title bar = view name ("Study ▾"); rest ~0.5s or click → list Home / Study / AI; tab row inside hidden (lnEmbedHome = also show it); no name beside the logo in embedded/window panels | user asked |
| Web pages: our own panel (content/page-panel.js, shadow DOM, iframe sidepanel.html?embedded=1&page=1), Docked (default) or Floating (lnPagePanelMode); toolbar button / Alt+Shift+L / Ctrl+. | like Web Highlights |
| Chrome's side panel: disabled globally while lnPagePanelOwn is on; enabled on new tab pages (full Home); readers keep it only with lnReaderNativePanel | user's choice |
| Pages Chrome blocks (chrome://, Web Store): no panel; toolbar icon flashes ✕ for 2.5s | user rejected popup window |
| Readers open full screen once per tab (lnReaderFullscreen); "All notes" button in reader toolbar | user asked |
| Pop-up note box: Ctrl+Shift+. always; Ctrl+. when floating panel folded/hidden only with lnQuickWhenFolded (off); also double-click blank, right-click › Quick note here, ✎ Note | user asked |
| Study: Ctrl+↑ in note box → last note; Ctrl+↓ on a note → note box; auto-scroll to the newest note | user asked |
| Text dropped into a note box as plain text: lnDropPlain (off = quote) | user asked |
| Side-panel Home: NOW READING card, then SAVING TO (only with a document open), "+ Open a document…" top right of documents list | user asked |
| Rename courses/topics (RENAME_COURSE / RENAME_TOPIC; keeps order, updates activeCourse/Topic + lnDocs); ✎ on All notes rows; "✎ course / ✎ topic" on the Study picker | user asked |
| App name in one place: manifest.json "name" (shared/brand.js); phone site APP_NAME env | user may rename |
| How to use: shared/howto.js list; ? in the reader panel bar or ? key; howto.html; side-panel footer link | user forgot Ctrl+. |
| Notes sit 2px apart (as close as typed lines); headings keep room (lnNoteGap "roomy" = old 8px) | user: separate notes looked further apart than typed lines — the real reason behind the indent/ownership complaints |
| ⋮⋮ ⇤ ⇥ big, stacked in the left margin, 42px hover zone (lnToolsSize "small" = old) | user couldn't find them |
| All notes (display.html): typed notes editable in place; ↑ ↓ ⇤ ⇥ + Alt+arrows; nesting/guides; only with no filter and "As taken" | user: "total control" there |
| Settings: everyday first · Fine-tuning (helpers that are on) · Old ways (all off; tick = bring back) · ↺ on changed lines · Find box | user: tell revert switches from useful ones |
| Tour: tour.html + tour/slides.js (text) + tour/positions.js & *.png (made by tools/make-tour-shots.js); opens on install/update (lnTourOnReload) | user asked; rerun the maker after UI changes |
| Phone site: PWA (manifest, icons 192/512/maskable, /sw.js); source line only when a topic mixes sources | user asked |

## 7. Changed / rejected
- Chrome's side panel everywhere → our own panel on pages and readers; Chrome's only on new tab pages.
- ❌ Our panel in a small popup window on chrome:// pages ("i ddint want a new window") → ✕ flash.
- Built-in panel without Home → Home back via the title-bar switcher.
- Single-click title cycling views → hover/click list.
- Outer "Lazy Notes" title / name beside the logo in embedded panels → removed.
- CSS `resize: both` corner → edge/corner handles.
- Still rejected from before: ❌ mouse-button instant save; ❌ pixel-faithful .pptx; ❌ old binary .doc; ❌ bottom-drawer panel. Topics tab → Home; Generic → Plain; Note → Important.

## 8. Data & facts (exact)
- Repo `Drylee234/Lazy-Notes`; manifest version 2.0. Recent commits: `f42fd26` (trim blank lines, Ctrl+Shift+., view switcher with Home, Chrome panel on new tab, perhaps rule), `acf0d77` (guide lines), `e9cbae0` (no popup window, floating page panel), `27f0bce`, `810bd45`, `f8245dd` (hover delays), `93eedf5` (own page panel, rename, brand), `7c391e4` (PWA), `76512c8` (PDF Home/End + snap). Other sessions also pushed to main (`91aa61d` Groq key prompt, `ceccdc1` sync chases sleeping server, `b18c66f` note box Shift+Tab).
- Render: workspace `tea-d9tu9qm417fc73fa0br0`; web service `lazy-notes` id `srv-dc3uo7e1egvs73er4o30`, https://lazy-notes-c07b.onrender.com, frankfurt, free, auto-deploys from `main`; start `cd server && gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120`; env PYTHON_VERSION 3.12.7, LAZYNOTES_KEY = [secret removed: re-enter it], optional APP_NAME.
- Render Postgres `lazy-notes-db` id `dpg-dc3uki6i0phs738klbog-a`, v16, free, expires 2026-12-26 (plan renewal/backup).
- Server routes: GET /api/health → {"ok":true,"app":"lazy-notes"}; PUT/GET /api/snapshot (Bearer key); GET /api/report; `/`, `/manifest.webmanifest`, `/static/app.js` served with APP_NAME swapped in; `/sw.js` (Service-Worker-Allowed: /).
- Timings: dropdown/view-switch hover open 500ms, hover-opened close 400ms; panel hover open default 300ms (choices 0/150/300/600/1000), close default 700ms (200/700/1500/3000); fade opacity 0.45; PDF snap 28px; ✕ badge 2500ms; undo toast 6000ms; double-click 230ms.
- Sizes: web-page docked panel default 380px (min 300, max 70% of width; lnPageDockW); floating min 280×160 (readers) / 300×200 (pages); reader panel default 360px.
- Usage reports (lnSendReports) go to the owner's Render server with sync (read via GET /api/report), never to Claude.
- AI error codes: server `SYNC_KEY_WRONG, NO_AI_KEY, BAD_PROVIDER, EMPTY_PROMPT, AI_KEY_REFUSED, AI_FORBIDDEN, AI_BLOCKED, AI_MODEL_NOT_FOUND, AI_RATE_LIMIT, AI_BAD_REQUEST, AI_SERVICE_ERROR, AI_TIMEOUT, AI_UNREACHABLE, AI_BAD_REPLY, AI_EMPTY, AI_TOO_SHORT`; extension-only `SERVER_WAKING, SERVER_OLD, SERVER_ERROR, UNREACHABLE, TIMEOUT, OFFLINE, KEY_REFUSED, FORBIDDEN, MODEL_NOT_FOUND, RATE_LIMIT, SERVICE_ERROR`.
- Newest keys: lnNoteGap ("tight"|"roomy"), lnToolsSize ("big"|"small"), lnTourOnReload (default on). Settings checkboxes support data-on/data-off-value (text settings) and data-invert.
- New settings keys (More options): lnDocSnap, lnDropPlain (off), lnPanelFade, lnEmbedHome (off), lnPanelHover, lnPanelHoverMs, lnPanelHoverCloseMs, lnReaderFullscreen, lnPagePanelOwn, lnPagePanelMode ("dock"|"float"), lnReaderNativePanel (off), lnQuickWhenFolded (off). Storage: lnPageFloat {x,y,w,h,folded}, lnPageDockW. sessionStorage: ln-page-panel-open, ln-fs-done.
- Messages: LN_TOGGLE_PANEL (bg → reader), READER_READY, READER_FULLSCREEN, LN_PAGE_PANEL {action: toggle|open|focus}, RENAME_COURSE, RENAME_TOPIC; window messages ln-view {name, active, views}, ln-set-view, ln-next-view, ln-focus-composer, ln-panel-done, ln-toggle-panel. Command "toggle-panel" = Alt+Shift+L.
- Older facts (storage keys lazynotes/activeCourse/activeTopic/lnDocs…, IndexedDB lazynotes-pdfs/-slides/-docs, spell lib, sync retries 1/5/15/30/60 min) unchanged since handoff #3.

## 9. People, terms & names
- **People:** user (repo owner, student).
- **Terms:** "note typer" = Study note box; "floating note typer" / "pop-up note box" = quick-note.js box; "floating side panel / study bar" = readers' floating panel; "edge tab", "dock" = other panel modes; "that little spot" = title-bar spot (now the view switcher); "chrome page/panel" = Chrome's own side panel; "main boss home page" / "all notes" = courses.html.
- **Files:** content/page-panel.js (web-page panel), shared/view-switch.js (title-bar switcher), shared/brand.js (name), shared/howto.js + howto.html, readers/embedded-panel.js/.css, readers/quick-note.js, notes/notes-render.js (noteParents, LnFold, trimBlankLines), sidepanel/study-page.js, background/background.js (action click, new-tab panel, reader panel), background/bg_sidepanel.js (togglePanelFor, pagePanel, cannotHere, requestSidePanel), background/bg_courses.js (renames), server/app.py + server/static (PWA), docs/usage-notes.md.

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| Everything in lineage #4 | final, on main | up to `f42fd26` | tested in headless Chromium |
| Chrome panel on new tab via the real toolbar click | untested | background.js | headless can't click the action |
| Page panel on sites with strict CSP | untested | page-panel.js | may be blocked → ✕ |
| Spacing fix (trimBlankLines) | pushed, cause inferred | notes-render.js | user to confirm with real data |
| Hover-open for the web-page panel | not done | — | offered |
| Everything in #5 (this night) | on main; owner using it in real Chrome | see usage-notes 2026-11-27 (night) | reports logged in roadmap |
| AI through the Render server | **works** (owner confirmed 2026-11-27) | server/app.py /api/ai, /api/ai/status; bg_ai.js; ai-providers.js | default model openai/gpt-oss-120b (thinking model: max_tokens ≥ 400 + reasoning_effort low) |
| Fit-to-width leaving room for the floating panel; quick note box offering the panel's topic | ideas, not built | — | from Claude's PDF run |
| Remaining More options toggles from #3 (pop-up course/topic pickers, Saving-to line, Document reader footer link, formatting bar, built-in panel on/off) | not done | — | rule 2 |

Tests: Playwright scripts lived in the session scratchpad (gone). Pattern: `chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except=<repo>','--load-extension=<repo>']})`; seed `lazynotes:{courses:{C:{topics:{T:{highlights:{},notes:{}}}}}}` + activeCourse/activeTopic via the service worker; remove the `#ln-place` dialog in readers; `python3 -m http.server 8765` for test pages; test PDF via reportlab.

## 11. Next steps
0. **Since #6:** show the owner the designs in `docs/roadmap.md` section 0 (A–J) with labelled images before building any; J (two-ways simulation) last. Check Render redeployed fine (accounts migrate the snapshots table; tested on SQLite only).
1. **Next action (Tuesday):** greet with "Scholar", ask what the owner wants to pick from `docs/roadmap.md`. Their direction last session: the **AI layer** (connection now works) and making notes **feel like one note**.
2. Open bugs to check first (roadmap): list points that wouldn't delete until refresh; clicking away after a highlight counts as a new highlight; PDF caret ↓ / ←→ at word edges; blank lines squashed in typed notes; new highlights not keeping the indent.
3. If AI breaks on a new account: Settings › AI help › Test connection shows `[CODE]`; table in `server/README.md`; `GET /api/ai/status` with the sync key shows the server's AI set-up.
4. Older: hover-open for the web-page floating panel; remaining More options toggles (section 10).

## 11b. Saved ideas
All of them, grouped (Notes feel like one note · UX · Unclear things · UI · Reader · All notes · V3 online · Onboarding) with their Why: **`docs/roadmap.md`**. Highlights: same-indent spacing, list-then-explain, editing last note in the note box, smaller edit card, formatting in highlights, numbered nested lists, indent a whole list at once, horizontal panel / drag-to-indent, autocorrect pick-list, settings redesign, choose home (All notes), open doc from a course, login + auto sync + sharing, habit-aware usage reports, AI on phone, textbooks, online status bar, offline AI.

## 12. Open questions ⚠️
- Spacing: owner clarified they want same-indent notes closer than indent changes (not built; tight 2px everywhere for now).
- Should Chrome's panel also be used on other blocked pages (chrome://extensions etc.), or only on new tab pages (current)?

## 13. Re-attach checklist
- Nothing to attach: code, docs and ideas are all in the repo. Secrets are NOT in the repo: sync key (LAZYNOTES_KEY) and AI_KEY live on Render › lazy-notes › Environment and in the owner's extension settings. On a new account, connect GitHub (repo Drylee234/Lazy-Notes) and, for Render tools, the Render workspace.

---
<sub>Audit: 13/13 sections · 14 rules · 34 corrections · 60 data points · secrets removed: yes · generated by active-memory</sub>
