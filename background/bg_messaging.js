// Lazy Notes — Messaging

import { handleNewHighlight, handleToggleTrigger } from './bg_highlights.js';
import {
  handleCreateCourse,
  handleCreateTopic,
  handleCourseSelection,
  handleTopicSelection,
  handleDeleteCourse,
  handleDeleteTopic,
  handleDeleteHighlight
} from './bg_courses.js';
import { requestSidePanel } from './bg_sidepanel.js';
import { openPdfInReader } from './bg_pdf.js';
import { handleSaveTypedNote, handleDeleteTypedNote } from './bg_typed_notes.js';
import { handleGetLast, handleJoinToLast, handleUnjoin } from './bg_join.js';

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
  DELETE_HIGHLIGHT:   handleDeleteHighlight,
  SAVE_TYPED_NOTE:    handleSaveTypedNote,
  DELETE_TYPED_NOTE:  handleDeleteTypedNote,
  GET_LAST_HIGHLIGHT: handleGetLast,
  JOIN_TO_LAST:       handleJoinToLast,
  UNJOIN:             handleUnjoin
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const replyHandler = REPLY_HANDLERS[message.type];
  if (replyHandler) {
    replyHandler(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err) }));
    return true;  // keep the channel open for the async reply
  }

  switch (message.type) {
    case "NEW_HIGHLIGHT":
      handleNewHighlight(message);
      return;
    case "NEW_HIGHLIGHTS":   // several at once (a list split into points): one after another
      (async () => { for (const h of message.items || []) await handleNewHighlight(h); })();
      return;
    case "CREATE_COURSE":
      handleCreateCourse(message);
      return;
    case "CREATE_TOPIC":
      handleCreateTopic(message);
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
  if (command === "create-course") {
    requestSidePanel({ type: "SHOW_CREATE_COURSE" }, tab);
  }
});
