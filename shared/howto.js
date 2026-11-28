// QNotes — "How to use": every shortcut in one place.
// Used by howto.html (a page), the Notes panel's ? button in the readers
// (an overlay) and the side panel's footer link. Edit the list here only.
(() => {
  const mac = /Mac/.test(navigator.platform);
  const C = mac ? "⌘" : "Ctrl";
  const SECTIONS = [
    { title: "Writing a note while you read (PDF · slides · Word)", rows: [
      [`${C} + .`, "Floating note typer: jump into the Notes box (with words selected: quote them)"],
      [`${C} + Shift + .`, "Pop-up note box right where you're reading (always works)"],
      [`${C} + /`, "Show / hide the Notes panel"],
      ["Double-click blank space", "Pop-up note box right there"],
      ["Right-click › ✎ Quick note here", "Same pop-up note box"],
      ["Hover the Notes tab", "Opens the panel; move away and it closes"],
      ["Enter · Tab · 0–8", "In a note box: Enter saves · Tab picks the type · a number saves as that type · Esc closes"],
      ["↑ when suggestions show", "Step into the suggestions under the box (word endings or spelling fixes): ← → choose, Enter or Tab takes it, Esc goes back to typing. → alone takes the first ending"],
    ]},
    { title: "Highlighting & saving", rows: [
      ["Select words", "The save pop-up appears: pick a type (number keys 1–8) or press Enter for the lit one"],
      ["Tab (in the pop-up)", "Jump from the text box to the type chips"],
      ["Explains: [point]", "After a list, the pop-up offers which list point these words explain (guessed); Enter saves them right under that point, in any order"],
      ["S", "Snip a figure (PDF)"],
      ["Click text, then arrows", "PDF keyboard cursor: ←→↑↓, Home/End = line ends, Shift+arrows select, Enter saves the selection"],
      ["Alt + Shift + H", "Highlighter on / off (anywhere)"],
      ["Alt + Shift + C", "Create a course"],
    ]},
    { title: "Asking the AI (once it's on in Settings › AI)", rows: [
      ["✨ AI view › Document · Page · My notes", "Pick what the AI reads: the open document, the page you're on, or your notes on this topic"],
      ["Type a question, Enter", "Ask it; Summarise / Quiz me work on the same choice"],
      ["Keep as note", "The only way an answer reaches your notes"],
    ]},
    { title: "Switching views", rows: [
      ["Alt + 1 · Alt + 2 · Alt + 3", "Home · Study · AI (in the panel, and in the readers)"],
    ]},
    { title: "In the reader", rows: [
      ["← →", "Previous / next page"],
      [`${C} + +  /  ${C} + −  /  ${C} + 0`, "Zoom in / out / reset (pinch works too)"],
      ["F11", "Leave full screen (readers open full screen)"],
      ["All notes (toolbar)", "Browse, search and edit everything in a new tab"],
    ]},
    { title: "Study tab — your notes list", rows: [
      [`${C} + ↑  (empty note box)`, "Your last typed note comes back into the box to edit: Enter saves, Esc stops. If the last note is a highlight (or the box has text), it jumps to the last note instead"],
      [`${C} + ↓  (on a note)`, "Back to the note box"],
      ["↑ ↓ · Home · End", "Move between notes"],
      ["Enter · Space", "Edit the note"],
      ["Delete (twice)", "Delete the note"],
      ["Alt + ↑ ↓", "Move the note up / down"],
      ["Alt + ← →", "Outdent / indent, with the notes under it (a list head takes its points)"],
      ["Alt + Shift + ← →", "Outdent / indent just that one note"],
      ["Shift + ↑ ↓ · Shift + click", "Pick several notes, then Alt + ← → moves them together (Esc unpicks)"],
      ["← →  (on a heading)", "Fold / unfold what's under it"],
      ["Tab · Shift+Enter", "In the note box: Tab = Save as (then a number or Enter) · Shift+Enter = new line"],
      ["Hover a note's left edge", "⋮⋮ drag to move · ⇤ ⇥ outdent / indent"],
    ]},
    { title: "All notes (the big page)", rows: [
      ["Click a note", "Edit it, typed notes too (Enter saves · Shift+Enter new line · Esc cancels)"],
      ["Hover a note's left edge", "↑ ↓ move it · ⇤ ⇥ indent"],
      ["Alt + ↑ ↓ ← →", "Same, on the note that has the keyboard (Tab to it)"],
    ]},
  ];
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  window.lnHowtoHtml = () => SECTIONS.map((s) =>
    `<h3>${esc(s.title)}</h3><table>${s.rows.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</table>`
  ).join("");
})();
