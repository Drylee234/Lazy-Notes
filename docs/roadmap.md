# Roadmap — changes and ideas by group

The single list of what's done and what's waiting, by group, so it's easy to see what changed and decide what comes next.
**Add every new idea or change here** (newest at the bottom of its group). Details live in `usage-notes.md` / `handoff-lazy-notes.md`.
✅ done · 💡 idea, not built · ⚠️ check with owner first

## 1. Notes feel like one note (owner's idea, 2026-11-27)
Today a topic reads like a pile of highlights. The parts that already feel like real notes are heading → sub topic → list head with things nested under them.
- 💡 Make the whole topic read as one written note: fewer visible seams between separate highlights (marker, gaps, hover boxes), with headings and nesting carrying the structure.
- 💡 Same-indent notes closer together than the gap where an indent starts or ends.
- ✅ Tight spacing: separate notes 2px apart, like typed lines.
- ✅ Nesting: ownership by indent, guide lines, folding.
- 💡 Editing your most recent typed note happens back in the note box (where you type), not in place in the list.

## 2. UX (how it behaves)
- ✅ Bigger ⋮⋮ ⇤ ⇥ arrange buttons on the left edge.
- ✅ Settings regrouped (everyday · Fine-tuning · Old ways · ↺ · find box).
- ✅ The "Where do these notes go?" box works with Enter; "+ New topic…"; the highlighter turns on after choosing.
- ✅ Better type guessing (big or all-caps lines = Header); no Join after headings.
- 💡 Quick note box offers the topic the panel is showing.
- ⚠️💡 Horizontal panel instead of the edge tab (a bottom drawer was rejected earlier).

## 2b. Unclear to the owner (explain, or redesign)
- 💡 Spell bar under the note box ("~~Vltage~~ **Voltage** Add to dictionary"): the crossed-out word is your typo, click **Voltage** to replace it, **Add to dictionary** keeps your spelling. Owner didn't know how to use it → label it (e.g. "Did you mean: Voltage?"), add a key (Tab/→ accepts), and put it in the tour.

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
- 💡 Share notes from one account to another (after login).
- 💡 Ask the AI about the open PDF (document vs selection).

## 7. Learning / onboarding
- ✅ How to use page, ? key, tour.
