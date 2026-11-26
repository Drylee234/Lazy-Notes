# active-memory handoff: Lazy Notes (Chrome extension)

**Handoff #3** · 2026-11-26 · Lineage: #1 (2026-11-25): PDF prompt, slides reader, Study-tab note-taker, hover dropdowns, Enter-to-save, new types, editor, undo, PDF selection fix; #2 (2026-11-26): slides look like PPT, themes, Home/Study redesign, rich note box, spell check, chips + number keys, list splitting, join, outline headings, figures, reorder/indent, backup, sync server on Render, built-in Notes panel in readers, zoom/rotate/caret, Word reader; #3 (2026-11-26): edge-tab Notes panel + pop-out window, pop-up note box (5 ways to open), PDF caret-while-dragging fix, document words in spell check + typing hints, pinch zoom, Note/Quote on web pages, joined PDF lines, + New topic in Study, List head type back, fold/unfold + filters with heads, Settings › More options

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
- Student; GitHub repo owner `Drylee234/Lazy-Notes`. Uses Chrome with the extension loaded unpacked; Windows-style trackpad (two-finger pinch zoom; no mouse wheel/side buttons assumed).
- Compares UX with the "Web Highlights" extension (finds its panel smoother).
- Types fast with typos/slang ("sha", "na", "lwk", "idrk", "yk", "ass" = bad, "yhh"/"yhhhh" = yes, "lit" = good). Interpret charitably; ask when truly ambiguous.
- Cares a lot about UX and speed of taking notes (keyboard-first, fewer mouse trips). Wants IMAGES/mockups to pick between options ("IMAGES SO IK WHICH TO PICK").
- Has a Render account (workspace "Alfred's workspace") and GitHub connected to Render. Sync to the server works ("yessss").

## 3. Style & communication
- **Language:** English.
- **Tone:** direct, plain, friendly; briefly explain what you're doing.
- **Reply length:** short; lead with the outcome; bullets/tables.
- **Formatting:** short sections, bullets, tables; commit hashes in backticks; send screenshots/mockups (SendUserFile) and always say which image is which (number/name printed on the image itself works well).
- **Working style:** act on clear requests; ask only for genuinely ambiguous choices; brainstorm with labelled mockup images when user says "brainstorm"/"show me"/asks to pick. Test in Chromium before pushing. Parallel background workers are welcome for big batches, on separate files; re-test everything together before pushing to main.
- **Avoid:** wasting tokens; long investigations; overlapping UI (e.g. a floating bar over chips was moved); covering text; deleting things outright (hide behind a setting instead).

## 4. Hard rules (word for word)
1. "when i say push to main unless i say otherwise later i mean always push to main you test it on your device first anyway" → after testing, push to `main` AND the session's working branch.
2. "whatever thing ive removed or perhaps ask to be removed in the future simply add a setting to turn it on or off" (so work isn't wasted).
3. "let clicking the enter button be able to replae the need to manually drag the mouse to click in places where its possible".
4. "seriously consider Ux" / "be careful" (reorder: never lose or scramble notes).
5. Do not create pull requests unless asked. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the session's `Claude-Session:` line (new session gets its own; branch name also comes from the new environment).
6. Unfinished worker work goes to the working branch only (WIP commit), never to `main` until tested.
7. "make all and make them togglable" → new ways of doing something are all built, each with an on/off switch (Settings › More options).

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
| 9 | Side panel's async onMessage listener swallowed replies (Join's Undo deleted the note) | Fixed: non-async listener (keep every onMessage listener non-async) |
| 10 | "pick one" (computer vs Render) was unclear | They were alternatives; Render chosen and deployed |
| 11 | Mouse-button "save instantly" idea | Rejected: can't edit before saving |
| 12 | "Saving to …" line in save pop-up | Removed (shown only in red when no topic) |
| 13 | Panel options described in words only | Wanted images to pick from |
| 14 | PDF keyboard caret drawn while dragging a selection ("the cursor moves instead of a highlight") | Caret hidden while the mouse is down; shows only after a plain click or Shift+arrows; switch lnDocCaret |
| 15 | Typing-hint bar floated over the pop-up box's type chips | Hint shown in the box's own footer line (no overlap) |
| 17 | Tidy joined lines in notes typed in the Study box but saved as Plain; highlight text showed without line breaks; Shift+Enter gave blank lines | Typed-as-type notes never tidied (and restored); .note-text keeps line breaks; one Shift+Enter = one line |
| 18 | Study note box's Save-as was a plain dropdown (number only selected) | Tab shows numbered chips like the save pop-up; a number saves at once; ←/→ move; Enter saves; Shift+Tab/Esc back |
| 19 | Hover tools (⋮⋮ ⇤ ⇥) covered the words; notes too far apart; suggestion strip too small | Tools only when the mouse is in a note's left margin (or keyboard focus); 2px between notes; strip 13.5px with accent border |
| 20 | Study opened a course's first topic when none was picked | Study shows only the picked topic (Home or its picker); else "Pick a topic" |
| 21 | Pop-out was a separate OS window | Default is a floating in-page box: drag by title bar, resize corner, − / + fold, remembers place; Ctrl+. into its note box |
| 16 | Fold button in the left margin, under the Study tab's drag handle / indent buttons | Fold button right after the heading's words |

