# Roadmap — changes and ideas by group

The single list of what's done and what's waiting, by group, so it's easy to see what changed and decide what comes next.
**Add every new idea or change here** (newest at the bottom of its group). Each idea carries **Why** (the problem the owner hit), so a different solution can be chosen later. Details live in `usage-notes.md` / `handoff-lazy-notes.md`.
✅ done · 💡 idea, not built · ⚠️ check with owner first

**Not every report needs code.** Some are fixed by using the extension differently or understanding it (an existing shortcut, a setting). Check that first, and say so: mark those 📘 "usage/understanding" with the explanation.

## 1. Notes feel like one note (owner's idea, 2026-11-27)
Today a topic reads like a pile of highlights. The parts that already feel like real notes are heading → sub topic → list head with things nested under them.
- 💡 Make the whole topic read as one written note: fewer visible seams between separate highlights (marker, gaps, hover boxes), with headings and nesting carrying the structure.
- 💡 Same-indent notes closer together than the gap where an indent starts or ends.
  **Why:** the spacing itself should show what belongs together; equal gaps everywhere hide the structure.
- 💡 **"List first, then explain each item"** (owner screenshot, 2026-11-27): a head ("Protein channels are gated… through various methods:") → list points (Voltage / Liquid / Mechanically gated channels) → then a paragraph explaining each one ("Voltage-gated channels open based on…", "Liquid gated ion channels, also known as ionotropic receptors…").
  **Why:** this is how real lecture notes are written; today the explanations are just lines in a typed note, not tied to their list item, and the structure doesn't show.
  To investigate: link each explanation to its list point (e.g. the explanation shows under a mini-heading of that item, or the list item becomes a jump link), and a "List → explain" layout.
- 💡 **Can't separate with blank lines** (same screenshot): extra empty lines in a typed note are squashed, so the owner can't space blocks apart.
  **Why:** a blank line is the natural way to separate thoughts. Check `trimBlankLines` / typed-note rendering; keep one blank line between blocks as a visible gap.
- 💡 **Investigate what makes notes feel "real"**: structure (head → items → explanations), spacing that follows meaning, fewer per-highlight seams, no edit-box jump. Show options as labelled images before building.
- ✅ Tight spacing: separate notes 2px apart, like typed lines.
- ✅ Nesting: ownership by indent, guide lines, folding.
- 💡 Editing your most recent typed note happens back in the note box (where you type), not in place in the list.
  **Why:** you're usually still writing that thought; going back to the box feels like one continuous note, not editing a separate item.

## 2. UX (how it behaves)
- ✅ Bigger ⋮⋮ ⇤ ⇥ arrange buttons on the left edge.
- ✅ Settings regrouped (everyday · Fine-tuning · Old ways · ↺ · find box).
- ✅ The "Where do these notes go?" box works with Enter; "+ New topic…"; the highlighter turns on after choosing.
- ✅ Better type guessing (big or all-caps lines = Header); no Join after headings.
- 💡 Quick note box offers the topic the panel is showing.
- ⚠️💡 Horizontal panel instead of the edge tab (a bottom drawer was rejected earlier).
  **Why:** opening and closing the edge tab doesn't feel smooth.

- 💡 Editing a highlight opens too big (owner screenshots, 2026-11-27). A one-line list point "Mechanically gated channels" becomes a tall card: text box + "List point › Annotation › Context ›" row + Tidy/Explain/Define + Delete/Cancel/Save.
  **Why:** the jump in size breaks reading flow; the note should still look like itself while you edit it (ties to "feel like one note").
  Possible fixes: edit the words in place (same font and position), show the type/annotation/AI/buttons only on demand (a small ⋯ or after a key), and Enter saves / Esc cancels with no buttons visible.

- 💡 New highlight lands outdented (owner screenshot, 2026-11-27). After indented typed lines ("Also play roles in generation electrical signals"), a new highlight ("Liquid gated ion channels, also known as ionotropic receptors…") was saved at indent 0, left of them.
  **Cause:** only *list points* take the indent of the note above (`insertHighlight`, bg_storage.js); every other type starts at 0.
  **Why:** you're still writing inside that nest; jumping out breaks it and you have to indent by hand.
  Possible fixes: every new note takes the last note's indent (Alt+← to leave), or a setting for that. Or it's a habit change: press Alt+→ / ⇥ after saving.

