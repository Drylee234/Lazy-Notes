# active-memory handoff: Lazy Notes (Chrome extension)

**Handoff #1** · 2026-11-25 · Lineage: #1 (2026-11-25): PDF prompt, slides reader, Study-tab note-taker, hover dropdowns, Enter-to-save, new types, editor, undo, PDF selection fix

## 0. Instructions for Claude (read first)

You are continuing work from a previous chat. That chat is gone; this file is the complete context and the source of truth.

1. Read this whole file before replying.
2. Follow sections 3 (Style), 4 (Hard rules) and 5 (Corrections) in every reply, for the rest of this chat. They override your defaults.
3. Use the values in section 8 exactly. Never round, re-estimate, or "correct" them.
4. Do not suggest anything listed in section 7 (Changed / rejected) again unless the user brings it up.
5. Code word: None active. If the user types /amcodeword, start every reply with the phrase they choose (default "Yes Boss!").
6. Your first reply: at most 5 lines covering the goal, the current state, and the next step (section 11). Mention any files from section 13 that were not attached. Ask the questions in section 12 if there are any. End with "Ready to continue with <next step>?" Then wait for the user's go.

## 1. Mission
- **Goal:** Improve "Lazy Notes", a Manifest V3 Chrome extension for students: highlight text on web pages, PDFs and slides, tag it (course › topic › type), and study it as notes.
- **Done looks like:** features work in real Chrome, tested, pushed to `main`.
- **Why it matters / context:** the user studies from lecture PDFs/slides (e.g. course "Get 205", topic "Basics" seen in their side panel).

## 2. About the user (as relevant to this work)
- Student; repo owner on GitHub: `Drylee234/Lazy-Notes`. Uses Chrome with the extension loaded unpacked.
- Compares features with the "Web Highlights" extension.
- Types quickly with typos ("pis" = pictures, "fgeneric" = generic, "mehn"). Interpret charitably; ask when truly ambiguous.
- Mainly scrolls PDFs with the mouse. Token/usage conscious (hit a usage limit once).

## 3. Style & communication
- **Language:** English.
- **Tone:** direct, plain; explain what you're doing briefly (user asked: "id enjoy if you explained what youre doing tho incase its an ingenous thing so it doesnt get wasted").
- **Reply length:** short; lead with the outcome.
- **Formatting:** short paragraphs/bullets; commit hashes in backticks.
- **Working style:** act on clear requests; ask (AskUserQuestion with options) only for genuinely ambiguous design choices (user: "if youre confused ask"). Test in Chromium with Playwright before pushing. Parallel background workers are OK when the user wants speed, but prefer saving tokens.
- **Avoid:** wasting tokens on long investigations; "answer immediatley so u dont waste more tokens" when user asks a direct question.

## 4. Hard rules (word for word)
1. "when i say push to main unless i say otherwise later i mean always push to main you test it on your device first anyway" → after testing, push to both `main` and branch `claude/laughing-bohr-83wevp`.
2. Commit message ending lines (required by the environment): `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_017swkiRPYMxeRqG1y1qRdSX` (new session will get its own Claude-Session line from its environment; use that).
3. Do not create pull requests unless asked.
4. Enter should save/confirm wherever it makes sense ("let clicking the enter button be able to replae the need to manually drag the mouse to click in places where its possible").

## 5. Corrections log
| # | Claude did | The user wanted |
|---|---|---|
| 1 | Made Enter work on the PDF "Highlight this PDF" pop-up | Enter to save the side panel's "New course"/"New topic" forms (done). PDF-prompt Enter is parked |
| 2 | Hover lists closed 0.25s after mouse left | "the time for the hovering is short" → now 0.7s |
| 3 | Picking a type with the mouse broke Enter-to-save | Enter must still save (fixed) |
| 4 | Slides reader rendered text only | Show pictures, and light formatting (done) |
| 5 | Side panel button said "PDF reader" | "Document reader" that opens PDF and .pptx (done) |
| 6 | Note editor showed all fields | Only text first; type/annotation/context collapsed under "More" (done) |

