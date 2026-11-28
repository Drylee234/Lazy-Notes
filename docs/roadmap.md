# Roadmap — changes and ideas by group

The single list of what's done and what's waiting, by group, so it's easy to see what changed and decide what comes next.
**Add every new idea or change here** (newest at the bottom of its group). Each idea carries **Why** (the problem the owner hit), so a different solution can be chosen later. Details live in `usage-notes.md` / `handoff-lazy-notes.md`.
✅ done · 💡 idea, not built · ⚠️ check with owner first

**Not every report needs code.** Some are fixed by using the extension differently or understanding it (an existing shortcut, a setting). Check that first, and say so: mark those 📘 "usage/understanding" with the explanation.

## 0. Designs thought up, waiting to be shown (2026-11-27)
Owner: "think it up, don't build yet; tell and show me before doing it." Each needs labelled images (Image 1 / Image 2) before any code.

**A. Notes read as one note (roadmap 1 + "what makes notes feel real"; owner: also about every note showing its own source line).**
- Sources move to the end: no source/date line under each highlight; a **Sources** block at the bottom of the topic lists each document once with the pages used ("PIO 201 Lecture two · pp. 3–7"). Hovering a note shows a tiny page tag in the left margin (where the ⋮⋮ tools already live) and clicking it opens the page.
- A **Reading look** switch (Study and All notes): highlight marker off or very faint, so highlights and typed lines look the same; structure carries the meaning: headers/sub topics as headings, list heads as lead-ins, points as one list, nesting by indent with guide lines only on hover.
- Spacing follows structure (same block = tight, new block after a heading/list = small gap); the 2px rule stays inside blocks.
- Nothing about saving changes; it's only how a topic is drawn. Old look stays a switch.

**B. "List first, then explain each item" (roadmap 1).** ✅ B2 built 2026-11-27 (owner picked it): the save pop-up shows **Explains: [point ▾]** when the topic's latest block is a list (for Plain / Definition / Important / Summary / Formula); the point is guessed from the words that tell the points apart (no telling word = "—"); Enter saves it one level in, straight under that point, after anything already explaining it. Also fixed: a Plain note indented under a point was taken for the next list's head (bold + ":" and it "owned" the next point). Owner's workaround: Ctrl+B on the item name at the start of each explanation. Two ways, owner to pick:
- *Flow (no code):* save the list (head + points) → highlight each explanation → it lands at the points' indent (new rule) → Alt+→ nests it under the point above; with the point it explains just above it, that's correct. Write it in How to use as "List → explain".
- *Feature:* the save pop-up offers "Explains: [point ▾]" when the topic's last block is a list; picking a point nests the explanation under that point (any order), and the point shows a small ▸ to fold its explanation.
- "Edge line being stripped": `trimBlankLines` removes empty lines at the start/end of every note, which kills the owner's spacing workaround (an empty last line to separate blocks). Option: keep one empty line at a note's edge (as a gap), behind a switch.

