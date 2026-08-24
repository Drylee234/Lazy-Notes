// Lazy Notes — Messaging

import { handleNewHighlight, handleToggleTrigger } from './bg_highlights.js';
import {
  handleCreateCourse,
  handleCreateTopic,
  handleCourseSelection,
  handleTopicSelection
} from './bg_courses.js';

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

chrome.runtime.onMessage.addListener((message) => {
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
    chrome.runtime.sendMessage(
      { type: "SHOW_CREATE_COURSE" },
      () => { if (chrome.runtime.lastError) { /* side panel not open */ } }
    );
  }
});
