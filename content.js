// Lazy Notes — Highlighter Content Script

const CATEGORIES = [
  "header",
  "definition",
  "formula",
  "list head",
  "list point",
  "summary"
];

const contextRequiredCategories = [
  "definition",
  "formula",
  "summary"
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let highlighterActive = false;
let currentCourse     = null;   // name string, for display
let currentCourseId   = null;   // integer id
let currentTopic      = null;   // { id, name } | null — active session topic
let availableCourses  = [];     // [{ id, name }, ...]
let availableTopics   = [];     // [{ id, name }, ...] for current course

// Session-level: { [topicId]: lastUsedCategory }
// Cleared implicitly when topic changes; reset on course/highlighter change.
const sessionCategoryMemory = {};

// Last topic used this session — default for popup on next selection.
// Reverts to null on course change or highlighter off.
let lastUsedTopic = null;

let selectedCourse     = null;   // { id, name }
let selectedTopic      = null;   // { id, name } | null
let selectedCategory   = CATEGORIES[0];
let selectedAnnotation = "";

let currentParagraphElement = null;
let currentSelectedText     = "";

// DOM refs
let popupContainer    = null;
let courseBtnEl       = null;
let courseMenuEl      = null;
let topicBtnEl        = null;
let topicMenuEl       = null;
let categoryBtnEl     = null;
let categoryMenuEl    = null;
let annotationInputEl = null;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectLazyNotesStyles() {
  if (document.getElementById("lazy-notes-styles")) return;

  const targetHead = document.head || document.documentElement;
  const style = document.createElement("style");
  style.id = "lazy-notes-styles";
  style.textContent = `
    .lazy-notes-popup {
      position: absolute;
      width: 280px;
      min-width: 280px;
      max-width: 420px;
      background-color: #1e1e24;
      color: #f0f0f0;
      border: 1px solid #33333d;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 2147483647;
      box-sizing: border-box;
      transition: width 0.15s ease;
    }

    .lazy-notes-popup-row {
      margin-bottom: 8px;
      position: relative;
    }

    .lazy-notes-inline-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .lazy-notes-popup-label-inline {
      font-size: 11px;
      font-weight: 600;
      color: #a0a0b0;
      white-space: nowrap;
      min-width: 60px;
    }

    .lazy-notes-popup-label-block {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #a0a0b0;
      margin-bottom: 4px;
    }

    .lazy-notes-dropdown-btn {
      flex: 1;
      width: 100%;
      background: #121216;
      border: 1px solid #33333d;
      border-radius: 6px;
      color: #ffffff;
      padding: 6px 8px;
      font-size: 12px;
      box-sizing: border-box;
      outline: none;
      text-transform: capitalize;
      text-align: left;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }

    .lazy-notes-dropdown-btn:focus,
    .lazy-notes-popup textarea:focus {
      border-color: #4f46e5;
    }

    .lazy-notes-dropdown-btn::after {
      content: "▾";
      font-size: 10px;
      color: #a0a0b0;
      pointer-events: none;
    }

    .lazy-notes-dropdown-menu {
      position: absolute;
      top: 100%;
      left: 68px;
      right: 0;
      background: #18181c;
      border: 1px solid #33333d;
      border-radius: 6px;
      margin-top: 4px;
      padding: 4px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      z-index: 10;
      display: none;
      max-height: 160px;
      overflow-y: auto;
    }

    .lazy-notes-dropdown-menu.open {
      display: block;
    }

    .lazy-notes-dropdown-item {
      padding: 5px 8px;
      font-size: 12px;
      border-radius: 4px;
      color: #cccccc;
      cursor: pointer;
      text-transform: capitalize;
    }

    .lazy-notes-dropdown-item:hover,
    .lazy-notes-dropdown-item.focused {
      background-color: #4f46e5;
      color: #ffffff;
    }

    .lazy-notes-dropdown-empty {
      padding: 5px 8px;
      font-size: 12px;
      color: #666670;
      font-style: italic;
    }

    .lazy-notes-textarea {
      width: 100%;
      min-height: 32px;
      max-height: 120px;
      background: #121216;
      border: 1px solid #33333d;
      border-radius: 6px;
      color: #ffffff;
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      box-sizing: border-box;
      outline: none;
      resize: none;
      overflow-y: hidden;
      line-height: 1.4;
    }

    .lazy-notes-popup-footer {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 10px;
    }

    .lazy-notes-btn {
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: background-color 0.15s ease;
    }

    .lazy-notes-btn-primary {
      background-color: #4f46e5;
      color: #ffffff;
    }

    .lazy-notes-btn-primary:hover {
      background-color: #4338ca;
    }

    .lazy-notes-btn-secondary {
      background-color: #2a2a32;
      color: #cccccc;
    }

    .lazy-notes-btn-secondary:hover {
      background-color: #383842;
      color: #ffffff;
    }
  `;

  targetHead.appendChild(style);
}

// ---------------------------------------------------------------------------
// Popup build
// ---------------------------------------------------------------------------

function buildPopup() {
  if (popupContainer) return;

  injectLazyNotesStyles();

  const container = document.createElement("div");
  container.className = "lazy-notes-popup";
  container.style.display = "none";

  // ── ROW 1: Course ─────────────────────────────────────────────────────────
  const row1 = document.createElement("div");
  row1.className = "lazy-notes-popup-row lazy-notes-inline-row";

  const courseLabel = document.createElement("span");
  courseLabel.className = "lazy-notes-popup-label-inline";
  courseLabel.textContent = "Course:";
  row1.appendChild(courseLabel);

  const courseBtn = document.createElement("button");
  courseBtn.type = "button";
  courseBtn.className = "lazy-notes-dropdown-btn";

  const courseMenu = document.createElement("div");
  courseMenu.className = "lazy-notes-dropdown-menu";

  courseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    topicMenuEl?.classList.remove("open");
    categoryMenuEl?.classList.remove("open");
    courseMenu.classList.toggle("open");
  });

  row1.appendChild(courseBtn);
  row1.appendChild(courseMenu);
  container.appendChild(row1);

  // ── ROW 2: Topic ──────────────────────────────────────────────────────────
  const row2 = document.createElement("div");
  row2.className = "lazy-notes-popup-row lazy-notes-inline-row";

  const topicLabel = document.createElement("span");
  topicLabel.className = "lazy-notes-popup-label-inline";
  topicLabel.textContent = "Topic:";
  row2.appendChild(topicLabel);

  const topicBtn = document.createElement("button");
  topicBtn.type = "button";
  topicBtn.className = "lazy-notes-dropdown-btn";

  const topicMenu = document.createElement("div");
  topicMenu.className = "lazy-notes-dropdown-menu";

  topicBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    courseMenuEl?.classList.remove("open");
    categoryMenuEl?.classList.remove("open");
    topicMenu.classList.toggle("open");
  });

  row2.appendChild(topicBtn);
  row2.appendChild(topicMenu);
  container.appendChild(row2);

  // ── ROW 3: Category ───────────────────────────────────────────────────────
  const row3 = document.createElement("div");
  row3.className = "lazy-notes-popup-row lazy-notes-inline-row";

  const categoryLabel = document.createElement("span");
  categoryLabel.className = "lazy-notes-popup-label-inline";
  categoryLabel.textContent = "Category:";
  row3.appendChild(categoryLabel);

  const categoryBtn = document.createElement("button");
  categoryBtn.type = "button";
  categoryBtn.className = "lazy-notes-dropdown-btn";

  const categoryMenu = document.createElement("div");
  categoryMenu.className = "lazy-notes-dropdown-menu";

  CATEGORIES.forEach((cat) => {
    const item = document.createElement("div");
    item.className = "lazy-notes-dropdown-item";
    item.dataset.value = cat;
    item.textContent = cat;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCategoryOption(cat);
      categoryMenu.classList.remove("open");
    });

    categoryMenu.appendChild(item);
  });

  categoryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    courseMenuEl?.classList.remove("open");
    topicMenuEl?.classList.remove("open");
    categoryMenu.classList.toggle("open");
  });

  row3.appendChild(categoryBtn);
  row3.appendChild(categoryMenu);
  container.appendChild(row3);

  // ── ROW 4: Annotation ─────────────────────────────────────────────────────
  const row4 = document.createElement("div");
  row4.className = "lazy-notes-popup-row";

  const annotationLabel = document.createElement("span");
  annotationLabel.className = "lazy-notes-popup-label-block";
  annotationLabel.textContent = "Annotation:";
  row4.appendChild(annotationLabel);

  const annotationInput = document.createElement("textarea");
  annotationInput.className = "lazy-notes-textarea";
  annotationInput.placeholder = "Add optional notes...";
  annotationInput.rows = 1;

  annotationInput.addEventListener("input", () => {
    selectedAnnotation = annotationInput.value;

    annotationInput.style.height = "auto";
    const newHeight = Math.min(annotationInput.scrollHeight, 120);
    annotationInput.style.height = `${newHeight}px`;
    annotationInput.style.overflowY = newHeight >= 120 ? "auto" : "hidden";

    const lineLen = Math.max(
      ...annotationInput.value.split("\n").map((l) => l.length)
    );
    container.style.width = lineLen > 25
      ? `${Math.min(280 + (lineLen - 25) * 3, 420)}px`
      : "280px";
  });

  row4.appendChild(annotationInput);
  container.appendChild(row4);

  // ── ROW 5: Footer buttons ─────────────────────────────────────────────────
  const row5 = document.createElement("div");
  row5.className = "lazy-notes-popup-footer";

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "lazy-notes-btn lazy-notes-btn-secondary";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hidePopup();
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "lazy-notes-btn lazy-notes-btn-primary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sendHighlight();
    hidePopup();
  });

  row5.appendChild(dismissBtn);
  row5.appendChild(saveBtn);
  container.appendChild(row5);

  (document.body || document.documentElement).appendChild(container);

  popupContainer    = container;
  courseBtnEl       = courseBtn;
  courseMenuEl      = courseMenu;
  topicBtnEl        = topicBtn;
  topicMenuEl       = topicMenu;
  categoryBtnEl     = categoryBtn;
  categoryMenuEl    = categoryMenu;
  annotationInputEl = annotationInput;
}

