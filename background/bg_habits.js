// Q-notes — habits: which features and shortcuts get used, and signs of
// struggle, so a tester's report shows what's unknown or awkward without
// them describing it. Counts only: never note text, never keys typed.
//
// Recorded as usage counts "habit:<name>" (bg_diag.js), sent with sync in the
// usage report. Settings › Problems › "Also record habits" (lnHabits, on)
// turns this part off by itself; the error report keeps working.
//
// Struggle signs (worked out here, from what the pages ask the background):
//   delete-soon     a note deleted within a minute of saving it
//   edit-soon       a note edited within a minute of saving it
//   indent-new      a just-saved note indented / outdented by hand
// Pages send HABIT { name } for the rest (shortcuts used, Undo pressed,
// save pop-up dismissed, How to use opened…).

import { countUsage } from './bg_diag.js';
import { getLazyNotes } from './bg_storage.js';

const SOON_MS = 60 * 1000;

export async function habitsOn() {
  const { lnHabits, lnSendReports } = await chrome.storage.local.get(["lnHabits", "lnSendReports"]);
  return lnHabits !== false && lnSendReports !== false;
}

export async function countHabit(name) {
  if (!name || !(await habitsOn())) return;
  countUsage(`habit:${String(name).replace(/[^\w:.-]/g, "").slice(0, 40)}`);
}

const ageOf = (n) => (n ? Date.now() - (Date.parse(n.timestamp) || 0) : Infinity);

// Runs in the save queue just before the change, so the note is still there.
export async function watchHabits(m) {
  if (!(await habitsOn())) return;
  const types = ["DELETE_HIGHLIGHT", "DELETE_TYPED_NOTE", "UPDATE_HIGHLIGHT", "SAVE_TYPED_NOTE", "SET_ARRANGEMENT"];
  if (!types.includes(m?.type)) return;
  const topic = (await getLazyNotes()).courses?.[m.courseName]?.topics?.[m.topicName];
  if (!topic) return;
  if (m.type === "DELETE_HIGHLIGHT" && ageOf(topic.highlights?.[m.id]) < SOON_MS) countUsage("habit:delete-soon");
  if (m.type === "DELETE_TYPED_NOTE" && ageOf(topic.notes?.[m.id]) < SOON_MS) countUsage("habit:delete-soon");
  if (m.type === "UPDATE_HIGHLIGHT" && ageOf(topic.highlights?.[m.id]) < SOON_MS) countUsage("habit:edit-soon");
  if (m.type === "SAVE_TYPED_NOTE" && topic.notes?.[m.id] && ageOf(topic.notes[m.id]) < SOON_MS) countUsage("habit:edit-soon");
  if (m.type === "SET_ARRANGEMENT") {
    const fresh = (m.items || []).some((it) => typeof it.indent === "number" &&
      ageOf((it.kind === "typed" ? topic.notes : topic.highlights)?.[it.id]) < SOON_MS);
    if (fresh) countUsage("habit:indent-new");
  }
}

// What a report can say was never used in the last 30 days.
export const FEATURES = {
  "save:": "Saving highlights", "JOIN_TO_LAST": "Join (J)", "SAVE_TYPED_NOTE": "Typing notes",
  "SET_ARRANGEMENT": "Moving / indenting notes", "AI_RUN": "AI help", "habit:key-alt-indent": "Alt+←/→ indent",
  "habit:key-ctrl-up": "Ctrl+↑ to the last note", "habit:pick-notes": "Picking several notes (Shift)",
"habit:howto": "How to use", "habit:share": "Sharing a topic",
  "habit:quick-note": "Pop-up note box"
};
