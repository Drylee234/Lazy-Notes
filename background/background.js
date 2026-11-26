// Lazy Notes — Background Service Worker (thin entry point)

import './bg_diag.js';
import './bg_storage.js';
import './bg_validators.js';
import './bg_highlights.js';
import './bg_courses.js';
import './bg_context_menus.js';
import './bg_messaging.js';
import './bg_sidepanel.js';
import './bg_pptx.js';
import './bg_sync.js';
import './bg_arrange.js';
import './bg_tidy.js';
import './bg_ai.js';

import { refreshCourseContextMenuItems } from './bg_context_menus.js';
import { ensureContentScripts } from './bg_messaging.js';
import { restoreBadge } from './bg_highlights.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  refreshCourseContextMenuItems();
  ensureContentScripts();  // tabs opened before install/reload
  restoreBadge();
});

chrome.runtime.onStartup.addListener(() => {
  refreshCourseContextMenuItems();
  restoreBadge();
});