## 6. Decisions
| Decision | Why |
|---|---|
| Table type (key T, ▦): rows = lines, cells = tabs / | / 2+ spaces; guessed for selections inside <table> or tab-separated lines; markdown + HTML export | user asked |
| Courses list their documents (Home "Documents in this course", course page cards) from notes' sourceUrl + lnDocs (shared/utils.js courseDocuments) | user asked |
| Autocorrect: extra letters cost 0.55 (doubled 0.4), held letters (3+) collapsed, learned fixes, missing spaces split when both halves common (rank ≤ 25000) and clearly best | user asked |
| Types: Header(1) H, Sub topic(2) H2, Definition(3) Def, Formula(4) ƒx, List point(5) •, Important(6) ! [stored "note"], Summary(7) Σ, List head(8) ≡ [toggle lnListHeadType], Plain(0) ¶ [stored "generic"]; My note = 9 in note boxes | user approved trimmed types + compact chips; list head asked back |
| A Plain line directly above list points renders bold with a colon and counts as their list head | trim types |
| Save pop-up: compact chips, number keys save, Enter saves lit (guessed) type, Tab from text box to chips; ✎ Note / ❝ Quote buttons bottom-left | faster type selection; hand-off to note box |
| Pop-up position setting: Above/Below/Left/Right/Split | user's request |
| Note box = rich "formatted while typing" box (Option 2) storing the same markdown-ish text | user chose Option 2 |
| Study keyboard: picker ←/→; notes ↑/↓ Home/End, Enter/Space edit, Delete twice deletes, Alt+↑/↓ move, Alt+←/→ indent, plain ←/→ fold/unfold a head; note box; Save as (Tab, numbers, Enter) | user's tab-order idea |
| Server on Render (free web + free Postgres), read-only phone site | user said "deply" |
| Readers' Notes panel = 1 + 2 + 3: **edge tab** (default; slides out over the page, page keeps full width) + **pop-up note box** + **⧉ pop-out window**; "📌 Dock" keeps old docked panel (lnPanelMode) | user picked from mockups |
| Pop-up note box opens with: Ctrl+. (edge-tab mode; with a selection = quote), double-click blank space (A), ✎ Note/❝ Quote in save pop-up (B), right-click → "✎ Quick note here" (C), floating ✎ above the tab (D) — all on, each switchable | "make all and make them togglable" |
| Ctrl+/ shows/hides the panel; in Docked mode Ctrl+. jumps into the panel's note box instead | keeps old behaviour available |
| Pop-up note box: Note mode (own words; My note or any type) / Quote mode (highlight with link + your note as annotation); Enter saves, Tab → chips (number saves), Esc closes, Undo toast 6s | keyboard-first |
| Web pages: ✎ Note / ❝ Quote send the words to Chrome's side panel note box (opens it; panelRequest FILL_COMPOSER) | item "save highlight straight into note box" |
| Document words: reader publishes words to storage.session lnDocWords; spell.js treats them as correct, prefers them as fixes, offers typing hints (→ accepts) | user request |
| Pinch / Ctrl+wheel zooms only the document (PDF re-renders after a stretched preview; slides/Word via CSS zoom var --ln-z) | toolbar must stay fixed |
| Folding: Header holds all to next Header; Sub topic to next Sub topic/Header; List head (or Plain over points) holds the points after it; fold state in localStorage "ln-folded"; moving a folded head unfolds it first | grouping + "never scramble notes" |
| All notes filter shows matches under their heads (dimmed .note--context); "List heads" filter shows heads with their points | "filters show heads with their points" |