// ---------------------------------------------------------------------------
// Option selection helpers
// ---------------------------------------------------------------------------

function selectCourseOption(course) {
  // course is { id, name }
  selectedCourse = course;

  if (courseBtnEl) courseBtnEl.textContent = course.name;

  if (courseMenuEl) {
    courseMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
      item.classList.toggle("focused", parseInt(item.dataset.value, 10) === course.id);
    });
  }

  // Switching course resets topic to null and reloads topic list.
  // The popup can only show topics for the currently selected course —
  // if the user switches course we don't have those topics in memory,
  // so show empty and let them pick from the side panel.
  // (Content script only holds availableTopics for currentCourseId.)
  if (course.id !== currentCourseId) {
    selectedTopic = null;
    populateTopicOptions([]);
  } else {
    populateTopicOptions(availableTopics);
    // Restore last used topic for this course if it's still available
    const restored = lastUsedTopic && availableTopics.find(
      (t) => t.id === lastUsedTopic.id
    );
    selectTopicOption(restored || (availableTopics[0] ?? null));
  }
}

function selectTopicOption(topic) {
  // topic is { id, name } | null
  selectedTopic = topic;

  if (topicBtnEl) {
    topicBtnEl.textContent = topic ? topic.name : "No topics";
  }

  if (topicMenuEl) {
    topicMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
      item.classList.toggle(
        "focused",
        topic !== null && parseInt(item.dataset.value, 10) === topic.id
      );
    });
  }

  // Apply category memory for this topic
  if (topic) {
    const remembered = sessionCategoryMemory[topic.id];
    selectCategoryOption(remembered || CATEGORIES[0]);
  }
}