## 2b. Unclear to the owner (explain, or redesign)
- 📘 **Owner's own workaround (2026-11-27):** **Ctrl+B** to bold the item name at the start of each explanation ("**Voltage-gated channels** open based on…") makes the "list first, then explain" pattern readable. **Just a usage observation, not an official method**: don't teach it or build on it unless the owner decides later. Possibly a hint for the real-notes design (an explanation that starts with a bold term = a sub-head of that list item).
- 💡 Spell bar under the note box ("~~Vltage~~ **Voltage** Add to dictionary"): the crossed-out word is your typo, click **Voltage** to replace it, **Add to dictionary** keeps your spelling. **Why:** the owner couldn't tell what the bar was or what to click → label it (e.g. "Did you mean: Voltage?"), add a key (Tab/→ accepts), and put it in the tour.

- 💡 **Two kinds of bullet for the same list** (owner screenshot, 2026-11-27): under "Passive Transport:", "Simple Diffusion:" (a typed "- " point: accent-coloured dot, folded with "13 more") and "Facilitated diffusion" (a highlighted List point: grey dot, slightly different position) look like different lists.
  **Why:** one list should look like one list whether a point was typed or highlighted; mixed bullets break the "one note" feel.
  Likely cause: typed-note lists (`.tn-list li` / `.rich-box li::marker`, accent) and highlight list points (`.note--list-point::before`, grey `--sec`) are styled separately.

- 💡 **Save list points without their head** (owner, 2026-11-27): when a selection is split into list points, the first line is always taken as the List head. Sometimes the owner wants only the points (the head already saved, or not wanted).
  **Why:** forced head = an extra note to delete, or a wrong head.
  Ideas: a choice in the pop-up ("with head / points only"), or remember the last choice.
- 💡 **Is there only one way to do things?** Investigate where note-taking has a single path (e.g. lists, explanations, headings) and whether common tasks need a second way (keyboard vs mouse, highlight vs typed).
  **Why:** the owner keeps finding workarounds (Ctrl+B, indenting for spacing): a sign some tasks have only one, awkward path.
- 📘 **Indenting fixes the spacing** (owner, 2026-11-27): indented notes read closer together and grouped, confirming the earlier spacing idea (same indent = closer than an indent change). Observation, nothing to build now.

- 🐞 **Some list points won't delete** (owner, 2026-11-27): deleting failed for some list points; after refreshing the page it worked (or they were gone). Not reproduced yet.
  **Why:** a delete that doesn't show is scary ("is my note still there?").
  Suspects: the Study list not redrawing after DELETE_HIGHLIGHT, a stale note id after a split into list points, or the panel iframe missing the storage change. Need: which view (Study / All notes / panel), how deleted (× / Delete twice / editor).
- 💡 **Indenting a head moves only the head** (answer to owner, 2026-11-27): ⇥ / Alt+→ changes just that one note; its list points stay where they were (each note keeps its own indent; `indentBy` in study-page.js). Idea: indenting a head (or any owner) takes everything under it along, with Undo.
  **Why:** a list is one thing; moving the head alone breaks it apart.

- 📘 **Owner indents with Alt+← / Alt+→** (2026-11-27), partly because the mouse buttons (⋮⋮ ⇤ ⇥ on the left edge) felt troublesome.
- 💡 **Rethink the edge arrange buttons**: (a) a horizontal bar instead of the vertical stack, or (b) drop the ⇤ ⇥ buttons and just drag: drag left/right to indent, up/down to move (keyboard Alt+arrows stays).
  **Why:** the mouse path is awkward even after making the buttons bigger; the owner already avoids it. ⚠️ Removing buttons = keep them behind a setting (togglable rule). Show image options first.

- 💡 **Indent a whole list at once** (owner, 2nd time, 2026-11-27): had to indent list points one by one again. Ideas: indenting a head takes its points along; or select several notes (Shift+↑↓) and Alt+→ them together.
  **Why:** repeated manual work on every list.
- 📘 **Keyboard focus to the panel** (owner, 2026-11-27): wants to move focus to the side panel, not just show/hide it. Already exists: **Ctrl+.** jumps into the panel's note box and back to the page; from the note box **Ctrl+↑** goes to the last note, then ↑↓ / Alt+arrows. Maybe not discoverable enough. 💡 Idea: a key that focuses the notes list directly.
- 📘 **PDF keyboard cursor off**: owner highlights with the mouse, so would turn the PDF cursor off. Already a switch: Settings › Fine-tuning › "Keyboard cursor in PDFs" (`lnDocCaret`).