**C. Numbered lists that follow indents (roadmap 2 #12).** A list head gets "Numbered" (in ⋯ when editing it, or a key in the save pop-up); its points draw as 1. 2. 3., nested points as a. b. c., then i. ii. (CSS counters per indent level, nothing stored per point). Typed "1." lists already number; make their nested levels follow the same a./i. pattern so both look alike.

**D. Bold inside highlights (roadmap 2 #13).** Highlights store the same light marks typed notes use (`**bold**`, `==mark==`, `*italic*`); Ctrl+B / Ctrl+I work in the save pop-up's text box and in the in-place editor (wrap the selection). Drawn with the typed-note formatter everywhere (Study, All notes, phone, export). Search and AI read the plain words (marks stripped). Risk: old exports/backups show the marks as plain text; the phone site already understands them.

**E. Switching Home / Study without scrolling up (owner, roadmap 2).** Options for images: (1) the tab row stays pinned at the top while the list scrolls; (2) Alt+1 / Alt+2 / Alt+3 = Home / Study / AI from anywhere in the panel; (3) a small Home · Study · AI switch in the footer, next to the note box, where the eyes already are; (4) the reader panel's title-bar switcher used in the side panel too. Likely answer: (1) + (2).

**F. Settings redesign (roadmap 3).** A left column of sections (Everyday · Reading · Notes · AI · Sync & account · Problems · Old ways) with the search box on top; each section a card of plain rows (name, one-line what it does, control on the right); changed rows show ↺; "Old ways" stays separate. In the narrow side panel the sections become a dropdown at the top. Show 2 looks.

**G. A document used by two courses (bug report: "docs keep reading to different courses").** Today a document remembers one course/topic (`lnDocs[doc].course/topic`), and opening it while another course is picked re-files it. Design: a document keeps a list of places (course › topic, last used); opening one with two places asks "Which course this time?" (last used picked, Enter = go); document lists show small course chips ("BME213 · GET 201") instead of the doc twice; a course's page lists it once with its topics in that course.

**H. The quick note box and the panel's topic (roadmap 2 #5; owner: "idg").** To explain with an image. Note: picking a topic in Study already makes it the topic highlights and quick notes save to (`SET_ACTIVE_TOPIC`), so this may be a non-issue (📘) unless the panel is showing a topic picked elsewhere.

**I. UX items: is there already a way? (owner: for every UX task, first check if a workaround exists but isn't smooth or isn't known).**
| Item | Existing way | Smooth? | Verdict |
|---|---|---|---|
| Key to jump to the notes list (#10) | Ctrl+. → note box, then Ctrl+↑ → last note (↑/↓ walk). Since 2026-11-27, Ctrl+↑ in an empty box first opens your last *typed* note for editing; Ctrl+↑ again goes to the list | Two steps; the second Ctrl+↑ isn't obvious | 📘 teach "Ctrl+↑ twice"; or one key (Ctrl+Shift+↑) straight to the list |
| Rethink the edge buttons (#9) | Alt+←/→ / Alt+↑/↓ (owner uses them), Shift+↑/↓ picks several | Smooth by keyboard; mouse still fiddly | Keep; mouse drag-to-indent only if the owner wants the mouse path |
| Indent a whole list | Indent the head (points follow), or pick with Shift | Built 2026-11-27 | ✅ |
| Quick note topic (#5) | Pick the topic in Study (it becomes active) | Probably fine | 📘 explain |
| Saved toast (#11) | — | Built | ✅ |
| Edit card (#7) | — | Built | ✅ |
| Autocorrect list (#14) | → took the single hint | Built: ↑ into the list | ✅ |
| Spell bar unclear | — | Relabelled | ✅ |
| Save list points without their head | Delete the head after saving (× twice) | Clunky | 💡 still wanted |
| Join pages | Join (J) | Now also one drag across pages | ✅ |

**J. Find where there are already two ways (roadmap 2 #8) → moved to the end of the list.** Needs a simulated note-taking session (save, list, explain, indent, edit) recording every path used, then a table of tasks that have two built ways and which one is smoother. Do last.

## 1. Notes feel like one note (owner's idea, 2026-11-27)
Today a topic reads like a pile of highlights. The parts that already feel like real notes are heading → sub topic → list head with things nested under them.
- 💡 Make the whole topic read as one written note: fewer visible seams between separate highlights (marker, gaps, hover boxes), with headings and nesting carrying the structure.
- 📘 ~~Same-indent notes closer together than the gap where an indent starts or ends.~~ Owner re-checked (2026-11-27): false alarm.
  **Why:** the spacing itself should show what belongs together; equal gaps everywhere hide the structure.
- 💡 **"List first, then explain each item"** (owner screenshot, 2026-11-27): a head ("Protein channels are gated… through various methods:") → list points (Voltage / Liquid / Mechanically gated channels) → then a paragraph explaining each one ("Voltage-gated channels open based on…", "Liquid gated ion channels, also known as ionotropic receptors…").
  **Why:** this is how real lecture notes are written; today the explanations are just lines in a typed note, not tied to their list item, and the structure doesn't show.
  To investigate: link each explanation to its list point (e.g. the explanation shows under a mini-heading of that item, or the list item becomes a jump link), and a "List → explain" layout.
- ✅ **Done (2026-11-27):** an empty line typed in a note now shows as one empty line (`tn-blank`, utils.js).
  Was: 💡 **Can't separate with blank lines** (same screenshot): extra empty lines in a typed note are squashed, so the owner can't space blocks apart.
  **Why:** a blank line is the natural way to separate thoughts. Check `trimBlankLines` / typed-note rendering; keep one blank line between blocks as a visible gap.
- 💡 **Investigate what makes notes feel "real"**: structure (head → items → explanations), spacing that follows meaning, fewer per-highlight seams, no edit-box jump. Show options as labelled images before building.
- ✅ Tight spacing: separate notes 2px apart, like typed lines.
- ✅ Nesting: ownership by indent, guide lines, folding.
- ✅ **Done (2026-11-27):** Ctrl+↑ in an empty note box brings your last typed note back into the box ("Editing your last note · Enter saves · Esc stops"; the note dims in the list). Old way: `lnEditLastInList`.
  Was: 💡 Editing your most recent typed note happens back in the note box (where you type), not in place in the list.
  **Why:** you're usually still writing that thought; going back to the box feels like one continuous note, not editing a separate item.

## 2. UX (how it behaves)
- ✅ Bigger ⋮⋮ ⇤ ⇥ arrange buttons on the left edge.
- ✅ Settings regrouped (everyday · Fine-tuning · Old ways · ↺ · find box).
- ✅ The "Where do these notes go?" box works with Enter; "+ New topic…"; the highlighter turns on after choosing.
- ✅ Better type guessing (big or all-caps lines = Header); no Join after headings.
- ✅ **Works in Microsoft Edge (2026-11-28).** **Why:** owner asked "make it work for edge". The extension already ran there (Edge is built on Chrome); now its words follow the browser ("Edge blocked this local file… edge://extensions", "Edge's own side panel", toolbar ✕ tip), Edge's new tab page (edge://newtab / ntp.msn.com) opens the full panel like Chrome's, and the download site shows Edge steps (edge://extensions, Developer mode on the left, eye icon to show it in the toolbar). Tested in Chromium with an Edge user-agent, not in real Edge.
- 💡 Quick note box offers the topic the panel is showing. **Meaning:** the pop-up note box (Ctrl+Shift+. in a reader) saves to the *active* topic (the one highlights go to). If the floating panel's Study view is showing a different topic, a quick note lands somewhere other than where you're looking. Idea: the box offers the panel's topic (or shows where it'll save). (Explained to owner 2026-11-27.)
- ✅ **Built as an extra mode (2026-11-27):** "Bottom": a wide Notes tab at the foot of the reader; hover/click slides a full-width panel up over the page; drag its top edge for height (double-click resets); clicking the page puts it away. Settings › Notes panel in the readers › Bottom, or the ▁ Bottom button in the panel bar. Opt-in only (a bottom drawer was rejected once before), the edge tab is unchanged.
  Was: ⚠️💡 Horizontal panel instead of the edge tab (a bottom drawer was rejected earlier).
  **Why:** opening and closing the edge tab doesn't feel smooth.

- ✅ **Done (2026-11-27):** editing a highlight now happens in place: the note keeps its spot, bullet and indent; only a thin box around the words, "Enter saves · Esc cancels" and ⋯ (Alt+M) for type / annotation / context / AI / delete. Study and All notes. Old big card: Settings › Old ways (`lnEditCard`).
  Was: 💡 Editing a highlight opens too big (owner screenshots, 2026-11-27). A one-line list point "Mechanically gated channels" becomes a tall card: text box + "List point › Annotation › Context ›" row + Tidy/Explain/Define + Delete/Cancel/Save.
  **Why:** the jump in size breaks reading flow; the note should still look like itself while you edit it (ties to "feel like one note").
  Possible fixes: edit the words in place (same font and position), show the type/annotation/AI/buttons only on demand (a small ⋯ or after a key), and Enter saves / Esc cancels with no buttons visible.

- ✅ **Done (2026-11-27):** every new note (highlight or typed) takes the indent of the last note; Header / Sub topic start at the left. Old way behind Settings › Old ways (`lnIndentFollowLists`).
  Was: 💡 New highlight lands outdented (owner screenshot, 2026-11-27). After indented typed lines ("Also play roles in generation electrical signals"), a new highlight ("Liquid gated ion channels, also known as ionotropic receptors…") was saved at indent 0, left of them.
  **Cause:** only *list points* take the indent of the note above (`insertHighlight`, bg_storage.js); every other type starts at 0.
  **Why:** you're still writing inside that nest; jumping out breaks it and you have to indent by hand.
  Possible fixes: every new note takes the last note's indent (Alt+← to leave), or a setting for that. Or it's a habit change: press Alt+→ / ⇥ after saving.

- 💡 **Another way to switch Home / Study** (owner, 2026-11-27): the Home · Study · AI tabs sit at the top, so after scrolling down a long topic you have to scroll back up to switch ("i … will find it hard to be scrolling up").
  **Why:** switching views shouldn't depend on where you've scrolled to.
  To investigate (show images first): tabs that stay pinned while the list scrolls, a switch in the bottom bar next to the note box, a key (e.g. Alt+1/2/3), or the title-bar view switcher the reader panel already has.

## 2b. Unclear to the owner (explain, or redesign)
- 📘 **Owner's own workaround (2026-11-27):** **Ctrl+B** to bold the item name at the start of each explanation ("**Voltage-gated channels** open based on…") makes the "list first, then explain" pattern readable. **Just a usage observation, not an official method**: don't teach it or build on it unless the owner decides later. Possibly a hint for the real-notes design (an explanation that starts with a bold term = a sub-head of that list item).
- ✅ **Done (2026-11-27):** the bar now reads “~~word~~ Did you mean [fix] · Keep my spelling” (no key added: Tab is already Save as).
  Was: 💡 Spell bar under the note box ("~~Vltage~~ **Voltage** Add to dictionary"): the crossed-out word is your typo, click **Voltage** to replace it, **Add to dictionary** keeps your spelling. **Why:** the owner couldn't tell what the bar was or what to click → label it (e.g. "Did you mean: Voltage?"), add a key (Tab/→ accepts), and put it in the tour.

- ✅ **Done (2026-11-27):** typed "- " points use the same grey dot as highlighted List points (hollow / square when nested, same as highlights).
  Was: 💡 **Two kinds of bullet for the same list** (owner screenshot, 2026-11-27): under "Passive Transport:", "Simple Diffusion:" (a typed "- " point: accent-coloured dot, folded with "13 more") and "Facilitated diffusion" (a highlighted List point: grey dot, slightly different position) look like different lists.
  **Why:** one list should look like one list whether a point was typed or highlighted; mixed bullets break the "one note" feel.
  Likely cause: typed-note lists (`.tn-list li` / `.rich-box li::marker`, accent) and highlight list points (`.note--list-point::before`, grey `--sec`) are styled separately.

- 💡 **Save list points without their head** (owner, 2026-11-27): when a selection is split into list points, the first line is always taken as the List head. Sometimes the owner wants only the points (the head already saved, or not wanted).
  **Why:** forced head = an extra note to delete, or a wrong head.
  Ideas: a choice in the pop-up ("with head / points only"), or remember the last choice.
- 💡 **Is there only one way to do things?** Investigate where note-taking has a single path (e.g. lists, explanations, headings) and whether common tasks need a second way (keyboard vs mouse, highlight vs typed).
  **Why:** the owner keeps finding workarounds (Ctrl+B, indenting for spacing): a sign some tasks have only one, awkward path.
- 📘 **Indenting fixes the spacing** (owner, 2026-11-27): indented notes read closer together and grouped, confirming the earlier spacing idea (same indent = closer than an indent change). Observation, nothing to build now.

- ✅ **Fixed (2026-11-27):** cause found: note changes weren't queued, so two at once (two quick deletes, a delete while a list was still saving, an edit + an indent) each wrote their own copy and the second brought the deleted note back. Now every change waits its turn (`oneAtATime`, bg_storage.js); highlight edits go through the background too (UPDATE_HIGHLIGHT). Tested in Chromium: 3 deletes at once → all 3 gone.
  Original report: 🐞 **Some list points won't delete** (owner, 2026-11-27): deleting failed for some list points; after refreshing the page it worked (or they were gone). Not reproduced yet.
  **Why:** a delete that doesn't show is scary ("is my note still there?").
  Suspects: the Study list not redrawing after DELETE_HIGHLIGHT, a stale note id after a split into list points, or the panel iframe missing the storage change. Need: which view (Study / All notes / panel), how deleted (× / Delete twice / editor).
- ✅ **Done (2026-11-27):** indenting takes the notes under it along (list head → its points; a note → what's nested under it; Header/Sub topic → only deeper notes right after). Alt+Shift+←/→ = just that note; old way: `lnIndentAlone`. Study + All notes.
  Was: 💡 **Indenting a head moves only the head** (answer to owner, 2026-11-27): ⇥ / Alt+→ changes just that one note; its list points stay where they were (each note keeps its own indent; `indentBy` in study-page.js). Idea: indenting a head (or any owner) takes everything under it along, with Undo.
  **Why:** a list is one thing; moving the head alone breaks it apart.

- 📘 **Owner indents with Alt+← / Alt+→** (2026-11-27), partly because the mouse buttons (⋮⋮ ⇤ ⇥ on the left edge) felt troublesome.
- 💡 **Rethink the edge arrange buttons**: (a) a horizontal bar instead of the vertical stack, or (b) drop the ⇤ ⇥ buttons and just drag: drag left/right to indent, up/down to move (keyboard Alt+arrows stays).
  **Why:** the mouse path is awkward even after making the buttons bigger; the owner already avoids it. ⚠️ Removing buttons = keep them behind a setting (togglable rule). Show image options first.

- ✅ **Done (2026-11-27):** indent the head (takes its points), or pick several notes with Shift+↑/↓ or Shift+click, then Alt+←/→ (Study).
  Was: 💡 **Indent a whole list at once** (owner, 2nd time, 2026-11-27): had to indent list points one by one again. Ideas: indenting a head takes its points along; or select several notes (Shift+↑↓) and Alt+→ them together.
  **Why:** repeated manual work on every list.
- 📘 **Keyboard focus to the panel** (owner, 2026-11-27): wants to move focus to the side panel, not just show/hide it. Already exists: **Ctrl+.** jumps into the panel's note box and back to the page; from the note box **Ctrl+↑** goes to the last note, then ↑↓ / Alt+arrows. Maybe not discoverable enough. 💡 Idea: a key that focuses the notes list directly.
- 📘 **PDF keyboard cursor off**: owner highlights with the mouse, so would turn the PDF cursor off. Already a switch: Settings › Fine-tuning › "Keyboard cursor in PDFs" (`lnDocCaret`).

- 📘 **New topic when opening a new doc** (owner, 2026-11-27): had to create the topic first, then save the doc to it. Already built last night (owner hadn't reloaded yet): "+ New topic…" at the bottom of the topic list in "Where do these notes go?". Check it works for them.
- ✅ **Done (2026-11-27):** All notes › a course › "+ Open a document…" beside "Documents in this course": the file opens in its reader with that course already picked; "Where do these notes go?" only asks the topic. Shared picker: `shared/open-doc.js` (side panel uses it too).
  Was: 💡 **Open a document from a course in All notes** (owner, 2026-11-27): the course page lists its documents; add "+ Open a document…" there, and the new doc saves to that course straight away (only the topic asked).
  **Why:** fewer steps; you're already in the course.

- 📘 **A list point indented itself** (owner, 2026-11-27, didn't know why): by design, a List point saved right after an indented note takes that note's indent (`insertHighlight`, bg_storage.js). Other types don't, which is why earlier notes landed outdented. Worth making the rule visible/consistent (see "New highlight lands outdented").

- ✅ **Done (2026-11-27):** the toast is now a small "Saved · Undo" pill by default; Settings › After saving: Small / Off (Ctrl+Z still undoes ~6s) / Full (old bar) (`lnSaveToast`).
  Was: 💡 **"Saved to Course › Topic · Undo" toast at the bottom may be unnecessary** (owner, 2026-11-27). The note appearing in the panel already confirms it. Idea: smaller / shorter, or off by a switch (keep Undo reachable, e.g. Ctrl+Z).
  **Why:** a big bar after every save is noise.
- 💡 **Numbered list points that follow indents** (1., 2. → a., b. when nested), for highlights too, not only typed "1." lists.
  **Why:** real notes number steps and sub-steps.
- 💡 **Bold (and other formatting) inside highlights**, like typed notes have (Ctrl+B etc.): part of blurring highlights vs typed notes ("one note" goal).
  **Why:** today only typed notes can be formatted, so highlights and typed lines look and behave differently.

- ✅ **Also done (2026-11-28), the settings side the owner meant first:** the Off / Mild / Strong / Toxic slider is gone; Settings › **Autocorrect** is a list of ticks, one per fix (typos, bolder guesses, boldest, sentence capitals, stuck capitals, ALL-CAPS words, apostrophes, held-down letters, joined words, learned fixes, stray punctuation), with "n of 11 on". The old level is turned into ticks once (background.js `lnAcMigrated`).
- ✅ **Done (2026-11-27):** suggestions you pick from with the keyboard, like Windows' text suggestions: up to 3 word endings (or the spelling fixes) show under the box; ↑ from the first line (↓ from the last) steps in, ←/→ choose, Enter/Tab take it, Esc back to typing, any other key keeps typing. Checked: Enter doesn't also save the note, Ctrl+↑ is untouched, ↑ only enters from the first line (multi-line notes still move up normally). The pop-up note box shows its hint in its own footer, so there it's still → only.
  Was: 💡 **Autocorrect as a pick-list, not a slider** (owner, 2026-11-27): instead of Off / Mild / Strong / Toxic, tick the autocorrect features you want (e.g. fix typos, fix capitals, punctuation spacing, finish words from the document…).
  **Why:** a strength slider hides what each level actually does; the owner wants to choose behaviours, not a level.

- ✅ **Hover-open for the web-page panel (2026-11-27):** floating + folded: rest on the bar to open it, move away to fold it back (unless you clicked into it). Same switches and delays as the readers (`lnPanelHover`, `lnPanelHoverMs`, `lnPanelHoverCloseMs`).

- ✅ **Edge tab → icon row (2026-11-27, owner's screenshot of Claude's side-panel buttons):** in Edge tab mode the readers show Home · Study · AI · ✎ icons at the top right, where the panel opens; a click opens the panel on that view, the lit one closes it; the panel slides out just under them. Old slim "Notes" tab: Settings › Old ways (`lnEdgeStyle`).

- ✅ **One bar, not two (2026-11-27, owner):** in Edge tab mode with the icon row, the panel's own bar (? · Float · Dock · Bottom · ⧉ · ✕) moves up into the icon row as small icons (names in tooltips); the panel starts right under it.
- 💡 **Guess Definition for "Term:" then its meaning** (owner 2026-11-27): the owner's main use of Plain is a "Passive Transport:" line with the meaning indented under it ("means the transport without usage of ATP"). That's a definition split in two. Idea: when saving a line right under a Plain line ending in ":" (and it starts like "means / is / are / refers to"), the pop-up lights **Definition (3)** instead of Plain; Study could then show the pair as term + definition. **Why:** the owner uses Plain where Definition fits, so Quiz me / Define / bold terms miss them. Today's ways: highlight both lines and use 2 → "Split into heading + Definition", or press 3 for the meaning line.

## 3. UI (how it looks)
- 💡 **Settings look lacklustre** (owner, 2026-11-27): works, but plain. Redesign the look (sections, icons, spacing, cards); show image options first.
  **Why:** settings is where the owner manages a lot now; it should feel as finished as the rest.
- ✅ How-to tour with screenshots, opens on reload.
- ✅ PDF definitions show only their own paragraph.
- ✅ Dim white pictures (snips) in dark mode (78% brightness; full on hover).
- 💡 Underline spelling mistakes in the Study view. *(Claude's idea from an earlier session, not the owner's.)*

## 4. Reader improvements
- ✅ PDF snap-to-word, Home/End, full screen, floating panel.
- 💡 "Fit to width" leaves room for the floating panel. *(Claude's idea, from its own PDF test run; not the owner's.)*
- ✅ **Fixed (2026-11-27):** ↑/↓ now go to the row really above/below and keep the column (also across pages; on the last line ↓ goes to the line's end); ←/→ skip the invisible stop where two text pieces meet. Cause: each PDF text piece is its own box, so the browser's "line" was one piece. Tested in Chromium.
  Original report: BUG (owner, 2026-11-27): PDF keyboard cursor: ↓ jumps to the end of the word; ← / → at the edge of a word needs two presses before the cursor visibly moves.
- 💡 "Join to last figure": stack a table snip that runs over a page break. *(Claude's idea, not the owner's.)*

- ✅ **Done (2026-11-27):** one drag can run from the bottom of a page onto the next. Starting on a word already worked; starting in the gap beside the words (snap-to-word) stopped at the page edge and didn't scroll. Now the snapped drag follows onto the nearest page and scrolls by itself at the window's top/bottom edge. Join (J) still works for the old way.
  Was: 💡 **Catch text across PDF pages** (owner reminder, 2026-11-27): one selection that runs from the bottom of one page onto the next. Today: Join (J) glues the second part onto the last highlight. Idea: drag across the page gap in one go, or a "continue on next page" mode.
  **Why:** sentences and lists often break over a page.
- ✅ **Fixed (2026-11-27):** with the pop-up open, a click on the still-selected text brought the pop-up back (Chrome clears that selection only after mouseup), and Enter then saved the words again. The click is now read after Chrome finishes (`afterMouseUp`, content.js), on PDFs and web pages. Tested in Chromium. Note: a **double-click** still selects a word and opens the pop-up (normal browser behaviour; a trackpad tap can count as a double-click).
  Original report: 🐞 **Clicking away after a highlight counts as a new highlight** (owner, 2026-11-27): after saving, a click elsewhere on the PDF is often taken as starting another selection (pop-up / tiny selection).
  **Why:** stray pop-ups break flow. Suspects: snap-to-word (`lnDocSnap`, 28px) or the keyboard cursor turning a click into a 1-word selection. Check with both switched off.

## 5. All notes / editing
- ✅ Typed notes editable there; ↑ ↓ ⇤ ⇥ and Alt + arrows.

- 💡 **Choose your home: the main page (side panel Home) or "All notes"** (owner, 2026-11-27): a setting for which one opens first (e.g. from the toolbar button / new tab / reader logo).
  **Why:** "we're sleeping on the All notes page": it's the fullest view (every course, editing, export) but you have to go looking for it.
- 💡 **Give All notes more love**: make it a first-class place to study, not just a browser of notes. Investigate with image options first.

## 6. V3: online (anything that needs the internet)
- ✅ Sync server + phone site (PWA) on Render.
- ✅ AI help (Groq etc.).
- ✅ **Login (2026-11-27):** accounts on your server (username + password, hashed; invite code by default: `SIGNUPS`, `INVITE_CODE`). Settings › Sync › Log in / Create account; the phone site logs in too. Each account has its own notes; the old server key = owner. Sync was already automatic (changes push ~20s later).
  Was: 💡 Login: no login = no backup; logged in = automatic desktop ↔ phone sync (no "Sync now").
  **Why:** the owner shouldn't have to press Sync by hand; an account also makes backup and sharing possible.
- ✅ **Forgot password (2026-11-28):** "Forgot password?" on the phone login and in the extension's Account & sync opens `/reset`: type your email → a one-use link (30 min) by email; the link sets a new password, logs you out everywhere and logs you in. Email is off until the owner sets SMTP on Render (Gmail app password or Brevo); until then the page says to ask whoever gave you Q-notes, and the owner makes a 24-hour link with `POST /api/reset-link` (server key) and sends it on WhatsApp. See server/README.md › Forgot password.
  **Why:** testers who forget their password lose access to sync, phone and AI.
- ✅ **Share (2026-11-27):** Study footer › Share: a read-only link (`/s/<id>`, opens on any phone) and optionally sent to a username's inbox. Settings › Sync › Shared with you / Add shared notes: adds it as a NEW topic (never mixed into yours).
- ✅ **Ask the AI about the open document, the page you're on, or your topic's notes** (2026-11-27): Ask bar at the top of the ✨ AI view (`shared/ai-ask.js`): Document / Page N / My notes, type a question (Enter) or Summarise / Quiz me. Answers stay in the AI list until Keep as note. New job `askDoc` (bg_ai.js). Tested in Chromium against a fake AI server, not yet the real Render one.
  ⚠️ Free Groq allows ~8k tokens a minute: a whole long PDF may hit RATE_LIMIT; then use Page.

- ✅ **Habits in the usage report (2026-11-27)** (`bg_habits.js`): shortcuts used (Alt+←/→, Ctrl+↑, Shift picking), Undo, save pop-up dismissed, How to use, pop-up note box, share; struggle signs worked out by the background: delete-soon / edit-soon / indent-new (within a minute of saving). Report adds `habits` + `neverUsed`. Own switch Settings › Problems › "Also record habits" (`lnHabits`); "See what's recorded" shows it in plain words. Counts only.
  Was: 💡 **Usage reports that show habits, not just errors** (owner, 2026-11-27): with "Send usage & error reports" on, also record which features/shortcuts are used and never used, and signs of struggle (repeated undo, delete-and-redo, editing right after saving, re-indenting by hand, dismissing the pop-up, opening How to use). Never note text or keys.
  **Why:** alpha testers won't send live bug reports like the owner does; the data should show what's unused, unknown or stressful so it can be fixed or taught.

- 💡 **Textbooks** (future, owner 2026-11-27): a textbook can serve several courses. Ideas: jump to the chapter/pages for the topic you're studying; search the textbook for context related to a note. Could be offline (search the PDF's text) or online (AI).
  **Why:** real textbooks are big and shared across courses; finding the relevant part is slow.
- ✅ **Online status (2026-11-27):** a small pill in the panel header: Online (synced) · Syncing / Waiting / Waking server · Sync problem · Offline · Not syncing; tooltip says more, click opens Settings › Sync. Dot only on narrow panels. Switch: `lnOnlineStatus`.
  Was: 💡 **"Online" status bar** (future): once real online features exist (login, sync, AI), a small indicator says whether the extension is connected.
  **Why:** know at a glance if sync / AI will work.
- 💡 **AI background for a new course / document** (future): when a course or doc is opened, the AI fetches related info about the topic and doc, including things the lecture doesn't mention.
  **Why:** fill gaps in lecture notes.
- ✅ **Offline helpers (2026-11-27)** (`bg_ai_offline.js`): with no AI set up, no internet, or the server unreachable, Summarise / Quiz me / Ask / Define / Tidy work from your own text (document + notes), marked **Offline**; Explain says it needs the AI. Switch: Settings › AI help (`lnAiOffline`, on). The ✨ AI tab now shows even without a key.
  Was: 💡 **Some AI offline** (future): a small local model (or simpler non-AI helpers) for tidy / define when there's no connection.
  **Why:** studying often happens without internet.

- ✅ **Done (2026-11-27):** each topic on the phone site has Ask / Summarise / Quiz me at the top (server's AI key, same wording as the extension's jobs; answers aren't saved). Greyed out with the reason when the server has no AI.
  Was: 💡 **AI on the phone / web note viewer** (owner, 2026-11-27): the phone site is read-only; at least let you ask the AI about the notes you're reading (explain, quiz me, define). The server already has `/api/ai` with the key on Render, so the phone can use it without a key on the phone.
  **Why:** on the phone you can't edit, but you still study and get stuck.

- ✅ **AI as a chat with threads (2026-11-27, owner):** the ✨ AI view is now a chat: each conversation a thread (kept in ☰, deletable), messages read Document / Page / My notes plus the thread's last 8 messages; Summarise / Quiz me are messages; Copy / Keep as note on answers. Thread list grouped by **Course / Document / None** (switch in ☰) so the owner can decide the grouping. Old answers list: Settings › Old ways (`lnAiView`). Background `AI_CHAT` (offline helper fallback too).

- ✅ **Download page (2026-11-27):** `https://lazy-notes-c07b.onrender.com/get`: a Download button (`/download/lazy-notes.zip`, zipped from the deployed code, always the latest main; server/docs/tools left out) and 5 install steps. Owner chose public (2026-11-27): GitHub Pages page `site/index.html` + workflow `.github/workflows/pages.yml` (zips the extension with `git archive` on each push to main) → https://drylee234.github.io/Lazy-Notes/. Owner flips the repo to public and sets Settings › Pages › Source: GitHub Actions.
- ✅ **New-user rough edges (2026-11-27):** owner's server filled in on first run; Account & sync shows only Log in / Create account (rest under Advanced); the AI switches on through the account after login (no key); plain wording, no server jargon for account users; sign-ups open unless `INVITE_CODE` is set (never the owner key); "+ New course…" in Where do these notes go?

- ✅ **Phone (2026-11-27, owner):** (1) **Highlight to ask**: select words in your notes → ✨ Ask AI → Explain / Define / your own question about them (topic as context). (2) **Folding**: headers, sub topics and list heads fold (▾ / ▸ n), remembered on the phone. (3) **Documents on the phone**: the extension copies each document you open (logged in, ≤ 25 MB, 400 MB per account; switch `lnDocBackup`) to your account; the phone lists them under the course/topic, downloads once and keeps them (Cache Storage, survives app updates). **Owner (same day): the server only passes documents on** — once a phone keeps one, the server deletes its copy (a "delivered" mark stops the extension resending it); if a phone loses it, tapping it marks it "wanted" and the computer sends it again after its next sync (`bg_docs.js`), from the reader's stored file or the web PDF. ⚠️ With two phones, the second one asks the computer again (the first one's download deleted the server copy).

- ✅ **Renamed to Q-notes (2026-11-28, owner):** every name people see (Chrome's extension list, panel, All notes, How to use, phone site, download pages, messages) says Q-notes; download is `qnotes.zip` (old `lazy-notes.zip` links still work), backups `qnotes-backup-….json`. **Unchanged on purpose:** storage keys (`lazynotes`, `ln…`), IndexedDB names, the sync/backup format (`app: "lazy-notes"`), the repo name (so github.io/Lazy-Notes stays), the Render address. The How-to tour's screenshots still show the old name until `tools/make-tour-shots.js` is rerun.

- ✅ **Mnemonics (2026-11-28, owner):** AI chat › **Mnemonics** (notes, page or document): acronyms / catchy sentences from first letters, vivid one-liners for facts. Offline: first-letter acronyms for the lists ("CSTM: C = Concentration gradient · …").
- ✅ **Topics in a document (2026-11-28, owner; first step of the textbook idea):** AI chat › **Find topics** (with a document open): the separate topics in a PDF/deck that doesn't list them, with page ranges; **Add as topics in <course>** makes the missing ones without switching your topic. Offline: from the headings it can spot (CAPITALS / Title lines, incl. ones glued to the next sentence).
- ✅ **"A newer Q-notes is out" (2026-11-28, owner):** the download page publishes `version.json`; zips carry `build.json`; the extension checks a few times a day and when the panel opens (`bg_update.js`), and the panel shows a notice with **Get it** (✕ hides it until the next version). Copies taken from git compare with when they were loaded. Switch: `lnUpdateAlert`.

- ✅ **Site = landing → download → login → notes** (2026-11-28). **Why:** the server and github.io pages were bare download steps, nothing to show a new student why to use Q-notes. Now one set of pages in `site/` (served by Render and published by Pages): landing with real screenshots, reasons and FAQ (`/`), download (`/get`), login (`/login`) and the notes (`/app`). Installed phone apps and old `/#/course/…` links go straight to `/app`.
- ✅ **Sync box only when you must act** (2026-11-28). **Why:** owner found the red sync box wordy and alarming for what's usually just being offline. See usage-notes.

- ✅ **Testers never see server workings** (2026-11-28). **Why:** "This server has no AI key: add AI_KEY in Render…" showed on a tester's phone. Plain words for testers; details only for the server key.
- ✅ **Reload Q-notes from the update notice** (2026-11-28). **Why:** updating meant a trip to chrome://extensions. Still needs the files replaced by hand (Chrome rule for unpacked extensions); the real fix is the Chrome Web Store, which updates by itself. 💡 Publish on the Chrome Web Store.
- 💡 **The same "less vibe-coded" pass on the extension's own panels** (2026-11-28). **Why:** owner found boxed icons and template-looking UI; the site got the pass first. Candidates: chips and pills, boxed buttons, emoji in labels, too many borders.

- 💡 **Edge users** (owner, 2026-11-28). **Why:** some classmates use Edge. Edge runs the same extension (Load unpacked works there too); needs a test of the side panel and the PDF prompt in Edge. Best route later: publish once on the Chrome Web Store ($5), which Edge can install from; Edge Add-ons is free but slower to review. Store IDs differ from the unpacked one, so notes need moving (sync/export) when switching.
- 💡 **PDF editing** (owner, 2026-11-28). **Why:** asked how it would fit. Chrome and Edge's own viewers now draw/highlight/save; what Q-notes adds is notes organised by course. Fits: drawing/typed comments kept as notes on the page, plus "Download an annotated copy". Avoid: saving into the original file, form filling, a full editor.

## 7. Learning / onboarding
- ✅ How to use page, ? key, tour.
- ✅ **Test bench** (2026-11-27): `node tools/make-test-bench.js <dir>` builds the real extension pages + a stand-in for Chrome's APIs (`tools/test-bench/`) as one web page: lecture page with the highlighter on the left, side panel on the right, All notes, pretend AI. For trying changes without reloading the extension. No PDF/slides/Word readers.

## 8. From the owner's ChatGPT review (2026-11-28), checked against the code by Claude
Not built; ideas with their Why. ✔ = ChatGPT was right, ✘ = wrong about the code.
- 💡 **Material-only highlights** (owner's own idea, ChatGPT agreed): a highlight that stays on the PDF/slides/Word page but doesn't enter the notes. **Why:** notes are rewritten in the student's own words, so not every marked line belongs in the notes, but it's still worth marking in the material. Today every saved highlight is a note and the readers paint them back (pdfreader "Show saved highlights", CSS highlights in pptx/docx). Claude: no 3-way "material / notes / both" question on every capture (an extra decision each time, against Enter-to-save); instead one key or chip in the save pop-up ("on page only"), default = today's (both). Web pages: owner said no coloured highlights on web pages (2026-11-28), so readers only.
- 💡 **Phone "Share to Q-notes"** (Android share target on the phone site). **Why:** extensions don't run in phone Chrome; competitors capture on phones through share menus. Text from any app → a topic's notes.
- 💡 **Anki / CSV export** of definitions (term → meaning). **Why:** medical/physiology students revise with Anki; cheap; fits flashcards (incoming).
- 💡 **Citation line** (title, site, date, page, URL → APA/MLA) for research later. **Why:** students also write assignments; the source data is already saved with each note.
- 📘 **Cross-browser order:** one Chrome Web Store listing first (Edge, Brave, Opera install from it too) → Firefox port (needs sidebar_action instead of sidePanel, background scripts instead of a service worker) → Safari last (needs a Mac, Xcode, $99/yr Apple developer). **Why:** the audience is mostly Chrome on Windows; store listing is the biggest win for the least work.
- ✘ ChatGPT said there's no "anyone with the link" sharing: there is (/s/<id>, read-only, from the Share button). Keep it: links in class WhatsApp groups are the cheapest way Q-notes spreads. "View and comment" would need comments, which don't exist.
- ✘ "Add global search": exists (All notes › Search all notes). "Show Saving to … in the reader": the owner had it merged into the one notes button on purpose (2026-11-28).
- ✘ It cited "bottom" panel mode as a feature; the owner rejected a bottom bar. Still in the code as an option (embedded-panel.js) — fine as long as it's off by default.
- 📘 Rejected for now (agreed with ChatGPT): video/YouTube capture, public social discovery, RSS/read-later, fixed colour = meaning (note type carries the meaning).