## 7. Changed / rejected
- Topics tab → renamed **Home**.
- "PDF reader" button → "Document reader" → hidden in footer (setting to bring back still pending).
- "Open the slides reader" link → removed (one start page for PDF/.pptx/.docx).
- Course/topic rows in save pop-up → hidden (toggle still pending).
- Generic → shown as **Plain**; Note → shown as **Important** (All notes filter labels fixed too).
- Formatting option 1 (symbols + bar) → Option 2 (formatted while typing).
- Editor "More" → separate folds; type picker floats beside.
- Indent in Study notes: Tab → Alt+←/→ (Tab moves between sections).
- Readers' Notes panel: always-docked → edge tab by default (docked kept as a setting).
- ❌ Mouse-button/Alt instant save without pop-up (can't edit first).
- ❌ Full pixel-faithful .pptx rendering (slides are laid out from positions instead).
- ❌ Parsing old binary .doc (message: save as .docx or PDF).
- ❌ Bottom-drawer panel (option 4) — not chosen.

## 8. Data & facts (exact)
- Repo `Drylee234/Lazy-Notes`; manifest version 2.0 (`0c7ffaf`; tag v2.0 push was refused by the session proxy — user to tag on GitHub); earlier `7f299b8` ("List head type back (8), fold/unfold …"). Before it: `23cc7cf` (doc words, pinch zoom, web Note/Quote, joined lines, new topic), `1867fd4` (edge tab, pop-up note box, caret fix), `9dcf563` (handoff #2).
- Render: workspace `tea-d9tu9qm417fc73fa0br0` ("Alfred's workspace"); web service `lazy-notes` id `srv-dc3uo7e1egvs73er4o30`, URL https://lazy-notes-c07b.onrender.com, region frankfurt, free, auto-deploys from `main`, build `pip install -r server/requirements.txt`, start `cd server && gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120`, env PYTHON_VERSION 3.12.7, LAZYNOTES_KEY = [secret removed: re-enter it].
- Render Postgres `lazy-notes-db` id `dpg-dc3uki6i0phs738klbog-a`, v16, free, frankfurt, expires 2026-12-26 (free DB: plan for renewal/backup before then). DATABASE_URL set by user; sync works.
- Server API: GET /api/health (no auth) → {"ok":true,"app":"lazy-notes"}; PUT /api/snapshot (Bearer key) body {"app":"lazy-notes","version":1,"sentAt","data":{"lazynotes","lnDocs"}}; GET /api/snapshot; 30 MB max; keeps latest + 5.
- Extension sync: pushes ~20s after changes, every 6h; wakes server via /api/health (60s timeout); retries 1, 5, 15, 30, 60 min then hourly.
- Timings: dropdown hover open 500ms, switch 300ms, hover-opened close 400ms; undo toast 6000ms (save pop-up and pop-up note box); double-click delay 230ms; editor blur-close 700ms; pinch commit 180ms after last wheel event; zoom bubble 900ms; doc words read from slides/Word 1200ms after drawing; PDF words: first 20 pages early, all up to 400 pages.
- Panel sizes: docked/slide-out width default 360px, min 280px, max half the window; pop-up note box 330px wide; pop-out window = panel width, beside the current Chrome window.
- Zoom: slides/Word 50%–300%, snaps to 100% within 3%; Ctrl+= ×1.15; pinch factor exp(−deltaY·0.01). PDF Ctrl+= ×1.2.
- Storage keys (chrome.storage.local): lazynotes (courses → topics → {highlights{id}, notes{id}}; fields incl. order, indent, image), activeCourse, activeTopic, highlighterActive, lastDrag, lnDocs, lnTheme, lnPopupSide, lnAutocorrectLevel (0 Off/1 Mild/2 Strong/3 Toxic), lnSpellIgnore, lnDocAutoSelect, pptxAutoOpen, lnLastBackup, lnSyncUrl, lnSyncKey, lnSyncState, panelRequest (types SHOW_CREATE_COURSE, SHOW_CREATE_TOPIC, FILL_COMPOSER).
- Old-notes tidy (background/bg_tidy.js): runs once on install/update/startup (lnTidyDone = 2); joins broken PDF lines in old highlights from a page/document only (never typed notes, never notes typed in a note box and saved as a type [no sourceUrl/anchor] — v2 put those back; not figures; lists kept); original kept as highlight field `textBefore`; lnTidyLog {at, count | undone}; Settings › More options › Old notes: Tidy now / Undo tidy (message TIDY_NOTES {undo}).
- Reports (background/bg_diag.js + shared/diag.js on every page): lnDiag {errors: last 100 {t, where, msg, stack}, usage: {day: {action: n}} 30 days}; sent with each sync as data.lnReport (no note text, no key) unless lnSendReports = false; server GET /api/report (Bearer key) returns it; Settings › Problems › Copy problem report (message DIAG_REPORT).
- Sync warning: side panel banner after 2 failed tries in a row (or wrong key / too big), plain-words reason + Retry / Fix (opens Settings sync) / ✕ (hidden until the error changes).
- More options keys (all on unless false): lnPanelMode ("tab" default | "docked"), lnQuickDblClick, lnQuickSelButtons, lnQuickMenu, lnQuickFloat, lnListHeadType, lnDocWordsOn, lnTypingHints, lnDocCaret, lnGroupIndent (notes under a sub topic one step in, --group-px 18px each), lnSendReports; lnBoldItalic (OFF unless true: B / I buttons in the note box; Ctrl+B/I always work; settings checkboxes with data-off are off by default). lnPanelMode now "float" (default) | "tab" | "docked". lnSpellLearned {typo: fix} (suggestions you picked).
- chrome.storage.session: lnDocWords {title, words:[[form,count]…] top 8000}, lnPanelWindow (pop-out window id).
- localStorage (per extension origin): ln-embed-<page> (panel open/width), ln-zoom-<page> (slides/Word zoom), ln-folded (folded head ids, last 3000), ln-pdf-fit.
- IndexedDB: lazynotes-pdfs, lazynotes-slides, lazynotes-docs (store "files").
- Messages added: LN_QUICK_NOTE_MENU {tabId} (background → readers, from context menu id "lazy-notes-quick-note"), SEND_TO_NOTE_BOX {mode, text} (web content.js → background). Custom DOM event "ln-typing-hint" (spell.js → field; cancel it to show the hint yourself).
- Spell: Hunspell dictionary-en + nspell (lib/), word frequency list lib/dict/en-freq.txt (top 60,000, wordfreq 3.1.1, CC BY-SA 4.0 data). Now also loaded in the three readers.

## 9. People, terms & names
- **People:** user (repo owner, student).
- **Terms & nicknames:** "note typer"/"typer" = Study tab note box (composer); "side panel" = Lazy Notes panel; "pop up"/"highlighter popup" = save pop-up; "pop-up note box"/"quick box" = readers' small note box (quick-note.js); "edge tab" = slim "Notes" tab on the readers' right edge; "reader" = our PDF/slides/Word reader; "all notes home"/"main boss home page" = courses.html; "pop downs" = dropdowns; "the jump" = caret shown while dragging (fixed).
- **Names in use (folders):** background/ (bg_*.js incl. bg_join.js, bg_sync.js, bg_arrange.js, bg_pptx.js, bg_context_menus.js), content/ (content.js save pop-up, pdf-prompt.js), readers/ (pdfreader.*, pptx*, docx*, docs-recent.js, figure-save.js, embedded-panel.* [edge tab / docked / pop-out], quick-note.* [pop-up note box + zoom bubble CSS], pinch-zoom.js [slides/Word zoom], doc-words.js [document words]), sidepanel/ (sidepanel.*, study-page.js, study.css, hover-select.*, rich-box.js), notes/ (viewer.*, notes-render.js [incl. noteParents / LnFold], notes.css, note-editor.js, exporter.js), shared/ (theme.*, utils.js, spell.js, settings.js/.css [More options], recent-docs.js), lib/, server/ (app.py, static/), render.yaml, docs/. HTML pages stay top-level (saved links depend on pdfreader.html/pptxreader.html/docxreader.html; sidepanel.html?embedded=1 in readers, ?window=1 for the pop-out).

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| Everything in Lineage #2 | final, on main | up to `9dcf563` | tested in Chromium |
| Edge tab + slide-out, Dock, ⧉ pop-out window, floating ✎ | final, on main | `1867fd4` | 28 checks passed |
| Pop-up note box (Ctrl+., double-click blank, Note/Quote, right-click, ✎) | final, on main | `1867fd4` | right-click menu tested via message (headless can't open native menus) |
| PDF caret hidden while dragging + lnDocCaret switch | final, on main | `1867fd4` | user to confirm "the jump" is gone in real Chrome |
| Doc words in spell check + typing hints | final, on main | `23cc7cf` | PDF, slides, Word |
| Pinch zoom only the document | final, on main | `23cc7cf` | tested with synthetic Ctrl+wheel; real trackpad feel unconfirmed |
| Web-page Note/Quote → side panel note box | final, on main | `23cc7cf` | — |
| Joined PDF line breaks in save pop-up | final, on main | `23cc7cf` | lists untouched |
| + New topic in Study topic list | final, on main | `23cc7cf` | — |
| List head (8), folding, filters with heads | final, on main | `7f299b8` | Study + All notes topic page |
| Smoother panel (vs Web Highlights) | waiting on user | — | redraw keeps scroll, ~0.1s for 300 notes; need what feels rough |
| Old notes get joined PDF lines (auto once, Undo in Settings) | final, on main | after `0c7ffaf` | folding, list heads, filters, doc-words already apply to old notes |
| Remaining "More options" toggles: pop-up course/topic pickers, "Saving to" line, Document reader footer link, formatting bar, built-in Notes panel on/off | NOT done | — | rule 2 |
| Drag PDF text into built-in panel | untested | — | headless can't drag into iframe |

Tests: Playwright scripts lived in the session scratchpad (gone with the session). Pattern: `chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except=<repo>','--load-extension=<repo>']})`, seed chrome.storage via the service worker (`ctx.serviceWorkers()[0].evaluate`), `python3 -m http.server 8765` for test pages; test PDFs made with reportlab, .docx with python-docx, .pptx with python-pptx. Write test files with the Write tool (shell heredocs with `>`/`&` were blocked by a safety check). `chrome.windows.create` needs bounds inside the screen (fallback without left/top is in place).

## 11. Next steps
1. **Next action:** ask the user what feels rough about the panel vs Web Highlights (opening/closing, scrolling, clicking to edit, looks) and fix that; ask them to confirm in real Chrome that the PDF "jump" is gone and pinch zoom feels right.
2. Remaining More options toggles (rule 2): pop-up course/topic pickers, "Saving to" line, Document reader footer link, formatting bar, built-in Notes panel on/off.
3. Ideas not yet requested (only if asked): drag a folded group as one; fold state synced; fold in All notes when filtered.

## 12. Open questions ⚠️
- My note vs Plain: merge? (Claude's suggestion in chat: note boxes offer one "Note"; Plain stays for highlights.)
- Item 6 "smoother panel": what exactly feels less smooth than Web Highlights?
- Does the PDF caret "jump" still happen in real Chrome?

## 13. Re-attach checklist
- Nothing to attach (code is in the repo; the sync key is in the Render service env and the user's extension settings).

---
<sub>Audit: 13/13 sections · 7 rules · 16 corrections · 45 data points · secrets removed: yes · generated by active-memory</sub>
