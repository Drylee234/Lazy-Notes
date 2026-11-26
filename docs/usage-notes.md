# Usage notes — how the extension is really used

Observations from the owner's real notes (exports, screen recordings), what
went wrong, whose slip it was (the extension's or the person's), and what was
changed because of it. Read this before "fixing" a behaviour that looks odd:
it may exist because of something below.

**Add an entry** whenever the owner shares real notes, screenshots or
recordings, or reports a slip. Newest first. Keep each one short: what was
seen → cause → what changed (commit) or what's still open.

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
