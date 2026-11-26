// Lazy Notes — arranging a topic's notes (Study tab: drag to reorder,
// Tab / Shift+Tab to indent).
//
// SET_ARRANGEMENT { courseName, topicName, items: [{ kind: "highlight" |
// "typed", id, order?, indent? }] } sets those fields on several notes in one
// storage write, so a move never races with itself. Replies { ok, reason? }.
//   order   number; where the note sits (missing = its time, see noteOrder
//           in shared/utils.js)
//   indent  0-3

import { getLazyNotes, setLazyNotes } from './bg_storage.js';
import { notifySidePanel } from './bg_sidepanel.js';

async function setArrangement({ courseName, topicName, items }) {
  const data = await getLazyNotes();
  const topic = data.courses?.[courseName]?.topics?.[topicName];
  if (!topic) return { ok: false, reason: `Topic "${topicName}" no longer exists.` };
  let changed = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const note = (it.kind === "typed" ? topic.notes : topic.highlights)?.[it.id];
    if (!note) continue;                       // deleted meanwhile: skip, don't fail the rest
    if (typeof it.order === "number" && Number.isFinite(it.order)) note.order = it.order;
    if (typeof it.indent === "number") note.indent = Math.max(0, Math.min(3, Math.round(it.indent)));
    changed++;
  }
  if (changed) await setLazyNotes(data);
  notifySidePanel();
  return { ok: true, changed };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SET_ARRANGEMENT") return;
  setArrangement(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, reason: String(err) }));
  return true;   // reply comes later
});
