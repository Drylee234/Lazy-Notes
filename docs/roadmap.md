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
- 📘 **Owner's own workaround (2026-11-27):** **Ctrl+B** to bold the item name at the start of each explanation ("**Voltage-gated channels** open based on…") makes the "list first, then explain" pattern readable. Teach it in the tour / How to use. It's also a hint for the real-notes design (an explanation that starts with a bold term = a sub-head of that list item).
- 💡 Spell bar under the note box ("~~Vltage~~ **Voltage** Add to dictionary"): the crossed-out word is your typo, click **Voltage** to replace it, **Add to dictionary** keeps your spelling. **Why:** the owner couldn't tell what the bar was or what to click → label it (e.g. "Did you mean: Voltage?"), add a key (Tab/→ accepts), and put it in the tour.

## 3. UI (how it looks)
- ✅ How-to tour with screenshots, opens on reload.
- ✅ PDF definitions show only their own paragraph.
- 💡 Dim white pictures (snips) in dark mode.
- 💡 Underline spelling mistakes in the Study view.

## 4. Reader improvements
- ✅ PDF snap-to-word, Home/End, full screen, floating panel.
- 💡 "Fit to width" leaves room for the floating panel.
- 💡 BUG (owner, 2026-11-27): PDF keyboard cursor: ↓ jumps to the end of the word; ← / → at the edge of a word needs two presses before the cursor visibly moves.
- 💡 "Join to last figure": stack a table snip that runs over a page break.

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

## 7. Learning / onboarding
- ✅ How to use page, ? key, tour.
