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
//               timestamp, edited
//             }
//           }
//         }
//       }
//     }
//   }
// }
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
    highlights: course.topics[topicName]?.highlights || {}
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

  topic.highlights[id] = {
    text:       payload.text,
    category:   payload.category,
    annotation: payload.annotation ?? null,
    context:    payload.context ?? null,
    sourceUrl:  payload.sourceUrl,
    sourceTitle: payload.sourceTitle ?? null,
    timestamp:  new Date().toISOString(),
    edited:     null
  };

  await setLazyNotes(data);
  return topic.highlights[id];
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
