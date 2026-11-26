// Lazy Notes — Highlighter Content Script
// Courses and topics are plain name strings (no numeric ids — those only
// existed for the old Flask backend). All data comes from chrome.storage.local.

// Wrapped in a function so the script can be injected again into a tab that
// already ran it (see Re-injection below) without redeclaring names.
(() => {

  const REINIT_EVENT = "lazy-notes-reinit";

  const CATEGORIES = [
    "header",
    "sub topic",   // a heading inside a header's section
    "definition",
    "formula",
    "list head",
    "list point",
    "summary",
    "generic",     // a stray fact or aside: just the words, no structure
    "note"         // something urgent to remember: stands out wherever shown
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
  let currentCourse     = null;   // course name string | null
  let currentTopic      = null;   // topic name string | null — active session topic
  let courseTree        = {};     // lazynotes.courses, read straight from storage

  // Session-level: { [topicName]: lastUsedCategory }
  const sessionCategoryMemory = {};

  // Last topic used this session — default for popup on next selection.
  let lastUsedTopic = null;

  let selectedCourse     = null;   // name string | null
  let selectedTopic      = null;   // name string | null
  let selectedCategory   = CATEGORIES[0];
  let selectedAnnotation = "";

  let currentParagraphElement = null;
  let currentSelectedText     = "";
  let currentRange            = null;   // copy of the selection, for hosts that anchor notes

  // DOM refs
  let popupContainer    = null;
  let courseBtnEl       = null;
  let courseMenuEl      = null;
  let topicBtnEl        = null;
  let topicMenuEl       = null;
  let categoryBtnEl     = null;
  let whereEl           = null;
  let textEditEl        = null;
  let sideBox           = null;   // split layout: the text + annotation box
  let editGroup         = null;   // text box + annotation, moved between boxes
  let whereElHome       = null;
  let popupSide         = "above";   // above | below | left | right | split
  chrome.storage.local.get("lnPopupSide", (r) => { if (r?.lnPopupSide) popupSide = r.lnPopupSide; });
  const inPopup = (el) => !!el && ((popupContainer && popupContainer.contains(el)) || (sideBox && sideBox.contains(el)));
  let popupAnchor       = null;   // the selection's box in page coordinates
  let popupMouse        = null;   // where the mouse let go (page coordinates)

  function fitTextEdit() {
    if (!textEditEl) return;
    textEditEl.style.height = "auto";
    const h = Math.min(textEditEl.scrollHeight + 2, 110);
    textEditEl.style.height = `${h}px`;
    textEditEl.style.overflowY = textEditEl.scrollHeight + 2 > 110 ? "auto" : "hidden";
  }
  let categoryMenuEl    = null;
  let annotationInputEl = null;

  // ---------------------------------------------------------------------------
  // Data helpers
  // ---------------------------------------------------------------------------

  function courseNames() {
    return Object.keys(courseTree);
  }

  function topicNamesFor(courseName) {
    if (!courseName || !courseTree[courseName]) return [];
    return Object.keys(courseTree[courseName].topics || {});
  }

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

      .lazy-notes-popup-side { width: 260px; min-width: 0; }
      .lazy-notes-popup-side .lazy-notes-text-edit { margin-bottom: 8px; }
      .lazy-notes-fold { cursor: pointer; color: #a1a1aa; user-select: none; margin-bottom: 0 !important; }
      .lazy-notes-fold:hover, .lazy-notes-fold:focus-visible { color: #f0f0f0; outline: none; }
      .lazy-notes-annotation-row:not(.open) .lazy-notes-textarea { display: none; }
      .lazy-notes-annotation-row.open .lazy-notes-fold { margin-bottom: 6px !important; }
      .lazy-notes-text-edit {
        margin: 0 0 10px; resize: none; line-height: 1.4; font-size: 12.5px;
        border-left: 3px solid #fde047 !important; color: #f0f0f0;
      }
      .lazy-notes-where {
        margin: 0 0 10px; font-size: 11.5px; color: #a1a1aa;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .lazy-notes-where.none { color: #ef6461; white-space: normal; }
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
        max-height: 280px;   /* all nine types without scrolling */
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

      /* While the mouse is over a list only the hovered item is solid, so it's
         clear which one a click picks; the current one is just tinted. */
      .lazy-notes-dropdown-menu:hover .lazy-notes-dropdown-item.focused:not(:hover) {
        background-color: rgba(79, 70, 229, 0.3);
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
      clickDropdown(courseMenu);
    });

    row1.appendChild(courseBtn);
    row1.appendChild(courseMenu);
    // Course and topic are picked in the side panel now (and each document
    // remembers its own), so these rows are hidden, not removed: a single
    // "Saving to …" line shows where the note goes instead.
    row1.style.display = "none";
    const where = document.createElement("div");
    where.className = "lazy-notes-where";
    container.appendChild(where);
    whereEl = where;

    // The highlighted words, editable: trim them, fix a typo or a broken
    // line break before saving. Enter saves, Shift+Enter is a new line.
    const textEdit = document.createElement("textarea");
    textEdit.className = "lazy-notes-textarea lazy-notes-text-edit";
    textEdit.rows = 2;
    textEdit.spellcheck = true;
    textEdit.setAttribute("aria-label", "Highlighted text (you can edit it)");
    textEdit.title = "You can edit this before saving";
    textEdit.addEventListener("input", () => {
      currentSelectedText = textEdit.value;
      fitTextEdit();
      if (popupAnchor) positionPopup();
    });
    container.appendChild(textEdit);
    textEditEl = textEdit;

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
      clickDropdown(topicMenu);
    });

    row2.appendChild(topicBtn);
    row2.appendChild(topicMenu);
    row2.style.display = "none";
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
      clickDropdown(categoryMenu);
    });

    row3.appendChild(categoryBtn);
    row3.appendChild(categoryMenu);
    container.appendChild(row3);

    // ── ROW 4: Annotation ─────────────────────────────────────────────────────
    const row4 = document.createElement("div");
    row4.className = "lazy-notes-popup-row";

    const annotationLabel = document.createElement("span");
    // Minimized until wanted: "Annotation ›" opens the box.
    annotationLabel.className = "lazy-notes-popup-label-block lazy-notes-fold";
    annotationLabel.textContent = "Annotation ›";
    annotationLabel.tabIndex = 0;
    annotationLabel.setAttribute("role", "button");
    const openAnnotation = (e) => {
      e?.preventDefault();
      row4.classList.add("open");
      annotationLabel.textContent = "Annotation";
      annotationInputEl?.focus();
      if (popupAnchor) positionPopup();
    };
    annotationLabel.addEventListener("click", openAnnotation);
    annotationLabel.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); openAnnotation(e); } });
    row4.appendChild(annotationLabel);
    row4.classList.add("lazy-notes-annotation-row");

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
      if (popupAnchor) positionPopup();
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

    // The editable text with its annotation under it, as one group that the
    // split layout moves into a box of its own.
    const group = document.createElement("div");
    group.className = "lazy-notes-edit-group";
    textEdit.replaceWith(group);
    group.append(textEdit, row4);
    editGroup = group;

    const side = document.createElement("div");
    side.className = "lazy-notes-popup lazy-notes-popup-side";
    side.style.display = "none";
    sideBox = side;

    (document.body || document.documentElement).appendChild(container);
    (document.body || document.documentElement).appendChild(side);

    popupContainer    = container;
    courseBtnEl       = courseBtn;
    courseMenuEl      = courseMenu;
    topicBtnEl        = topicBtn;
    topicMenuEl       = topicMenu;
    categoryBtnEl     = categoryBtn;
    categoryMenuEl    = categoryMenu;
    annotationInputEl = annotationInput;

    openOnHover(row1, courseMenu);
    openOnHover(row2, topicMenu);
    openOnHover(row3, categoryMenu);

    // Picking an item closes its list, which can leave the mouse resting on
    // another dropdown: don't pop that one open. (Capture: items stop the
    // click from bubbling.)
    container.addEventListener("click", (e) => {
      if (e.target.closest?.(".lazy-notes-dropdown-item")) pauseHoverOpen(e);
    }, true);

    // Clicking a list item mustn't take keyboard focus out of the popup (list
    // items can't hold focus, so it would fall to the page): Enter has to
    // keep saving after picking with the mouse.
    [courseMenu, topicMenu, categoryMenu].forEach((menu) =>
      menu.addEventListener("mousedown", (e) => e.preventDefault())
    );
  }

  // ---------------------------------------------------------------------------
  // Dropdowns open on click, and when the mouse rests on them
  // ---------------------------------------------------------------------------
  // Opening waits a moment, so brushing past a button on the way to another
  // doesn't open it; closing waits a moment, so crossing the gap between a
  // button and its list doesn't close it. Each row (label + button + list)
  // is one hover area. Labels sit left of the lists, so an open list never
  // covers them: hovering a label is how to get past an open list.

  const HOVER_OPEN_MS  = 500;   // rest this long to open; passing over does nothing. Click opens at once.
  const HOVER_SWITCH_MS = 300;  // moving from one open list to the next
  const HOVER_CLOSE_MS = 400;   // hover-opened lists close this long after the mouse leaves

  // Something just moved under a still mouse (the popup appeared, a list
  // closed after a pick): events at that same spot aren't hover. The first
  // real move is.
  let stillMouseAt = null;

  function pauseHoverOpen(e) {
    stillMouseAt = { x: e.clientX, y: e.clientY };
  }

  function isStillMouse(e) {
    return !!stillMouseAt &&
      Math.abs(e.clientX - stillMouseAt.x) < 1 &&
      Math.abs(e.clientY - stillMouseAt.y) < 1;
  }

  // Closed on purpose (click, Esc) with the mouse on it: stays shut until the
  // mouse leaves the row, or the next nudge would open it straight back up.
  function shutMenu(menu) {
    menu.classList.remove("open");
    if (menu.parentElement?.matches(":hover")) menu.dataset.shutUntilLeave = "1";
  }

  function allMenus() {
    return [courseMenuEl, topicMenuEl, categoryMenuEl].filter(Boolean);
  }

  function openMenu(menu, { byHover = false } = {}) {
    if (byHover) delete menu.dataset.used; else menu.dataset.used = "1";
    allMenus().forEach((m) => m.classList.toggle("open", m === menu));
    menu.dataset.hoverOpenedAt = byHover ? String(performance.now()) : "";
  }

  function clickDropdown(menu) {
    // A click just after hover opened the list means "open", not "close".
    const justHoverOpened =
      performance.now() - Number(menu.dataset.hoverOpenedAt || 0) < 1000;

    if (menu.classList.contains("open") && !justHoverOpened) {
      shutMenu(menu);
    } else {
      openMenu(menu);
    }
  }

  function openOnHover(row, menu) {
    let openTimer  = null;
    let closeTimer = null;

    // pointermove as well as pointerenter: the mouse may already be inside
    // the row when it starts to count (resting there after a list closed).
    const intent = (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(closeTimer);
      if (openTimer || menu.classList.contains("open")) return;
      if (menu.dataset.shutUntilLeave || isStillMouse(e)) return;

      // With another list already open, switch at once, like a menu bar.
      const otherOpen = allMenus().some((m) => m !== menu && m.classList.contains("open"));
      openTimer = setTimeout(() => {
        openTimer = null;
        delete menu.dataset.used;
        openMenu(menu, { byHover: true });
      }, otherOpen ? HOVER_SWITCH_MS : HOVER_OPEN_MS);
    };

    row.addEventListener("pointerenter", intent);
    row.addEventListener("pointermove", intent);

    row.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(openTimer);
      openTimer = null;
      delete menu.dataset.shutUntilLeave;
      clearTimeout(closeTimer);
      // Opened by hover: closes when the mouse leaves. Opened by a click
      // (dataset.used): stays until a pick, a click elsewhere or Esc.
      if (menu.dataset.used) return;
      closeTimer = setTimeout(() => menu.classList.remove("open"), HOVER_CLOSE_MS);
    });
  }

  // ---------------------------------------------------------------------------
  // Option selection helpers (course/topic are plain name strings)
  // ---------------------------------------------------------------------------

  function selectCourseOption(courseName) {
    selectedCourse = courseName;

    if (courseBtnEl) courseBtnEl.textContent = courseName || "No courses";

    if (courseMenuEl) {
      courseMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
        item.classList.toggle("focused", item.dataset.value === courseName);
      });
    }

    const topics = topicNamesFor(courseName);
    populateTopicOptions(topics);

    const restored = lastUsedTopic && topics.includes(lastUsedTopic)
      ? lastUsedTopic
      : (topics[0] ?? null);

    selectTopicOption(restored);
  }

  function selectTopicOption(topicName) {
    selectedTopic = topicName;

    if (topicBtnEl) {
      topicBtnEl.textContent = topicName || "No topics";
    }

    if (topicMenuEl) {
      topicMenuEl.querySelectorAll(".lazy-notes-dropdown-item").forEach((item) => {
        item.classList.toggle("focused", topicName !== null && item.dataset.value === topicName);
      });
    }

    if (topicName) {
      const remembered = sessionCategoryMemory[topicName];
      selectCategoryOption(remembered || CATEGORIES[0]);
    }
  }

  function selectCategoryOption(cat) {
    selectedCategory = cat;

    if (selectedTopic) {
      sessionCategoryMemory[selectedTopic] = cat;
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

    courseNames().forEach((name) => {
      const item = document.createElement("div");
      item.className = "lazy-notes-dropdown-item";
      item.dataset.value = name;
      item.textContent = name;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCourseOption(name);
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

    topics.forEach((name) => {
      const item = document.createElement("div");
      item.className = "lazy-notes-dropdown-item";
      item.dataset.value = name;
      item.textContent = name;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectTopicOption(name);
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

    const names = courseNames();
    const defaultCourse = (currentCourse && names.includes(currentCourse))
      ? currentCourse
      : (names[0] ?? null);

    selectCourseOption(defaultCourse);

    allMenus().forEach((m) => {
      m.classList.remove("open");
      delete m.dataset.shutUntilLeave;
    });

    const annRow = popupContainer?.ownerDocument.querySelector(".lazy-notes-annotation-row");
    if (annRow) { annRow.classList.remove("open"); annRow.querySelector(".lazy-notes-fold").textContent = "Annotation ›"; }
    if (annotationInputEl) {
      annotationInputEl.value = "";
      annotationInputEl.style.height = "32px";
    }

    if (popupContainer) popupContainer.style.width = "280px";
    if (whereEl) {
      whereEl.textContent = selectedCourse && selectedTopic
        ? `Saving to ${selectedCourse} › ${selectedTopic}`
        : "Pick a course and topic in the Lazy Notes side panel first";
      whereEl.classList.toggle("none", !(selectedCourse && selectedTopic));
      // Only shown when something's missing; the side panel says where notes go.
      whereEl.style.display = selectedCourse && selectedTopic ? "none" : "";
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  function handleKeyDown(event) {
    if (shutDownIfOrphaned()) return;
    if (!popupContainer || popupContainer.style.display === "none") return;

    const active          = document.activeElement;
    const isCourseOpen    = courseMenuEl?.classList.contains("open");
    const isTopicOpen     = topicMenuEl?.classList.contains("open");
    const isCategoryOpen  = categoryMenuEl?.classList.contains("open");

    if (event.key === "Escape") {
      event.preventDefault();
      if (isCourseOpen)   shutMenu(courseMenuEl);
      else if (isTopicOpen)    shutMenu(topicMenuEl);
      else if (isCategoryOpen) shutMenu(categoryMenuEl);
      else hidePopup();
      return;
    }

    // ── COURSE BUTTON ──────────────────────────────────────────────────────────
    if (active === courseBtnEl) {
      const names = courseNames();

      if (event.key === " ") {
        event.preventDefault();
        topicMenuEl?.classList.remove("open");
        categoryMenuEl?.classList.remove("open");
        courseMenuEl.classList.toggle("open");
        return;
      }

      if (isCourseOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && names.length > 0) {
        event.preventDefault();
        const currentIndex = names.indexOf(selectedCourse);
        let newIndex = currentIndex < 0 ? 0 : currentIndex;
        if (event.key === "ArrowDown") newIndex = (newIndex + 1) % names.length;
        else newIndex = (newIndex - 1 + names.length) % names.length;
        selectCourseOption(names[newIndex]);
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
      const topics = topicNamesFor(selectedCourse);

      if (event.key === " ") {
        event.preventDefault();
        courseMenuEl?.classList.remove("open");
        categoryMenuEl?.classList.remove("open");
        topicMenuEl.classList.toggle("open");
        return;
      }

      if (isTopicOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && topics.length > 0) {
        event.preventDefault();
        const currentIndex = topics.indexOf(selectedTopic);
        let newIndex = currentIndex < 0 ? 0 : currentIndex;
        if (event.key === "ArrowDown") newIndex = (newIndex + 1) % topics.length;
        else newIndex = (newIndex - 1 + topics.length) % topics.length;
        selectTopicOption(topics[newIndex]);
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
        if (event.key === "ArrowDown") newIndex = (currentIndex + 1) % CATEGORIES.length;
        else newIndex = (currentIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
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

    // Only save on Enter when focus is inside the popup — otherwise pressing
    // Enter in a page form while the popup is open would save a note. An open
    // list doesn't stop it (arrow keys already applied the pick, and a list
    // opened by hovering isn't being used); a focused Save or Dismiss button
    // keeps its own Enter, so Enter on Dismiss dismisses.
    if (
      event.key === "Enter" &&
      active !== annotationInputEl &&
      !(active === textEditEl && event.shiftKey) &&
      !active?.classList?.contains("lazy-notes-btn") &&
      inPopup(active)
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
    if (dead) return;
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mouseup", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
  }

  function deactivateHighlighter() {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mouseup", handleDocumentClick);
    document.removeEventListener("keydown", handleKeyDown);
    hidePopup();
  }

  // ---------------------------------------------------------------------------
  // Popup show / hide
  // ---------------------------------------------------------------------------

  // Where the pop-up sits around the selection, from the side panel's ⚙
  // ("lnPopupSide"): above (default), below, left, right, or split (the
  // text box on the left, type + Save on the right). A side without room
  // falls back to above/below. Re-run when the pop-up grows.
  function positionPopup(rect) {
    if (!popupContainer) return;
    if (rect) {
      popupAnchor = { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY,
                      left: rect.left + window.scrollX, right: rect.right + window.scrollX };
    }
    const a = popupAnchor;
    if (!a) return;
    const vx = window.scrollX, vy = window.scrollY;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const GAP = 10;
    const place = (el, left, top) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = `${Math.max(vx + 8, Math.min(left, vx + vw - w - 8))}px`;
      el.style.top  = `${Math.max(vy + 8, Math.min(top, vy + vh - h - 8))}px`;
    };
    const vertical = (el, prefer) => {
      const h = el.offsetHeight;
      const roomAbove = a.top - vy - GAP >= h;
      const roomBelow = vy + vh - a.bottom - GAP >= h;
      const above = prefer === "above" ? (roomAbove || !roomBelow) : (!roomBelow && roomAbove);
      place(el, a.left, above ? a.top - h - GAP : a.bottom + GAP);
    };
    const fitsLeft  = (el) => a.left - vx - GAP - el.offsetWidth >= 8;
    const fitsRight = (el) => vx + vw - a.right - GAP - el.offsetWidth >= 8;

    const mode = popupSide;
    // Split: the two boxes either side of where the mouse let go, so
    // neither needs a long trip. Without room on both sides: one above the
    // mouse, one below.
    if (mode === "split" && popupMouse) {
      const m = popupMouse, sw = sideBox.offsetWidth, cw = popupContainer.offsetWidth;
      const top = (el) => m.y - Math.min(40, el.offsetHeight / 2);
      if (m.x - vx - 16 - sw >= 8 && vx + vw - m.x - 16 - cw >= 8) {
        place(sideBox, m.x - 16 - sw, top(sideBox));
        place(popupContainer, m.x + 16, top(popupContainer));
      } else {
        place(sideBox, m.x - sw / 2, m.y - sideBox.offsetHeight - 16);
        place(popupContainer, m.x - cw / 2, m.y + 16);
      }
      return;
    }
    if (mode === "split") {
      if (fitsLeft(sideBox) && fitsRight(popupContainer)) {
        place(sideBox, a.left - sideBox.offsetWidth - GAP, a.top - 8);
        place(popupContainer, a.right + GAP, a.top - 8);
      } else {
        vertical(sideBox, "above");
        vertical(popupContainer, "below");
      }
      return;
    }
    if (mode === "left" && fitsLeft(popupContainer)) return place(popupContainer, a.left - popupContainer.offsetWidth - GAP, a.top - 8);
    if (mode === "right" && fitsRight(popupContainer)) return place(popupContainer, a.right + GAP, a.top - 8);
    vertical(popupContainer, mode === "below" ? "below" : "above");
  }

  // Split layout: the text box group lives in its own box; otherwise it sits
  // in the main pop-up under "Saving to".
  function arrangePopup() {
    if (!editGroup || !sideBox) return;
    const where = popupContainer.querySelector(".lazy-notes-where");
    if (popupSide === "split") {
      if (editGroup.parentNode !== sideBox) sideBox.appendChild(editGroup);
      sideBox.style.display = "block";
    } else {
      if (editGroup.parentNode !== popupContainer) where.after(editGroup);
      sideBox.style.display = "none";
    }
  }

  function showPopup(rect, selectedText, paragraphElement) {
    if (!popupContainer) buildPopup();
    resetPopupState();

    currentSelectedText     = selectedText;
    currentParagraphElement = paragraphElement;

    popupContainer.style.display = "block";
    arrangePopup();
    if (textEditEl) { textEditEl.value = selectedText; fitTextEdit(); }
    positionPopup(rect);

    setTimeout(() => categoryBtnEl?.focus(), 50);
  }

  function hidePopup() {
    if (popupContainer) popupContainer.style.display = "none";
    if (sideBox) sideBox.style.display = "none";
    if (courseMenuEl)   courseMenuEl.classList.remove("open");
    if (topicMenuEl)    topicMenuEl.classList.remove("open");
    if (categoryMenuEl) categoryMenuEl.classList.remove("open");

    window.getSelection()?.removeAllRanges();
    currentParagraphElement = null;
    currentSelectedText     = "";
    currentRange            = null;
    popupAnchor             = null;
    popupMouse              = null;
  }

  function isEventInsidePopup(event) {
    return inPopup(event.target);
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
    if (shutDownIfOrphaned()) return;
    if (!highlighterActive) return;
    if (popupContainer && isEventInsidePopup(event)) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (text.length === 0) return;

    const range = selection.getRangeAt(0);
    currentRange = range.cloneRange();
    const rect  = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const paragraphElement = findContextElement(selection.anchorNode);
    popupMouse = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
    showPopup(rect, text, paragraphElement);
    pauseHoverOpen(event);   // the popup may have appeared under the mouse
  }

  function handleDocumentClick(event) {
    if (!popupContainer || popupContainer.style.display === "none") return;
    if (isEventInsidePopup(event)) return;
    // If this mouseup produced a non-empty selection, handleMouseUp (which runs
    // first) just showed the popup — don't immediately dismiss it.
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    hidePopup();
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  function sendHighlight() {
    currentSelectedText = String(currentSelectedText ?? "").trim();
    if (!currentSelectedText) {
      console.warn("LazyNotes: Cannot send highlight — missing text");
      return;
    }

    if (!selectedTopic || !selectedCourse) {
      console.warn("LazyNotes: Cannot send highlight — no course/topic selected");
      return;
    }

    lastUsedTopic = selectedTopic;

    const includeContext = contextRequiredCategories.includes(selectedCategory);

    // An extension page that loads this script (the PDF reader) can set
    // globalThis.LazyNotesHost to supply a better source link and context.
    // Real content scripts run in an isolated world, so web pages can't.
    const host = globalThis.LazyNotesHost;
    const context = !includeContext ? null
      : host?.contextFor ? host.contextFor(currentParagraphElement)
      : currentParagraphElement?.textContent ?? null;

    const payload = {
      type:       "NEW_HIGHLIGHT",
      id:         crypto.randomUUID(),
      text:       currentSelectedText,
      context,
      category:   selectedCategory,
      course:     selectedCourse,
      topic:      selectedTopic,
      annotation: selectedAnnotation,
      sourceUrl:  host?.sourceUrl ? host.sourceUrl(currentParagraphElement) : window.location.href,
      sourceTitle: host?.sourceTitle ? host.sourceTitle(currentParagraphElement) : document.title || null,
      anchor:     host?.anchorFor ? host.anchorFor(currentRange) : null
    };

    try {
      chrome.runtime.sendMessage(payload);
    } catch (err) {
      console.error("LazyNotes: sendMessage failed:", err);
      return;
    }
    showUndoToast(payload);
  }

  // ---------------------------------------------------------------------------
  // Undo — a few seconds to take back a highlight saved by mistake
  // ---------------------------------------------------------------------------
  // The highlight is saved at once (closing the tab can't lose it); Undo, or
  // Ctrl/⌘+Z while the toast shows, deletes it again. Hovering the toast
  // pauses the countdown. A newer save replaces the toast.

  const UNDO_MS = 6000;
  let undoToast = null;   // { host, cancel }

  function showUndoToast(saved) {
    undoToast?.cancel();

    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; }
        .toast {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 12px;
          padding: 10px 10px 10px 14px;
          background: #1e1e24; color: #f0f0f0;
          border: 1px solid #33333d; border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
          font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .msg { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button {
          all: unset; cursor: pointer; padding: 5px 10px; border-radius: 5px;
          background: #4f46e5; color: #fff; font-weight: 600; font-size: 12px;
        }
        button:hover { background: #4338ca; }
        button:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }
        .bar { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: #4f46e5;
               transform-origin: left; animation: run ${UNDO_MS}ms linear forwards; }
        .toast:hover .bar { animation-play-state: paused; }
        @keyframes run { to { transform: scaleX(0); } }
        @media (prefers-reduced-motion: reduce) { .bar { animation: none; opacity: 0; } }
      </style>
      <div class="toast" role="status">
        <span class="msg"></span>
        <button type="button" title="Undo (Ctrl+Z)">Undo</button>
        <div class="bar"></div>
      </div>`;
    root.querySelector(".msg").textContent = `Saved to ${saved.course} › ${saved.topic}`;

    // Countdown that pauses while hovered (the bar pauses with it).
    let left = UNDO_MS, startedAt = Date.now(), timer = setTimeout(close, left);
    const toast = root.querySelector(".toast");
    toast.addEventListener("mouseenter", () => { clearTimeout(timer); left -= Date.now() - startedAt; });
    toast.addEventListener("mouseleave", () => { startedAt = Date.now(); timer = setTimeout(close, Math.max(left, 800)); });

    function close() {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      if (undoToast?.host === host) undoToast = null;
    }

    function undo() {
      close();
      try {
        chrome.runtime.sendMessage({ type: "DELETE_HIGHLIGHT", id: saved.id, courseName: saved.course, topicName: saved.topic });
      } catch (_) { /* extension reloaded: nothing to reach */ }
    }

    // Ctrl/⌘+Z undoes, unless the page's own undo is wanted (typing somewhere).
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = document.activeElement;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      undo();
    }

    root.querySelector("button").addEventListener("click", undo);
    document.addEventListener("keydown", onKey, true);
    (document.body || document.documentElement).appendChild(host);
    undoToast = { host, cancel: close };
  }

  // ---------------------------------------------------------------------------
  // Drag to the side panel
  // ---------------------------------------------------------------------------
  // Selected text dropped on the side panel's Study tab is saved like a
  // highlight. A drop only carries the text, so note where it came from in
  // storage ("lastDrag"): the panel can read that whichever site the text was
  // dragged from, and matches it to the dropped text.

  function handleDragStart(event) {
    if (dead || shutDownIfOrphaned()) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || selection.rangeCount === 0) return;

    // Dragging the selection itself, not a link or image somewhere else.
    if (event.dataTransfer?.types?.includes("text/uri-list")) return;
    const range = selection.getRangeAt(0);
    if (!(event.target instanceof Node) || !range.intersectsNode(event.target)) return;

    const el   = findContextElement(selection.anchorNode);
    const host = globalThis.LazyNotesHost;
    const lastDrag = {
      text,
      sourceUrl:   host?.sourceUrl   ? host.sourceUrl(el)   : window.location.href,
      sourceTitle: host?.sourceTitle ? host.sourceTitle(el) : document.title || null,
      context:     host?.contextFor  ? host.contextFor(el)  : el?.textContent ?? null,
      anchor:      host?.anchorFor   ? host.anchorFor(range) : null,
      at:          Date.now()
    };

    try {
      chrome.storage.local.set({ lastDrag });
    } catch (_) { /* extension reloaded: the panel falls back to the bare text */ }

    // The save popup for this selection would be left behind; hide it but
    // keep the selection, since that's what is being dragged.
    if (popupContainer && popupContainer.style.display !== "none") {
      popupContainer.style.display = "none";
      if (sideBox) sideBox.style.display = "none";
      allMenus().forEach((m) => m.classList.remove("open"));
    }
  }

  document.addEventListener("dragstart", handleDragStart, true);

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (dead) return;
    if (message.type === "LAZY_NOTES_PING") {
      sendResponse(true);
      return;
    }

    if (message.type === "TOGGLE_HIGHLIGHTER") {
      highlighterActive = message.active;

      if (message.activeCourse !== undefined) currentCourse = message.activeCourse;
      if (message.activeTopic  !== undefined) {
        currentTopic  = message.activeTopic;
        lastUsedTopic = message.activeTopic;
      }

      if (!highlighterActive) {
        currentTopic  = null;
        lastUsedTopic = null;
      }

      if (highlighterActive) activateHighlighter();
      else deactivateHighlighter();
      return;
    }

    if (message.type === "ACTIVE_COURSE_CHANGED") {
      currentCourse = message.activeCourse ?? currentCourse;
      currentTopic  = null;
      lastUsedTopic = null;
      return;
    }
  });

  // ---------------------------------------------------------------------------
  // Storage sync — keep courseTree fresh without background having to push it
  // ---------------------------------------------------------------------------

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (dead) return;
    if (areaName !== "local") return;
    if (changes.lazynotes) {
      courseTree = changes.lazynotes.newValue?.courses || {};
    }
    if (changes.lnPopupSide) popupSide = changes.lnPopupSide.newValue || "above";

    // Storage is the source of truth for on/off: extension pages (the PDF
    // reader) never get the background's tab broadcasts, and this also covers
    // a broadcast that was missed.
    if (changes.activeCourse) currentCourse = changes.activeCourse.newValue ?? null;
    if (changes.activeTopic) {
      currentTopic  = changes.activeTopic.newValue ?? null;
      lastUsedTopic = currentTopic;
    }
    if (changes.highlighterActive) {
      highlighterActive = changes.highlighterActive.newValue ?? false;
      if (highlighterActive) activateHighlighter();
      else deactivateHighlighter();
    }
  });

  // ---------------------------------------------------------------------------
  // Re-injection
  // ---------------------------------------------------------------------------
  // When the extension is reloaded, the copy already running in an open tab is
  // cut off from it (saves would fail) and the background injects a fresh copy.
  // The new copy tells the old one to remove itself; the old one also checks
  // on each mouseup/keydown in case it never got the signal.

  const instanceId = crypto.randomUUID();
  let dead = false;  // set once this copy has been replaced; every entry point checks it

  function tearDown() {
    dead = true;
    deactivateHighlighter();
    popupContainer?.remove();
    popupContainer = null;
    sideBox?.remove();
    sideBox = null;
    document.removeEventListener(REINIT_EVENT, onReinit);
  }

  function shutDownIfOrphaned() {
    if (chrome.runtime?.id) return false;
    tearDown();
    return true;
  }

  function onReinit(event) {
    if (event.detail !== instanceId) tearDown();
  }

  document.addEventListener(REINIT_EVENT, onReinit);
  document.dispatchEvent(new CustomEvent(REINIT_EVENT, { detail: instanceId }));

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function initializeScript() {
    if (dead) return;
    buildPopup();

    chrome.storage.local.get(
      ["lazynotes", "highlighterActive", "activeCourse", "activeTopic"],
      (result) => {
        courseTree       = result.lazynotes?.courses ?? {};
        highlighterActive = result.highlighterActive ?? false;
        currentCourse     = result.activeCourse ?? null;
        currentTopic      = result.activeTopic ?? null;
        lastUsedTopic     = currentTopic;

        if (highlighterActive) activateHighlighter();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeScript);
  } else {
    initializeScript();
  }

})();
