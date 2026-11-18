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
import { sendShowCreateCourse } from './bg_sidepanel.js';

export function broadcastToAllTabs(message) {
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, message, () => {
        if (chrome.runtime.lastError) { /* no content script on this tab */ }
      });
    });
  });
}

// Deletes reply with { ok, reason? } so the page can tell the user if it failed.
const DELETE_HANDLERS = {
  DELETE_COURSE:    handleDeleteCourse,
  DELETE_TOPIC:     handleDeleteTopic,
  DELETE_HIGHLIGHT: handleDeleteHighlight
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const deleteHandler = DELETE_HANDLERS[message.type];
  if (deleteHandler) {
    deleteHandler(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err) }));
    return true;  // keep the channel open for the async reply
  }

  switch (message.type) {
    case "NEW_HIGHLIGHT":
      handleNewHighlight(message);
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
    default:
      return;
  }
});

// Keyboard shortcuts (commands) route to the same handlers.
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-highlighter") {
    handleToggleTrigger();
  }
  if (command === "create-course") {
    sendShowCreateCourse();
  }
});