## 6. Decisions
| Decision | Why |
|---|---|
| Typed notes = own objects in `topic.notes`, mixed in time order with highlights, styled apart | user picked "Mixed in, styled apart" |
| Drag rules: text from PDF/page onto Study tab = save like a highlight; into the typing box = quote; existing highlight into the box = ask Quote or Move | user's answer |
| Study tab look = "Clean written page" | user picked |
| Slides reader is text-first with light formatting; full PowerPoint rendering not done | fidelity/effort |
| New types: "sub topic", "generic", "note" | user request |
| Undo window: save immediately, toast with Undo for 6s (Ctrl/⌘+Z too) | safer than delaying the save |

## 7. Changed / rejected
- Enter on PDF prompt (focus-stealing) → parked; worker found it costs nothing (fresh PDF ignores keys until clicked) and focus can be handed back via `chrome.dom.openOrClosedShadowRoot(document.body)`. No code exists.
- "PDF reader" button → "Document reader".
- Hover close grace 250ms → 700ms.
- ❌ Full pixel-faithful .pptx rendering (too big; suggest saving decks as PDF for real visuals).

## 8. Data & facts (exact)
- Repo: `Drylee234/Lazy-Notes`; working branch `claude/laughing-bohr-83wevp`; `main` == branch at `44d57e3` (last commit "Slides reader: light formatting").
- Hover timings: open delay 150ms, close grace 700ms (content.js and hover-select.js).
- Undo toast: 6000ms; paused on hover.
- Metadata (type · source · date) hover delay: 0.7s.
- Highlight types (order): header, sub topic, definition, formula, list head, list point, summary, generic, note. Context kept for: definition, formula, summary.
- Slides text size: 18pt = 1em, clamped 0.8–1.6em; colours dropped if contrast < 3 vs card.
- Storage: `chrome.storage.local.lazynotes.courses[course].topics[topic].{highlights, notes}`; keys activeCourse, activeTopic, highlighterActive, lastDrag.
- IndexedDB: `lazynotes-pdfs` (PDF reader), `lazynotes-slides` (slides reader), store `files`.

## 9. People, terms & names
- **Terms & nicknames:** "Study tab"/"study panel" = side panel Study view; "topics page" = side panel Topics tab; "pop downs" = dropdowns; "highlight type" = category; "pis" = pictures.
- **Names in use:** content.js (highlighter/save popup/undo), pdf-prompt.js + bg_pdf.js (Highlight this PDF pop-up), pdfreader.* (PDF/Document reader), pptx-parse.js + pptxreader.* (slides reader), sidepanel.* + study-page.js + study.css (side panel), hover-select.js/.css (side panel dropdowns), note-editor.js (shared highlight editor), viewer.js + display/courses/topics.html (All notes), exporter.js, bg_typed_notes.js.

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| "Highlight this PDF" pop-up + new-tab button | final | main | |
| Side panel shared course across tabs | final | main | |
| Save popup hover lists, Enter fixes | final | main | |
| Enter saves New course/topic forms | final | main | |
| Side panel hover dropdowns | final | main | |
| Study tab note-taker, edit/delete highlights, compact editor | final | main | |
| New types | final | main | |
| Undo toast | final | main | |
| PDF selection-jump fix | final | main `68961a7` | |
| Slides reader (+pictures, light formatting, Document reader routing) | final | main `44d57e3` | theme colours/fonts/positions not shown |
| Auto-open PDFs in Lazy Notes | not started | — | offered, user hasn't decided |
| PDF-prompt Enter key | parked | — | |

Tests: Playwright scripts lived in the old session's scratchpad (gone). Approach: `chromium.launchPersistentContext(dir, {channel:'chromium', headless:true, args:['--disable-extensions-except=<repo>','--load-extension=<repo>']})`, seed storage via the service worker, small python test server for pages/PDFs.

## 11. Next steps
1. **Next action:** ask the user whether to build auto-opening PDFs in the Lazy Notes reader (off by default, toggle in side panel), or what to do next.
2. Test in Chromium, then push to `main` and the branch.

## 12. Open questions ⚠️
- Auto-open PDFs in Lazy Notes: build it? (yes / no)
- PDF-prompt Enter key: revive it? (yes / leave parked)

## 13. Re-attach checklist
- Nothing to attach (code is in the repo).

---
<sub>Audit: 13/13 sections · 4 rules · 6 corrections · 12 data points · secrets removed: none found · generated by active-memory</sub>