function selectCategoryOption(cat) {
  selectedCategory = cat;

  if (selectedTopic) {
    sessionCategoryMemory[selectedTopic.id] = cat;
  }

  if (categoryBtnEl) categoryBtnEl.textContent = cat;

  if (categoryMenuEl) {
    categoryMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
      item.classList.toggle("focused", item.dataset.value === cat);
    });
  }
}

function populateCourseOptions() {
  if (!courseMenuEl) return;
  courseMenuEl.innerHTML = "";

  availableCourses.forEach((course) => {
    const item = document.createElement("div");
    item.className = "lazy-notes-dropdown-item";
    item.dataset.value = String(course.id);
    item.textContent = course.name;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCourseOption(course);
      courseMenuEl.classList.remove("open");
    });

    courseMenuEl.appendChild(item);
  });
}

function populateTopicOptions(topics) {
  if (!topicMenuEl) return;
  topicMenuEl.innerHTML = "";

  if (!topics || topics.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lazy-notes-dropdown-empty";
    empty.textContent = "No topics — create one in the side panel";
    topicMenuEl.appendChild(empty);
    return;
  }

  topics.forEach((topic) => {
    const item = document.createElement("div");
    item.className = "lazy-notes-dropdown-item";
    item.dataset.value = String(topic.id);
    item.textContent = topic.name;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      selectTopicOption(topic);
      topicMenuEl.classList.remove("open");
    });

    topicMenuEl.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Popup state reset (called on every new selection)
// ---------------------------------------------------------------------------

function resetPopupState() {
  selectedAnnotation = "";

  populateCourseOptions();
  populateTopicOptions(availableTopics);

  // Default course
  const defaultCourse = currentCourse
    ? availableCourses.find((c) => c.id === currentCourseId) || availableCourses[0] || null
    : availableCourses[0] || null;

  if (defaultCourse) {
    selectCourseOption(defaultCourse);
  } else {
    selectedCourse = null;
    if (courseBtnEl) courseBtnEl.textContent = "No courses";
  }

  // Default topic — last used this session, or first available, or null
  if (availableTopics.length > 0) {
    const restored = lastUsedTopic && availableTopics.find(
      (t) => t.id === lastUsedTopic.id
    );
    selectTopicOption(restored || availableTopics[0]);
  } else {
    selectTopicOption(null);
  }

  if (courseMenuEl)    courseMenuEl.classList.remove("open");
  if (topicMenuEl)     topicMenuEl.classList.remove("open");
  if (categoryMenuEl)  categoryMenuEl.classList.remove("open");

  if (annotationInputEl) {
    annotationInputEl.value = "";
    annotationInputEl.style.height = "32px";
  }

  if (popupContainer) popupContainer.style.width = "280px";
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

function handleKeyDown(event) {
  if (!popupContainer || popupContainer.style.display === "none") return;

  const active          = document.activeElement;
  const isCourseOpen    = courseMenuEl?.classList.contains("open");
  const isTopicOpen     = topicMenuEl?.classList.contains("open");
  const isCategoryOpen  = categoryMenuEl?.classList.contains("open");

  // Escape: close open menu, or hide popup
  if (event.key === "Escape") {
    event.preventDefault();
    if (isCourseOpen)   courseMenuEl.classList.remove("open");
    else if (isTopicOpen)    topicMenuEl.classList.remove("open");
    else if (isCategoryOpen) categoryMenuEl.classList.remove("open");
    else hidePopup();
    return;
  }

  // ── COURSE BUTTON ──────────────────────────────────────────────────────────
  if (active === courseBtnEl) {
    if (event.key === " ") {
      event.preventDefault();
      topicMenuEl?.classList.remove("open");
      categoryMenuEl?.classList.remove("open");
      courseMenuEl.classList.toggle("open");
      return;
    }

    if (isCourseOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const currentIndex = availableCourses.findIndex(
        (c) => c.id === selectedCourse?.id
      );
      let newIndex = currentIndex;
      if (event.key === "ArrowDown") {
        newIndex = (currentIndex + 1) % availableCourses.length;
      } else {
        newIndex = (currentIndex - 1 + availableCourses.length) % availableCourses.length;
      }
      selectCourseOption(availableCourses[newIndex]);
      return;
    }

    if (!isCourseOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
      event.preventDefault();
      topicBtnEl?.focus();
      return;
    }
  }

  // ── TOPIC BUTTON ───────────────────────────────────────────────────────────
  if (active === topicBtnEl) {
    if (event.key === " ") {
      event.preventDefault();
      courseMenuEl?.classList.remove("open");
      categoryMenuEl?.classList.remove("open");
      topicMenuEl.classList.toggle("open");
      return;
    }

    if (isTopicOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const currentIndex = availableTopics.findIndex(
        (t) => t.id === selectedTopic?.id
      );
      let newIndex = currentIndex < 0 ? 0 : currentIndex;
      if (event.key === "ArrowDown") {
        newIndex = (currentIndex + 1) % availableTopics.length;
      } else {
        newIndex = (currentIndex - 1 + availableTopics.length) % availableTopics.length;
      }
      selectTopicOption(availableTopics[newIndex]);
      return;
    }

    if (!isTopicOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
      event.preventDefault();
      categoryBtnEl?.focus();
      return;
    }

    if (!isTopicOpen && event.key === "ArrowUp") {
      event.preventDefault();
      courseBtnEl?.focus();
      return;
    }
  }

  // ── CATEGORY BUTTON ────────────────────────────────────────────────────────
  if (active === categoryBtnEl) {
    if (event.key === " ") {
      event.preventDefault();
      courseMenuEl?.classList.remove("open");
      topicMenuEl?.classList.remove("open");
      categoryMenuEl.classList.toggle("open");
      return;
    }

    if (isCategoryOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const currentIndex = CATEGORIES.indexOf(selectedCategory);
      let newIndex = currentIndex;
      if (event.key === "ArrowDown") {
        newIndex = (currentIndex + 1) % CATEGORIES.length;
      } else {
        newIndex = (currentIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
      }
      selectCategoryOption(CATEGORIES[newIndex]);
      return;
    }

    if (!isCategoryOpen && (event.key === "Tab" || event.key === "ArrowDown")) {
      event.preventDefault();
      annotationInputEl?.focus();
      return;
    }

    if (!isCategoryOpen && event.key === "ArrowUp") {
      event.preventDefault();
      topicBtnEl?.focus();
      return;
    }
  }

  // ── ANNOTATION ─────────────────────────────────────────────────────────────
  if (active === annotationInputEl) {
    const isEmpty = !annotationInputEl.value;

    if ((event.shiftKey && event.key === "ArrowUp") || (isEmpty && event.key === "ArrowUp")) {
      event.preventDefault();
      categoryBtnEl?.focus();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendHighlight();
      hidePopup();
      return;
    }
  }

  // Global Enter — saves when no menus are open and annotation isn't focused
  if (
    event.key === "Enter" &&
    !isCourseOpen && !isTopicOpen && !isCategoryOpen &&
    active !== annotationInputEl
  ) {
    event.preventDefault();
    sendHighlight();
    hidePopup();
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function activateHighlighter() {
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleDocumentClick);
  document.addEventListener("keydown", handleKeyDown);
}

function deactivateHighlighter() {
  document.removeEventListener("mouseup", handleMouseUp);
  document.removeEventListener("mousedown", handleDocumentClick);
  document.removeEventListener("keydown", handleKeyDown);
  hidePopup();
}

// ---------------------------------------------------------------------------
// Popup show / hide
// ---------------------------------------------------------------------------

function positionPopup(rect) {
  if (!popupContainer) return;
  const top  = rect.bottom + window.scrollY + 8;
  const left = Math.max(10, rect.left + window.scrollX);
  popupContainer.style.top  = `${top}px`;
  popupContainer.style.left = `${left}px`;
}

function showPopup(rect, selectedText, paragraphElement) {
  if (!popupContainer) buildPopup();
  resetPopupState();

  currentSelectedText     = selectedText;
  currentParagraphElement = paragraphElement;

  positionPopup(rect);
  popupContainer.style.display = "block";

  // Focus the topic button first (it's row 2, which is the first meaningful
  // choice — course is usually already correct).
  setTimeout(() => topicBtnEl?.focus(), 50);
}

function hidePopup() {
  if (popupContainer) popupContainer.style.display = "none";
  if (courseMenuEl)   courseMenuEl.classList.remove("open");
  if (topicMenuEl)    topicMenuEl.classList.remove("open");
  if (categoryMenuEl) categoryMenuEl.classList.remove("open");

  window.getSelection()?.removeAllRanges();
  currentParagraphElement = null;
  currentSelectedText     = "";
}

function isEventInsidePopup(event) {
  return popupContainer && popupContainer.contains(event.target);
}

// ---------------------------------------------------------------------------
// Mouse handlers
// ---------------------------------------------------------------------------

function findContextElement(node) {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return null;
  return element.closest("p, li, h1, h2, h3, h4, h5, h6") || element;
}

function handleMouseUp(event) {
  if (!highlighterActive) return;
  if (popupContainer && isEventInsidePopup(event)) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const text = selection.toString().trim();
  if (text.length === 0) return;

  const range = selection.getRangeAt(0);
  const rect  = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const paragraphElement = findContextElement(selection.anchorNode);
  showPopup(rect, text, paragraphElement);
}

function handleDocumentClick(event) {
  if (!popupContainer || popupContainer.style.display === "none") return;
  if (isEventInsidePopup(event)) return;
  hidePopup();
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function sendHighlight() {
  if (!currentSelectedText) {
    console.warn("LazyNotes: Cannot send highlight — missing text");
    return;
  }

  if (!selectedTopic) {
    console.warn("LazyNotes: Cannot send highlight — no topic selected");
    return;
  }

  // Record as last used topic for this session
  lastUsedTopic = selectedTopic;

  const includeContext = contextRequiredCategories.includes(selectedCategory);

  const payload = {
    type:       "NEW_HIGHLIGHT",
    text:       currentSelectedText,
    context:    includeContext && currentParagraphElement
                  ? currentParagraphElement.textContent
                  : null,
    category:   selectedCategory,
    topicId:    selectedTopic.id,
    topicName:  selectedTopic.name,
    course:     selectedCourse?.name ?? null,
    annotation: selectedAnnotation,
    sourceUrl:  window.location.href
  };

  try {
    chrome.runtime.sendMessage(payload);
  } catch (err) {
    console.error("LazyNotes: sendMessage failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_HIGHLIGHTER") {
    highlighterActive = message.active;

    if (message.activeCourse     !== undefined) currentCourse   = message.activeCourse;
    if (message.activeCourseId   !== undefined) currentCourseId = message.activeCourseId;
    if (message.availableCourses !== undefined) availableCourses = message.availableCourses;
    if (message.availableTopics  !== undefined) availableTopics  = message.availableTopics;

    if (message.activeTopic !== undefined) {
      currentTopic  = message.activeTopic;
      lastUsedTopic = message.activeTopic;
    }

    // Clear session topic memory on highlighter off
    if (!highlighterActive) {
      currentTopic  = null;
      lastUsedTopic = null;
    }

    if (highlighterActive) activateHighlighter();
    else deactivateHighlighter();
    return;
  }

  if (message.type === "ACTIVE_COURSE_CHANGED") {
    currentCourse    = message.activeCourse    ?? currentCourse;
    currentCourseId  = message.activeCourseId  ?? currentCourseId;
    availableTopics  = message.availableTopics ?? [];
    // Course change resets topic session state
    currentTopic  = null;
    lastUsedTopic = null;
    return;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initializeScript() {
  buildPopup();

  chrome.storage.local.get(
    [
      "highlighterActive",
      "activeCourse",
      "activeCourseId",
      "activeTopic",
      "availableCourses",
      "availableTopics"
    ],
    (result) => {
      highlighterActive = result.highlighterActive ?? false;
      currentCourse     = result.activeCourse      ?? null;
      currentCourseId   = result.activeCourseId    ?? null;
      currentTopic      = result.activeTopic        ?? null;
      availableCourses  = result.availableCourses   ?? [];

      const topicsMap   = result.availableTopics    ?? {};
      availableTopics   = currentCourseId
        ? (topicsMap[String(currentCourseId)] ?? [])
        : [];

      lastUsedTopic = currentTopic;

      if (highlighterActive) activateHighlighter();
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeScript);
} else {
  initializeScript();
}
