// Lazy Notes — Storage Module
// Every other file imports from here. Nothing outside this file touches
// chrome.storage directly.
//
// Schema (single top-level key "lazynotes"):
//
// lazynotes: {
//   courses: {
//     "<courseName>": {
//       level:   "100 Level / Year 1",
//       semester: "S1" | "S2" | "S3",
//       details: "..."  | "",
//       topics: {
//         "<topicName>": {
//           created: "<ISO>",
//           highlights: {
//             "<uuid>": {
//               text, category, annotation, context, sourceUrl,
//               sourceTitle (page title, or "file.pdf, p. 4"),
//               anchor ({ page, occurrence } for PDF notes, else null),
//               timestamp, edited
//             }
//           },
//           notes: {               // typed in the side panel, not highlighted
//             "<uuid>": {
//               text,              // plain text; lines starting "> " are quotes
//               timestamp, edited
//             }
//           }
//         }
//       }
//     }
//   }
// }
//
// Topics created before typed notes existed have no "notes" key; read it as {}.
//
// Separate top-level keys: activeCourse, activeTopic, highlighterActive,
// lastCourseDefaults.

export const LEVELS = [
  "100 Level / Year 1",
  "200 Level / Year 2",
  "300 Level / Year 3",
  "400 Level / Year 4",
  "500 Level / Year 5",
  "600 Level / Year 6"
];

export const SEMESTERS = ["S1", "S2", "S3"];

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

export function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

export function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

// ---------------------------------------------------------------------------
// lazynotes root
// ---------------------------------------------------------------------------

export async function getLazyNotes() {
  const { lazynotes } = await storageGet("lazynotes");
  if (!lazynotes) return { courses: {} };
  if (!lazynotes.courses) lazynotes.courses = {};
  return lazynotes;
}

// One change to the notes at a time. Every change reads the whole notes
// object, edits it and writes it back, so two changes running together
// (two quick deletes, a delete while a list is still saving) would each
// write their own copy and undo the other, bringing a deleted note back.
// The message router runs every note-changing message through this.
let notesQueue = Promise.resolve();
export function oneAtATime(fn) {
  const run = notesQueue.then(fn, fn);
  notesQueue = run.catch(() => {});
  return run;
}