- 📘 **New topic when opening a new doc** (owner, 2026-11-27): had to create the topic first, then save the doc to it. Already built last night (owner hadn't reloaded yet): "+ New topic…" at the bottom of the topic list in "Where do these notes go?". Check it works for them.
- 💡 **Open a document from a course in All notes** (owner, 2026-11-27): the course page lists its documents; add "+ Open a document…" there, and the new doc saves to that course straight away (only the topic asked).
  **Why:** fewer steps; you're already in the course.

- 📘 **A list point indented itself** (owner, 2026-11-27, didn't know why): by design, a List point saved right after an indented note takes that note's indent (`insertHighlight`, bg_storage.js). Other types don't, which is why earlier notes landed outdented. Worth making the rule visible/consistent (see "New highlight lands outdented").

## 3. UI (how it looks)
- 💡 **Settings look lacklustre** (owner, 2026-11-27): works, but plain. Redesign the look (sections, icons, spacing, cards); show image options first.
  **Why:** settings is where the owner manages a lot now; it should feel as finished as the rest.
- ✅ How-to tour with screenshots, opens on reload.
- ✅ PDF definitions show only their own paragraph.
- 💡 Dim white pictures (snips) in dark mode.
- 💡 Underline spelling mistakes in the Study view.

## 4. Reader improvements
- ✅ PDF snap-to-word, Home/End, full screen, floating panel.
- 💡 "Fit to width" leaves room for the floating panel.
- 💡 BUG (owner, 2026-11-27): PDF keyboard cursor: ↓ jumps to the end of the word; ← / → at the edge of a word needs two presses before the cursor visibly moves.
- 💡 "Join to last figure": stack a table snip that runs over a page break.

- 💡 **Catch text across PDF pages** (owner reminder, 2026-11-27): one selection that runs from the bottom of one page onto the next. Today: Join (J) glues the second part onto the last highlight. Idea: drag across the page gap in one go, or a "continue on next page" mode.
  **Why:** sentences and lists often break over a page.
- 🐞 **Clicking away after a highlight counts as a new highlight** (owner, 2026-11-27): after saving, a click elsewhere on the PDF is often taken as starting another selection (pop-up / tiny selection).
  **Why:** stray pop-ups break flow. Suspects: snap-to-word (`lnDocSnap`, 28px) or the keyboard cursor turning a click into a 1-word selection. Check with both switched off.

## 5. All notes / editing
- ✅ Typed notes editable there; ↑ ↓ ⇤ ⇥ and Alt + arrows.

## 6. V3: online (anything that needs the internet)
- ✅ Sync server + phone site (PWA) on Render.
- ✅ AI help (Groq etc.).
- 💡 Login: no login = no backup; logged in = automatic desktop ↔ phone sync (no "Sync now").
  **Why:** the owner shouldn't have to press Sync by hand; an account also makes backup and sharing possible.
- 💡 Share notes from one account to another (after login).
- 💡 Ask the AI about the open PDF (document vs selection).

- 💡 **Usage reports that show habits, not just errors** (owner, 2026-11-27): with "Send usage & error reports" on, also record which features/shortcuts are used and never used, and signs of struggle (repeated undo, delete-and-redo, editing right after saving, re-indenting by hand, dismissing the pop-up, opening How to use). Never note text or keys.
  **Why:** alpha testers won't send live bug reports like the owner does; the data should show what's unused, unknown or stressful so it can be fixed or taught.

- 💡 **Textbooks** (future, owner 2026-11-27): a textbook can serve several courses. Ideas: jump to the chapter/pages for the topic you're studying; search the textbook for context related to a note. Could be offline (search the PDF's text) or online (AI).
  **Why:** real textbooks are big and shared across courses; finding the relevant part is slow.
- 💡 **"Online" status bar** (future): once real online features exist (login, sync, AI), a small indicator says whether the extension is connected.
  **Why:** know at a glance if sync / AI will work.
- 💡 **AI background for a new course / document** (future): when a course or doc is opened, the AI fetches related info about the topic and doc, including things the lecture doesn't mention.
  **Why:** fill gaps in lecture notes.
- 💡 **Some AI offline** (future): a small local model (or simpler non-AI helpers) for tidy / define when there's no connection.
  **Why:** studying often happens without internet.

## 7. Learning / onboarding
- ✅ How to use page, ? key, tour.
