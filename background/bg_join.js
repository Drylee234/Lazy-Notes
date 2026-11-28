// QNotes — "Join to last": add a highlight's words onto the end of the
// previous highlight in the same topic (a sentence broken across PDF
// columns, lines or pages). Replies { ok, ... } so the pop-up can say so.

import { getLazyNotes, setLazyNotes } from './bg_storage.js';
import { notifySidePanel } from './bg_sidepanel.js';

const MAX_AGE = 3 * 60 * 60 * 1000;   // only join to something from the last 3 hours

function lastHighlight(topic) {
  let best = null;
  Object.entries(topic?.highlights || {}).forEach(([id, h]) => {
    if (h.category === "figure") return;
    const t = Date.parse(h.timestamp) || 0;
    if (!best || t > best.t) best = { id, h, t };
  });
  return best && Date.now() - best.t < MAX_AGE ? best : null;
}

// { courseName, topicName } → { ok, id, text } for the pop-up's "Join to …".
export async function handleGetLast({ courseName, topicName }) {
  const data = await getLazyNotes();
  const last = lastHighlight(data.courses[courseName]?.topics?.[topicName]);
  // Words never carry on a heading or a picture: no Join offered after one.
  if (last && ["header", "sub topic", "figure", "table"].includes(last.h.category)) return { ok: false };
  return last ? { ok: true, id: last.id, text: last.h.text } : { ok: false };
}

// "-" at a line break means the word was split: join without the hyphen.
export function joinText(a, b) {
  a = String(a || "").replace(/\s+$/, "");
  b = String(b || "").replace(/^\s+/, "");
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

// { courseName, topicName, text } → { ok, id, before }
export async function handleJoinToLast({ courseName, topicName, text }) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  const last = lastHighlight(topic);
  if (!last) return { ok: false, reason: "No recent highlight to join to." };
  const before = last.h.text;
  topic.highlights[last.id] = { ...last.h, text: joinText(before, text), edited: new Date().toISOString() };
  await setLazyNotes(data);
  notifySidePanel();
  return { ok: true, id: last.id, before };
}

// Undo: { courseName, topicName, id, before }
export async function handleUnjoin({ courseName, topicName, id, before }) {
  const data = await getLazyNotes();
  const h = data.courses[courseName]?.topics?.[topicName]?.highlights?.[id];
  if (!h) return { ok: false };
  h.text = before;
  await setLazyNotes(data);
  notifySidePanel();
  return { ok: true };
}
