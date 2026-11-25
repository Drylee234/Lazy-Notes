// Lazy Notes — Validators
// Called by handlers before any storage write. Returns { valid: true }
// or { valid: false, reason: "..." }.

import { LEVELS, SEMESTERS, getCourse, getTopic } from './bg_storage.js';

export const CATEGORIES = [
  "header",
  "definition",
  "formula",
  "list head",
  "list point",
  "summary"
];

export async function validateHighlight(payload) {
  if (!payload || !payload.text || !payload.text.trim()) {
    return { valid: false, reason: "Highlight text is empty." };
  }

  if (!CATEGORIES.includes(payload.category)) {
    return { valid: false, reason: `Invalid category: ${payload.category}` };
  }

  if (!payload.course || !payload.topic) {
    return { valid: false, reason: "Missing course or topic." };
  }

  const course = await getCourse(payload.course);
  if (!course) {
    return { valid: false, reason: `Course "${payload.course}" does not exist.` };
  }

  const topic = await getTopic(payload.course, payload.topic);
  if (!topic) {
    return { valid: false, reason: `Topic "${payload.topic}" does not exist.` };
  }

  return { valid: true };
}

export async function validateTypedNote(payload) {
  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
    return { valid: false, reason: "The note is empty." };
  }

  if (!payload.courseName || !payload.topicName) {
    return { valid: false, reason: "Missing course or topic." };
  }

  const topic = await getTopic(payload.courseName, payload.topicName);
  if (!topic) {
    return { valid: false, reason: `Topic "${payload.topicName}" does not exist.` };
  }

  return { valid: true };
}

export function validateCourse(name, level, semester) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { valid: false, reason: "Course name is required." };
  }

  if (level && !LEVELS.includes(level)) {
    return { valid: false, reason: `Invalid level: ${level}` };
  }

  if (semester && !SEMESTERS.includes(semester)) {
    return { valid: false, reason: `Invalid semester: ${semester}` };
  }

  return { valid: true };
}

export async function validateTopic(courseName, name) {
  if (!courseName || typeof courseName !== "string" || !courseName.trim()) {
    return { valid: false, reason: "A valid parent course is required to create a topic." };
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return { valid: false, reason: "Topic name is required." };
  }

  const course = await getCourse(courseName);
  if (!course) {
    return { valid: false, reason: `Course "${courseName}" does not exist.` };
  }

  return { valid: true };
}
