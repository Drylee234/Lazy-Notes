// Q-notes — Typed notes (written in the side panel's Study tab)
// Replies { ok, reason?, id? } so the panel can keep the text and say so if a
// save fails, instead of losing what was typed.

import { insertTypedNote, updateTypedNote, deleteTypedNote } from './bg_storage.js';
import { validateTypedNote } from './bg_validators.js';
import { notifySidePanel } from './bg_sidepanel.js';

// { id?, courseName, topicName, text }: updates the note when id names one
// that exists, else creates it (under id, when given).
export async function handleSaveTypedNote(message) {
  const result = await validateTypedNote(message);
  if (!result.valid) return { ok: false, reason: result.reason };

  const { courseName, topicName } = message;
  const text = message.text.replace(/\s+$/, "");

  const updated = message.id
    ? await updateTypedNote(message.id, courseName, topicName, text)
    : null;

  const id = message.id || crypto.randomUUID();
  if (!updated && !(await insertTypedNote(id, courseName, topicName, text))) {
    // The topic went away after the check above (deleted in another window).
    return { ok: false, reason: `Topic "${topicName}" no longer exists.` };
  }

  notifySidePanel();
  return { ok: true, id };
}

export async function handleDeleteTypedNote({ id, courseName, topicName }) {
  if (!id || !courseName || !topicName) return { ok: false, reason: "Missing note." };

  const result = await deleteTypedNote(id, courseName, topicName);
  if (result === null) return { ok: false, reason: "Note not found." };

  notifySidePanel();
  return { ok: true };
}