export async function setLazyNotes(data) {
  await storageSet({ lazynotes: data });
  return data;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function getCourses() {
  const data = await getLazyNotes();
  return data.courses;
}

export async function getCourse(courseName) {
  const courses = await getCourses();
  return courses[courseName] || null;
}

export async function createCourse(name, level, semester, details) {
  const data = await getLazyNotes();

  data.courses[name] = {
    level:    level || "",
    semester: semester || "",
    details:  details || "",
    topics:   data.courses[name]?.topics || {}
  };

  await setLazyNotes(data);
  return data.courses;
}

export async function deleteCourse(courseName) {
  const data = await getLazyNotes();
  delete data.courses[courseName];
  await setLazyNotes(data);
  return data.courses;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export async function getTopics(courseName) {
  const course = await getCourse(courseName);
  return course ? course.topics : {};
}

export async function getTopic(courseName, topicName) {
  const topics = await getTopics(courseName);
  return topics[topicName] || null;
}

export async function createTopic(courseName, topicName) {
  const data = await getLazyNotes();
  const course = data.courses[courseName];
  if (!course) return null;

  course.topics[topicName] = {
    created: new Date().toISOString(),
    highlights: course.topics[topicName]?.highlights || {},
    notes:      course.topics[topicName]?.notes || {}
  };

  await setLazyNotes(data);
  return course.topics;
}

export async function deleteTopic(courseName, topicName) {
  const data = await getLazyNotes();
  const course = data.courses[courseName];
  if (!course) return null;

  delete course.topics[topicName];
  await setLazyNotes(data);
  return course.topics;
}

// ---------------------------------------------------------------------------
// Highlights — nested at courses[course].topics[topic].highlights
// ---------------------------------------------------------------------------

export async function getHighlightsForTopic(courseName, topicName) {
  const topic = await getTopic(courseName, topicName);
  if (!topic || !topic.highlights) return [];

  return Object.entries(topic.highlights).map(([id, fields]) => ({
    id,
    ...fields
  }));
}

export async function getHighlight(id, courseName, topicName) {
  const topic = await getTopic(courseName, topicName);
  if (!topic || !topic.highlights || !topic.highlights[id]) return null;
  return { id, ...topic.highlights[id] };
}

export async function insertHighlight(id, payload, courseName, topicName) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  if (!topic) return null;

  if (!topic.highlights) topic.highlights = {};

  let inheritIndent = await followIndent(topic, payload.listStart ? "list head" : payload.category);
  // "Explains: [point]": straight under that list point, one level in, after
  // anything already explaining it (so the explanations of a list can come
  // in any order).
  let placeOrder = null;
  const point = payload.explains && topic.highlights[payload.explains];
  if (point) {
    const ord = (n) => (typeof n.order === "number" ? n.order : (Date.parse(n.timestamp) || 0));
    const all = [...Object.values(topic.highlights), ...Object.values(topic.notes || {})].sort((a, b) => ord(a) - ord(b));
    const lvl = point.indent || 0;
    let i = all.indexOf(point);
    while (i + 1 < all.length && (all[i + 1].indent || 0) > lvl) i++;
    const last = all[i], next = all[i + 1];
    placeOrder = next ? (ord(last) + ord(next)) / 2 : ord(last) + 1000;
    inheritIndent = Math.min(3, lvl + 1);
  }


  topic.highlights[id] = {
    ...(inheritIndent ? { indent: inheritIndent } : {}),
    ...(placeOrder !== null ? { order: placeOrder } : {}),
    text:       payload.text ?? "",
    category:   payload.category,
    ...(payload.category === "figure" && payload.image ? { image: payload.image } : {}),   // figures: data URL
    annotation: payload.annotation ?? null,
    context:    payload.context ?? null,
    sourceUrl:  payload.sourceUrl,
    sourceTitle: payload.sourceTitle ?? null,
    anchor:     payload.anchor ?? null,
    // Written by an AI, not by you (📖 Define). Kept so you can always tell.
    ...(payload.fromAi ? { fromAi: true } : {}),
    // A list saved as several points sends its own, a millisecond apart, to
    // keep their order (accepted only if it's about now).
    timestamp:  (payload.timestamp && Math.abs(Date.parse(payload.timestamp) - Date.now()) < 60000)
                  ? payload.timestamp : new Date().toISOString(),
    edited:     null
  };

  await setLazyNotes(data);
  return topic.highlights[id];
}

// A new note sits at the indent of the last note in the topic, so you stay
// inside the nest you're writing in (Alt+← to leave it). Headers, sub
// topics and list heads start at the left edge. Settings › Old ways › lnIndentFollowLists:
// only list points follow (the old way).
async function followIndent(topic, category) {
  // Headings and list heads start a new block at the left edge (a list head
  // inheriting a deep indent made a new list look like part of the old nest).
  if (category === "header" || category === "sub topic" || category === "list head") return 0;
  const { lnIndentFollowLists } = await storageGet("lnIndentFollowLists");
  if (lnIndentFollowLists === true && category !== "list point") return 0;
  const ord = (n) => (typeof n.order === "number" ? n.order : (Date.parse(n.timestamp) || 0));
  const all = [...Object.values(topic.highlights || {}), ...Object.values(topic.notes || {})];
  const last = all.sort((a, b) => ord(b) - ord(a))[0];
  return last && last.indent > 0 ? Math.min(3, last.indent) : 0;
}

export async function updateHighlight(id, courseName, topicName, fields) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  if (!topic || !topic.highlights || !topic.highlights[id]) return null;

  topic.highlights[id] = {
    ...topic.highlights[id],
    ...fields,
    edited: new Date().toISOString()
  };

  await setLazyNotes(data);
  return topic.highlights[id];
}

export async function deleteHighlight(id, courseName, topicName) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  if (!topic || !topic.highlights) return null;

  delete topic.highlights[id];
  await setLazyNotes(data);
  return topic.highlights;
}

export async function countHighlights(courseName, topicName) {
  const topic = await getTopic(courseName, topicName);
  if (!topic || !topic.highlights) return 0;
  return Object.keys(topic.highlights).length;
}

// ---------------------------------------------------------------------------
// Typed notes — nested at courses[course].topics[topic].notes
// ---------------------------------------------------------------------------

export async function insertTypedNote(id, courseName, topicName, text) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  if (!topic) return null;

  if (!topic.notes) topic.notes = {};
  const indent = await followIndent(topic, "typed");
  topic.notes[id] = { ...(indent ? { indent } : {}), text, timestamp: new Date().toISOString(), edited: null };

  await setLazyNotes(data);
  return topic.notes[id];
}

export async function updateTypedNote(id, courseName, topicName, text) {
  const data = await getLazyNotes();
  const note = data.courses[courseName]?.topics?.[topicName]?.notes?.[id];
  if (!note) return null;

  note.text   = text;
  note.edited = new Date().toISOString();

  await setLazyNotes(data);
  return note;
}

export async function deleteTypedNote(id, courseName, topicName) {
  const data = await getLazyNotes();
  const topic = data.courses[courseName]?.topics?.[topicName];
  if (!topic?.notes?.[id]) return null;

  delete topic.notes[id];
  await setLazyNotes(data);
  return topic.notes;
}
