// Lazy Notes — Messaging

import { handleNewHighlight, handleToggleTrigger } from './bg_highlights.js';
import {
  handleCreateCourse,
  handleCreateTopic,
  handleCourseSelection,
  handleTopicSelection,
  handleDeleteCourse,
  handleDeleteTopic,
  handleRenameCourse,
  handleRenameTopic,
  handleDeleteHighlight,
  handleImportTopic
} from './bg_courses.js';
import { requestSidePanel, togglePanelFor } from './bg_sidepanel.js';
import { tidyOldNotes, undoTidy } from './bg_tidy.js';
import { countUsage } from './bg_diag.js';
import { openPdfInReader } from './bg_pdf.js';
import { handleSaveTypedNote, handleDeleteTypedNote } from './bg_typed_notes.js';
import { handleGetLast, handleJoinToLast, handleUnjoin } from './bg_join.js';
import { handleAiTest, handleAiRun, handleAiReady, handleAiSaveNote } from './bg_ai.js';
import { oneAtATime, updateHighlight } from './bg_storage.js';
import { watchHabits, countHabit } from './bg_habits.js';

export function broadcastToAllTabs(message) {
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, message, () => {
        // No content script: the tab was open before the extension was
        // installed/reloaded. Inject it — on start it reads the current
        // state from storage, so the message doesn't need resending.
        if (isMissingContentScript()) injectContentScript(tab.id);
      });
    });
  });
}

// lastError is also set when the content script simply doesn't reply, so only
// "nobody is listening" means the script is missing.
function isMissingContentScript() {
  const msg = chrome.runtime.lastError?.message || "";
  return msg.includes("Receiving end does not exist");
}

function injectContentScript(tabId) {
  chrome.scripting
    .executeScript({ target: { tabId }, files: ["content/content.js"] })
    .catch(() => { /* restricted page (e.g. Chrome Web Store) */ });
}

// Give every already-open tab the content script, skipping tabs that have it.
export function ensureContentScripts() {
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id == null || tab.discarded) return;
      chrome.tabs.sendMessage(tab.id, { type: "LAZY_NOTES_PING" }, () => {
        if (isMissingContentScript()) injectContentScript(tab.id);
      });
    });
  });
}

// These reply with { ok, reason? } so the page can tell the user if it failed.
const REPLY_HANDLERS = {
  DELETE_COURSE:      handleDeleteCourse,
  DELETE_TOPIC:       handleDeleteTopic,
  RENAME_COURSE:      handleRenameCourse,
  RENAME_TOPIC:       handleRenameTopic,
  DELETE_HIGHLIGHT:   handleDeleteHighlight,
  SAVE_TYPED_NOTE:    handleSaveTypedNote,
  DELETE_TYPED_NOTE:  handleDeleteTypedNote,
  GET_LAST_HIGHLIGHT: handleGetLast,
  JOIN_TO_LAST:       handleJoinToLast,
  UNJOIN:             handleUnjoin,
  AI_TEST:            handleAiTest,
  AI_RUN:             handleAiRun,
  AI_READY:           handleAiReady,
  AI_SAVE_NOTE:       handleAiSaveNote,
  IMPORT_TOPIC:       handleImportTopic,
  UPDATE_HIGHLIGHT:   async ({ id, courseName, topicName, fields }) => {
    const note = id && fields ? await updateHighlight(id, courseName, topicName, fields) : null;
    return note ? { ok: true, note } : { ok: false, reason: "That highlight was deleted." };
  }
};

// These only read, or wait on the internet: they don't queue behind saves.
const NOT_QUEUED = new Set(["AI_TEST", "AI_RUN", "AI_READY", "GET_LAST_HIGHLIGHT"]);

// What gets counted in the usage report (actions, never their contents).
const COUNTED = new Set(["NEW_HIGHLIGHT", "NEW_HIGHLIGHTS", "SAVE_TYPED_NOTE", "DELETE_HIGHLIGHT", "DELETE_TYPED_NOTE",
  "JOIN_TO_LAST", "UNJOIN", "CREATE_COURSE", "CREATE_TOPIC", "SEND_TO_NOTE_BOX", "TOGGLE_HIGHLIGHTER_REQUEST",
  "OPEN_PDF_IN_READER", "SET_ARRANGEMENT", "TIDY_NOTES", "AI_RUN", "AI_TEST", "AI_SAVE_NOTE"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (COUNTED.has(message?.type)) {
    countUsage(message.type === "AI_RUN"
      ? `ai:${message.task || "?"}`
      : message.type === "NEW_HIGHLIGHT"
      ? `save:${message.category || "?"}${message.sourceUrl ? "" : ":typed"}${/pdfreader|pptxreader|docxreader/.test(sender?.url || "") ? ":reader" : ""}`
      : message.type);
  }
  const replyHandler = REPLY_HANDLERS[message.type];
  if (replyHandler) {
    (NOT_QUEUED.has(message.type) ? replyHandler(message)
      : oneAtATime(async () => { await watchHabits(message).catch(() => {}); return replyHandler(message); }))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err) }));
    return true;  // keep the channel open for the async reply
  }

  switch (message.type) {
    case "HABIT":            // a page noticed a habit (bg_habits.js)
      countHabit(message.name);
      return;
    case "NEW_HIGHLIGHT":
      oneAtATime(() => handleNewHighlight(message));
      return;
    case "TIDY_NOTES":        // Settings › More options: run again / undo
      oneAtATime(() => (message.undo ? undoTidy() : tidyOldNotes({ force: true })))
        .then((count) => sendResponse({ ok: true, count }))
        .catch((err) => sendResponse({ ok: false, reason: String(err) }));
      return true;
    case "SEND_TO_NOTE_BOX":   // ✎ Note / ❝ Quote in a web page's save pop-up
      requestSidePanel({ type: "FILL_COMPOSER", mode: message.mode, text: String(message.text || "") }, sender.tab);
      return;
    case "NEW_HIGHLIGHTS":   // several at once (a list split into points): one after another
      oneAtATime(async () => { for (const h of message.items || []) await handleNewHighlight(h); });
      return;
    case "CREATE_COURSE":
      oneAtATime(() => handleCreateCourse(message));
      return;
    case "CREATE_TOPIC":
      oneAtATime(() => handleCreateTopic(message));
      return;
    case "SET_ACTIVE_COURSE":
      handleCourseSelection(message.courseName);
      return;
    case "SET_ACTIVE_TOPIC":
      handleTopicSelection(message.courseName, message.topicName);
      return;
    case "TOGGLE_HIGHLIGHTER_REQUEST":
      handleToggleTrigger();
      return;
    case "OPEN_PDF_IN_READER":
      openPdfInReader(sender, message);
      return;
    default:
      return;
  }
});

// Keyboard shortcuts (commands) route to the same handlers.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-highlighter") {
    handleToggleTrigger();
  }
  if (command === "toggle-panel") togglePanelFor(tab);
  if (command === "create-course") {
    requestSidePanel({ type: "SHOW_CREATE_COURSE" }, tab);
  }
});
