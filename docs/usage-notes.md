# Usage notes — how the extension is really used

Observations from the owner's real notes (exports, screen recordings), what
went wrong, whose slip it was (the extension's or the person's), and what was
changed because of it. Read this before "fixing" a behaviour that looks odd:
it may exist because of something below.

**Add an entry** whenever the owner shares real notes, screenshots or
recordings, or reports a slip. Newest first. Keep each one short: what was
seen → cause → what changed (commit) or what's still open.

---

## 2026-11-27 (day) · AI connection
- Both routes failed with no clear reason → server and extension now name every failure with a code (`server/README.md`). Then **[AI_EMPTY]**: Groq's default model gpt-oss-120b "thinks" first and the test allowed only 16 tokens → room given (≥ 400 + reasoning_effort low). Owner confirmed **AI works** through the Render server.
- Chrome error "windows.create … width: expected integer" on the panel pop-out → sizes rounded.
- Many usage reports this day are in `docs/roadmap.md` (not built, by the owner's rule).

---

## 2026-11-27 (morning) · Ideas to save (owner: "not yet, just mentioning")

- **Spacing, what was really meant:** notes at the *same* indent should sit closer together than the gap where the indent changes (entering / leaving a nest). The night's change made every gap 2px; next step = small gap within a level, bigger gap at an indent change. Not built.
- **Edge tab panel feels off** → maybe a horizontal panel (slides from top/bottom) so click-and-disappear feels smoother. Not built; doesn't affect owner yet. Note: a bottom drawer was rejected earlier (handoff §7): ask before building.
- **Login layer:** no login = no backup; logged in = sync is automatic between desktop and phone (no "Sync now"). Then **share notes from one account to another**. Not built. Server today: Render + Postgres with one shared key (handoff §8).
- Owner may switch accounts: keep handoff + usage notes complete so a new session needs no back-and-forth.

---

## 2026-11-27 (night) · Owner's list before logging off + Claude's own test run on a PDF

**Asked for (owner)**
- Settings were cluttered: couldn't tell "switches kept in case I want to revert" from useful ones → regrouped: everyday choices first, **Fine-tuning** (helpers that are on), **Old ways, kept in case you want them back** (all off; tick to bring an old way back). Changed lines get a mark + ↺ (back to default); "Find a setting" box. `lnPagePanelOwn` shows inverted there ("Chrome's own side panel… instead").
- "Forgetting how to use my own creation" → **How-to-use tour** (`tour.html`): slides with real screenshots and numbered markers; opens by itself each time the extension is reloaded/updated (`lnTourOnReload`, switch on the tour's last line and in Settings). Pictures are made by `tools/make-tour-shots.js` — rerun it after UI changes.
- **The real reason for the indent/ownership complaints**: the gap between two separately saved notes (8px) was bigger than between lines typed in one note (0px) → notes now sit 2px apart (headings keep their room). `lnNoteGap` "roomy" = old gap (in Old ways).
- ⋮⋮ ⇤ ⇥ edge buttons hard to find → bigger, stacked down the left margin (still off the words), wider hover zone; the hovered note's card wins over a focused one. `lnToolsSize` "small" = old row. (Existing shortcut: Alt + ← → on a focused note.)
- "Why can't I edit typed notes in All notes" → typed notes edit in place there (same formatted box; Enter saves, Shift+Enter new line, Esc cancels, click away saves); every note gets ↑ ↓ ⇤ ⇥ on its left edge and Alt + arrows; nesting + guide lines show; a highlight turned into "My note" keeps its place. Only while showing everything "As taken".

**Slips found by Claude using the highlighter on a lecture PDF**

| Seen | Whose | Change |
|---|---|---|
| "Where do these notes go?": after picking the course with the keyboard, Enter did nothing (topic not picked, Save disabled) | Extension | A course with one topic picks it; Enter saves. "+ New topic…" in the topic list (a new lecture usually needs one) |
| After "Save notes here" the highlighter stayed off, so selecting did nothing | Extension | Choosing a place switches the highlighter on |
| Reader pill "Highlighter off": clicking it tried to open Chrome's side panel (disabled now) | Extension | Click switches the highlighter on when a topic is picked |
| Big all-caps PDF title guessed as **Definition** (the " - " in "PIO 201 - TRANSPORT…") | Extension | Big / all-caps short lines guessed Header / Sub topic first; in PDFs size is compared with the page's usual text size |
| Save pop-up offered "Join to …Introduction" (a sentence glued onto a heading) | Extension | No Join after a Header / Sub topic / figure / table |
| A Definition from a PDF showed the list items, heading and next paragraph around it | Extension | PDF context stays inside the paragraph; a highlight that's already a whole sentence shows alone |
| Floating panel covers the right part of the page at "Fit to width" | Design | **Open idea**: fit to the space left of the panel (switchable) |
| Quick note box: "Pick a course and topic…" while the panel shows one (after "Not now") | Design | **Open idea**: offer the panel's topic right in the box |

---

## 2026-11-26 · Which course a new document saves to

**Reported by the owner (screenshot of the side panel Home + message)**
- Some documents show under more than one course, and there was no way to take one out of a course.
- A newly opened PDF opened "to the last course and topic used", so its notes landed in the wrong course.
- The Course / Topics picker on Home is redundant while a document is open (the document card has "Saving to").
- "Open a document…" only showed when no document was open.

**Cause → change**
- New documents inherited `activeCourse/activeTopic` (the previous document's). Now a new document starts with none and asks (box in the reader; suggests a course from the course code in the file name, else the AI if on). Skip = unfiled. Switch: `lnAskPlace`.
- Documents list per course comes from notes' links, so a doc whose notes were saved under two courses shows in both. Each card now has ✕ "Remove from this course" (notes untouched; `lnCourseDocHide`).
- Home's Course / Topics block is gone altogether. A slim top bar replaces it: "Saving to Course › Topic" (always shown, "+ New course" / "+ New topic" at the end of its dropdowns) and "+ Open a document…", which opens the computer's file picker directly (not the reader's start page). Topics are browsed/made in the Study tab.
- Also fixed: overlapping `lnDocs` writes in `docs-recent.js` could drop the new document's record (now queued).

---

## 2026-11-26 (evening) · first real use of the AI, reported live

**Slips seen → cause → change**

| Seen | Cause | Change |
|---|---|---|
| "Uncaught TypeError: Cannot read properties of undefined (reading 'local')" on an open page | Extension: a page open when the extension reloads keeps a dead `content.js` — `chrome` is there but `chrome.storage` is gone, and five places touched it at start-up | All storage access goes through guarded helpers; an orphaned script goes quiet · `(orphan fix)` |
| "no doc was open yet it reads last input" | Extension: the document text store lives in session storage, which outlives the reader tab, so the AI would read a document closed an hour ago and call it "this document" | Reader clears it on close; a document job also checks a reader is really open · `(stale doc fix)` |
| Sync needed pressing "Sync now" by hand | Extension: one 60s wake attempt against a free host that sleeps — the first request is what starts it waking and nearly always times out | Two 90s wake attempts, faster retry ladder, opening the side panel pushes what's waiting, "Waking your server…" status · `ceccdc1` |
| "the indenting isnt working both tab and sift tab change type" | Extension: Shift+Tab only indented inside a bullet; on an ordinary line the browser moved focus instead and it looked like the type changed | Shift+Tab indents any line and never reaches the type picker |
| Model box still shown while meaning to use the server | Person: Service was still Groq (the model shown was Groq's default) | Nothing to change — the box does hide on "My Lazy Notes server" |

**Asked for, last word of the session (2026-11-26, before logging off)**
- **Ask for a Groq API key, not a generic one.** The wording everywhere that
  asks for a key should name Groq: it is the default service and the one that
  stays free (~30 requests a minute, ~1,000 a day). Gemini, Claude, OpenRouter
  and the server route all stay — they are still offered, and more will be
  added — but Groq is what a new user should be pointed at by name. Places to
  change: Settings › AI (the key field's placeholder and the line under it),
  README's AI section, and `server/README.md` where it describes `AI_KEY`.

**Still open (asked for, not built yet)**
- Ask about the open PDF straight from the AI tab, with a choice of asking about the document vs the selection.
- A quick way back to edit the last note you typed (check the existing Tab path first; else Ctrl+↑).
- "+ Open a document" wanted at the top left; a parallel session moved it, owner says the position still hasn't changed.
- AI connection reported as still not working; owner is tracking it themselves.

---

## 2026-11-26 · BME213 (Physiology): "Introduction" + "Cell and its functions"

**How the owner works**
- Reads notes mostly in the extension's own views (Study tab / All notes),
  **not** the Markdown/HTML export (yet). Export fixes matter less than what
  the app shows and what gets saved.
- Source: lecture PDF "PIO 201- Introduction to PHG and Blood (Lecture1).pdf",
  read in our PDF reader.
- Mixes highlights with lots of **typed** notes (fast, few full stops, typos).
- Tables from slides are saved as **snips (Figure type)**, not the Table
  type. A table that runs over a page break becomes two snips ("Table of
  organelles…" + "Table contd"); the second starts with an orphan row.
- Saves "Heading : definition" in one go as a heading (e.g. "Membrane
  Proteins :are the proteins inside the membrane itself").

**Slips seen → cause → change**

| Seen | Cause | Change |
|---|---|---|
| "the **8** extracellular fluid", "…cell membrane **10**" | PDF page/slide numbers picked up with the selection | Lone 1–3 digit lines dropped on save and on paste into the note box; skipped for tables (`lnDropPageNums`) · `e3e1256` |
| Same line saved twice ("Inside it are various organelles…") | Person (double save) | Save pop-up warns "Already saved in this topic" (`lnDupWarn`) · `e3e1256` |
| Heading with its definition in one note | Person (saved the whole line as Sub topic) | "Heading: words…" saved as a heading → heading + Definition (`lnHeadSplit`) · `e3e1256` |
| Course export showed only "hiii" | Unclear; maybe a 2nd course differing by caps/spaces | Creating a course/topic that differs only by caps/spaces opens the existing one · `e3e1256` |
| Export: Plain line over points not a heading; typed "- point" broke the list; indents lost; Summary unlabelled | Extension (export didn't match the app) | Exporter matches the app · `e3e1256` |
| "membrane ,plasma", "Pergamum : discovered", "(1791)discovered", "( not yet named )", "produc[tion", "selectively  permeable" | Person (typing fast) | Fixed while typing (`lnPunctFix`); also autocorrect no longer turns "https:" into "http:" |
| Typos left in saved notes (Industralization, imagingj, doublehelix) | Person; spell check only works while typing | **Open idea:** underline mistakes in the Study view (switchable) |
| Factual slip: "Luigi Giovanni" (Galvani) | Person or slide | Nothing to automate |
| White table snips glare in dark mode | Extension look | **Open idea:** dim pictures slightly in dark mode (switchable) |
| Table split across two snips | PDF page break | **Open idea:** "Join to last figure" stacks a snip under the previous one |

## 2026-11-26 · Bug report: PDF highlight + Home key

- Pressing the mouse just beside text didn't start a highlight until the pointer reached a word → presses within 28px of a word now snap to it (`lnDocSnap`, Settings › More options).
- Home/End in the PDF keyboard cursor went to the start of one text piece, not the line → now go to the visual line start/end (Shift extends). Cursor can already be switched off (`lnDocCaret`).

## 2026-11-26 · Bug report: notes nested under a typed list item

- A highlight indented under a typed note's list item ("Simple Diffusion:") left a big gap and wasn't "owned" by it → the fold ▾ button now sits at the end of the last line (it was on its own line in typed notes), and indented notes belong to the nearest less-indented note above (fold hides them; any types).

## 2026-11-26 · Bug report: floating panel + list items + drops

- Resizing the floating panel from its corner didn't work (the iframe covered the CSS grip) → thin handles on all edges/corners.
- A list point saved after an indented note now takes the same indent (the next item of the list being built).
- The Study list scrolls to the newest note when a highlight is sent to it.
- Dragging text into a note box always made a quote → Settings › More options "Text dragged into a note box goes in as normal text" (`lnDropPlain`, off by default).
- Open: "basic hover gestures" on the floating panel and "Ctrl+Up" — asked the owner what they mean.
- Answered: Ctrl+↑ in the Study note box jumps to the last note (Enter edits it; Ctrl+↓ on a note returns to the box). "Hover gesture" = the floating box fades while the mouse is away, solid on hover/focus (`lnPanelFade`, Settings › More options).

## 2026-11-26 · Readers: full screen + no Chrome side panel

- Readers (PDF/slides/Word) open full screen once per tab via `chrome.windows.update` (no click needed; F11 leaves) — `lnReaderFullscreen`.
- Chrome's side panel is switched off on reader tabs; the toolbar button toggles the built-in Notes panel there (`LN_TOGGLE_PANEL`). Web pages still use Chrome's panel (an in-page panel there would mean injecting an iframe into every site) — `lnReaderNativePanel` brings Chrome's panel back in readers.

## 2026-11-26 · Readers: hover-open, layout, All notes

- Fade stays; hovering the Notes edge tab (or a folded floating bar) now opens the panel after ~0.3s and moving away closes it (not if you clicked into it) — `lnPanelHover`.
- Home layout in the panel: NOW READING card first, then SAVING TO pickers, then a bigger "+ Open a document…" link (owner's screenshot).
- Chrome's side panel is also actively closed when a reader tab loads (`sidePanel.close`); the "Saving to…" pill shows our panel instead of Chrome's.
- "All notes" button in every reader toolbar (opens courses.html in a new tab).

## 2026-11-26 · "How to use"

- Owner forgot the floating note typer shortcut (Ctrl+.). Added a shortcuts list (`shared/howto.js`, single source): `?` button in the reader panel's title bar (also the `?` key) opens it over the page; `howto.html` page; "How to use" link in the side panel footer. Keep the list updated when shortcuts change.

## 2026-11-27 · Chrome panel still showing in a reader; "Saving to" with no document

- Chrome's side panel still appeared beside a reader → the reader now tells the background it's open (on load, focus, and whenever it notices Chrome's panel is open) and the background disables + closes Chrome's panel for that tab (`READER_READY`).
- Home showed "Saving to course › topic" even with no document open → the Saving-to row only shows while a document is open in the tab; otherwise just "+ Open a document…" and "Continue reading".
- "+ Open a document…" moved to the top right of the documents list (same row as "Continue reading" / "Other documents"); the Saving-to bar is hidden entirely when no document is open.

## 2026-11-27 · Phone site: file name under notes + PWA

- The phone site showed "PIO 201….pdf, p. 2" under the first note (source line shows where the source changes, including the first note). Now only shown in a topic that mixes sources.
- Phone site is an installable PWA (manifest, 192/512/maskable icons, service worker at /sw.js, app shell cached; notes always from the network). Chrome's "This app cannot be installed" came from the missing manifest/service worker.

## 2026-11-27 · Own panel on web pages, rename, name soft-coded

- Owner prefers a self-built panel everywhere (like Web Highlights) instead of Chrome's: web pages now get our docked panel (`content/page-panel.js`, iframe of sidepanel.html?embedded=1&page=1, resizable, Alt+Shift+L / toolbar button / Ctrl+.). Switch: `lnPagePanelOwn` (off = Chrome's panel). Falls back to Chrome's panel if the page can't hold ours.
- Rename courses/topics (`RENAME_COURSE` / `RENAME_TOPIC`): ✎ on All notes rows; ✎ course / ✎ topic in the Study picker. Order kept; active course/topic and saved documents follow.
- The outer "Lazy Notes" title above the panel's own header was redundant → removed (floating reader bar and page panel).
- App name: one source, `name` in manifest.json (`shared/brand.js` swaps it into every extension page). Phone site: `APP_NAME` env var on Render.
- Hover timing is adjustable: Settings › More options › "rest this long before it opens" (Instant / 0.15 / 0.3 / 0.6 / 1s, `lnPanelHoverMs`) and "wait before it closes" (0.2 / 0.7 / 1.5 / 3s, `lnPanelHoverCloseMs`).
- Owner saw Chrome's own side panel on chrome://extensions (our panel can't be injected into chrome:// pages). Now: Chrome's panel is disabled globally while `lnPagePanelOwn` is on (default), so it can't be opened/listed; on pages that can't hold ours (chrome://, Web Store, new tab) the toolbar button / Alt+Shift+L open our panel in a small window beside the browser (reused if open). Turn `lnPagePanelOwn` off to get Chrome's panel back everywhere.
- In-page / reader panel: Study and AI tabs only (Home hidden; "Show the Home tab" in More options, `lnEmbedHome`), and no "Lazy Notes" text beside the logo (the title bar / toolbar already say it).

## 2026-11-27 · No new window; title bar names the view; floating panel on web pages

- Owner didn't want the small window on chrome:// pages (and its repeated name) → removed. Pages Chrome won't let us touch now just flash a "✕" on the toolbar icon. In any `?window=1` window the name beside the logo is hidden.
- Reader/page panel title bar shows the current view (Study / AI / Home) and clicking it switches; the tab row inside is hidden in embedded panels (`ln-view` / `ln-next-view` messages).
- Web pages can use a floating panel like the readers (drag, 8-edge resize, fold, fades): Settings › More options › "Panel on web pages" Docked | Floating (`lnPagePanelMode`, default docked).
- Study tab: nested notes now show thread-style guide lines (one per level, under the owner's bullet), and hovering an owner lights up everything it owns. Ownership by indent was already in `noteParents` (fold hides the nested notes).

## 2026-11-27 · Spacing, Ctrl+. with the floating panel, Home back, Chrome panel on new tab

- Extra space between notes: blank lines at the start/end of a note (a trailing Enter, a PDF line break) were shown → trimmed when displayed (`trimBlankLines`).
- Floating panel showing (even folded) = Ctrl+. goes into its note box. Now: Ctrl+Shift+. always opens the pop-up note box; optional "Ctrl+. while the floating panel is folded or hidden" (`lnQuickWhenFolded`, off). Already-existing ways: double-click blank space, right-click › Quick note here, ✎ Note in the save pop-up.
- Hiding Home cost the owner the document list/Open → Home is back in the built-in panel via the title-bar view switcher (rest ~0.5s or click → Home / Study / AI; hover-opened list closes 0.4s after leaving, like the dropdowns). `lnEmbedHome` now means "also show the tab row".
- New tab pages use Chrome's own side panel (full Home); every other page uses ours.
- Owner's standing preference saved in CLAUDE.md: "perhaps" = tell me if something existing already does it; warn me if it reverts an earlier benefit.

## 2026-11-27 (evening) · Reports after the AI / login / sharing round

- **Repeating "Uncaught TypeError: crypto.randomUUID is not a function"** (owner screenshot, extensions page). Whose: ours. On plain **http://** sites Chrome doesn't give content scripts `crypto.randomUUID`, so `content.js` threw on load and the highlighter was dead on those sites. Fixed with a fallback (`newId()`), tested on an http page.
- **Topic dropdown opening and closing in a loop** when hovering a long topic name. Whose: ours. Opening the list scrolled the Course › Topic line sideways (the list stuck out past the panel and `scrollIntoView` pulled it into view), sliding the topic out from under the mouse, which closed it, which slid it back. Fixed: the list opens leftwards when there's no room, only the list scrolls, the topic's width no longer depends on its name, and a long name scrolls across while you rest on it (owner's idea). Reproduced and checked in Chromium.
- **Account creation from a phone**: owner wants accounts made only in the extension (it's PC-only). Server now refuses sign-ups not coming from the extension.
- **Documents "reading to different courses"**: owner suspects documents used by two courses. Logged as a design question (roadmap), not built.
- **Same-indent spacing**: owner re-checked: false alarm.
- Owner asked "when did I say that?" about *underline spelling in Study*, *Fit to width leaves room for the panel* and *Join to last figure*: these were Claude's own ideas from earlier sessions, not the owner's. Marked as such in the roadmap.

## 2026-11-27 (late) · Stiff AI, misleading indents, Study on a search page, cramped settings

- **AI chat too stiff** (owner screenshot: "hiii" → "The material doesn't include a response to a greeting"). Whose: ours: the chat was told to stick to the notes and tag anything else "(general)". Now a natural study buddy that uses the notes when relevant and its own knowledge freely.
- **Indented list that looked like part of the wrong group** ("FACTORS AFFECTING NET RATE DIFFUSION" and its points sat inside the Simple Diffusion nest). Whose: ours: the new "keep the indent of the note above" rule also applied to list heads. Now list heads (and split lists' heads) start at the left. The owner's existing notes were not moved; Shift+↓ to pick them, Alt+← to fix.
- **Study showed a topic on Google's search page.** Owner: Study should be empty when not on a document. Now empty with "Show it anyway" unless in a reader, on a page the notes came from, or with the highlighter on (`lnStudyAnywhere` brings back the old way).
- **Settings felt cramped in the panel**; only All notes' settings felt like real settings → the panel's settings now fill the panel the same way.
- Owner liked idea E (easier switching) → built (Alt+1/2/3, pinned Course › Topic); asked to see A as an image and B explained with an image before building.

## 2026-11-27 (night) · Plain for "Term:" + meaning; one bar up top

- Owner: "the main type of times I use Plain is: heading : then definition" (screenshot: "Passive Transport:" then, indented, "means the transport without usage of ATP"). Not a slip, a habit: that's a definition split in two notes. Told them the existing ways (highlight both + 2 → "Split into heading + Definition", or 3 for the meaning line); logged an idea to guess Definition there.
- Owner asked to move the panel's own bar (AI ▾ ? Float Dock Bottom ⧉ ✕) up into the icon row → done (one bar).

## 2026-11-28 · The red "Sync isn't working" box was too much

- Owner screenshot (phone, side panel): a big red box "Sync isn't working: the server had a problem (is its database connected? check DATABASE_URL on Render). Next try 08:23 AM. [Retry] [Fix]". Owner: if sync fails it's most likely just being offline; users don't need all that.
- Whose: ours. The box spoke server-owner language to everyone and showed for problems that fix themselves.
- Now: no box for offline / asleep / server errors (it retries by itself; the online pill shows "Waiting"). The box only shows, as one line, when the user must act: "Sync paused: you're logged out. [Log in]" or "Sync paused: notes are over 30 MB. [Fix]".

## 2026-11-28 · Expected a big green dot on the toolbar icon

- Owner: the green dot in the panel's Highlighter switch is what they expected on the toolbar icon (beside the puzzle piece) when the highlighter is on. Whose: ours: Chrome's badge only draws a small square in the corner. Now the icon itself gets a big round green dot with a white ring; off = the plain icon.

## 2026-11-28 · "This server has no AI key" on the phone; boxed fold arrows; "less vibecoded"

- Owner screenshot (phone): the AI box said "This server has no AI key: add AI_KEY in Render › lazy-notes › Environment", and two testers already have the link. Whose: ours: the server sent its set-up problems to everyone. Now testers only ever see plain words ("The AI isn't available right now. Try again later."); the full reason goes to the server log and to the owner's server key. Error codes in brackets are hidden from account users in the extension too. The "Use the server key instead" login option is hidden unless the address has `?key`.
- Fold arrows had a box around them → just a chevron (folded: › and the count), on the phone and in the extension.
- Owner asked to apply online tips on avoiding the "vibe-coded" look to the new site: no pill labels, gradients, glows, emoji icon cards or fake window frames; a book serif for headings; concrete copy.
- Owner asked if the extension can reload itself: Chrome doesn't let an unpacked extension replace its own files, but it can reload itself. The update notice now has "Reload Q-notes", and says "the new version is in your folder" once the files are replaced.

## 2026-11-28 (later) · Reader toolbar, page pictures, Notes vs Saving, "less vibecoded" in the extension

- **Page list had no pictures** (owner screenshot "PAGES / Page 1 / Page 2"): expected page previews like Chrome's viewer. Now page thumbnails (drawn as they scroll into view); with a real outline, Pages | Outline tabs.
- **Page controls on a second row** with empty space above them. Whose: ours: the "does it fit?" check counted the whole file name and the whole "Saving to Course › Topic" text, so a long lecture name forced two rows. Now the name and the pill shorten with "…"; two rows only when the toolbar truly can't fit (e.g. ~600px beside the docked panel). Also fixed: ☰/logo/Open could be cut off when the panel was docked.
- **Notes button and "Saving to …" did the same thing**, and Saving didn't close the panel → one button: the pill opens and closes the notes.
- **"I said I don't want a bottom bar or a separate window"**: the Bottom and ⧉ buttons are gone from the panel bar (Bottom stays in Settings only).
- Extension "less vibecoded" pass, part 1 (no colour change yet): no green halo or purple outline on the Highlighter switch and pill, plain green dot on the toolbar icon (no ring), no ✨/🆕/✎/❝ in labels, AI quick buttons as plain words in one row, no "AI" badge on every answer, quiet failed answers, plain footer buttons.
- Colour + new logo: the main colour #4f46e5 is Tailwind's indigo-600, the default the articles name as the AI tell. Three directions shown (Ink / Library green / Red pen) for the owner to pick.
