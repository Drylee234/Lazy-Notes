// Lazy Notes — dropdowns that open on hover (side panel course/topic pickers)
//
// A native <select> can't be opened from script without a click
// (showPicker() needs a user gesture), so enhanceSelect() puts a button and
// a list in front of it. The <select> stays the source of truth, only
// visually hidden: the code that fills it, reads .value and listens for
// "change" (sidepanel.js) works unchanged. Picking an item sets .value and
// fires "change"; the button and list redraw whenever the select's options,
// value or hidden state change.
//
// Hover works like the save popup's dropdowns (content.js):
//   - resting on the button for a moment opens the list; brushing past doesn't
//   - the list stays open across the gap below the button, and closes 0.7s
//     after the mouse leaves
//   - with another list already open, hovering this one switches at once,
//     like a menu bar
//   - a click right after a hover-open keeps the list open
//   - nothing opens just because something moved under a still mouse
// While the mouse is over the list only the item under it is solid; the
// current one is tinted.
//
// Options with value "" are placeholders ("Select a course"): shown on the
// button when nothing is picked, not listed. Options whose value starts with
// "__" are actions ("+ Create Course"): listed last, after a divider.

(() => {
  const HOVER_OPEN_MS  = 500;   // rest this long to open; passing over does nothing. Click opens at once.
  const HOVER_SWITCH_MS = 300;  // moving from one open list to the next
  const HOVER_CLOSE_MS = 500;   // only for a pass-by: the mouse never went into the list
  // Once the mouse has been in the list, it behaves like a normal menu: it
  // stays open until you pick, click elsewhere, press Esc or open another.
  const CLICK_KEEPS_MS = 1000;  // a click this soon after a hover-open means "open"

  const instances = [];

  // Something just moved under a still mouse (a list closed, the panel
  // opened): pointer events at that same spot aren't hover; the first real
  // move is. Until the page has seen the mouse at all, its first position is
  // taken as the resting spot (the panel may have opened under it).
  let lastPointer  = null;
  let stillMouseAt = "first";

  document.addEventListener("pointermove", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (stillMouseAt === "first") stillMouseAt = lastPointer;
  }, true);

  function pauseHoverOpen() {
    stillMouseAt = lastPointer ?? "first";
  }

  function isStillMouse(e) {
    if (stillMouseAt === "first") stillMouseAt = { x: e.clientX, y: e.clientY };
    return Math.abs(e.clientX - stillMouseAt.x) < 1 &&
           Math.abs(e.clientY - stillMouseAt.y) < 1;
  }

  const isAction = (option) => option.value.startsWith("__");

  function enhanceSelect(select) {
    if (select.dataset.hoverSelect) return;
    select.dataset.hoverSelect = "on";

    const id = select.id || `hover-select-${instances.length}`;

    const wrap = document.createElement("div");
    wrap.className = "hs";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hs-button";
    button.id = `${id}-button`;
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    const valueEl = document.createElement("span");
    valueEl.className = "hs-value";
    valueEl.id = `${id}-value`;
    button.appendChild(valueEl);

    const list = document.createElement("ul");
    list.className = "hs-list";
    list.id = `${id}-listbox`;
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    list.hidden = true;
    button.setAttribute("aria-controls", list.id);

    // Accessible name: the <label for> if there is one, else the select's
    // aria-label, followed by the current value ("Course BIO 101").
    const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    let nameId;
    if (label) {
      if (!label.id) label.id = `${id}-label`;
      nameId = label.id;
      label.htmlFor = button.id;
      // Like a native select: clicking the label focuses, doesn't open.
      label.addEventListener("click", (e) => {
        e.preventDefault();
        button.focus();
      });
    } else {
      const name = document.createElement("span");
      name.className = "hs-sr";
      name.id = `${id}-name`;
      name.textContent = select.getAttribute("aria-label") || "";
      wrap.appendChild(name);
      nameId = name.id;
    }
    button.setAttribute("aria-labelledby", `${nameId} ${valueEl.id}`);
    list.setAttribute("aria-labelledby", nameId);

    select.before(wrap);
    wrap.append(select, button, list);
    select.classList.add("hs-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    let open = false;
    let items = [];          // [{ option, li }] in list order
    let activeIndex = -1;    // the solid one: under the mouse, or the keyboard's
    let hoverOpenedAt = 0;
    let openTimer = null;
    let closeTimer = null;
    let shutUntilLeave = false;  // closed on purpose with the mouse on it

    // ── Drawing ───────────────────────────────────────────────────────────

    function render() {
      wrap.hidden = select.hidden;
      button.disabled = select.disabled;
      if (open && (select.hidden || select.disabled)) closeList({ quiet: true });

      const options = [...select.options];
      const current = select.selectedOptions[0] ?? null;
      const shown = current && current.value !== "" ? current : null;
      const placeholder = options.find((o) => o.value === "");

      valueEl.textContent = shown?.textContent ?? placeholder?.textContent ?? "";
      button.classList.toggle("hs-button--placeholder", !shown);

      const activeValue = open ? items[activeIndex]?.option.value : undefined;

      list.replaceChildren();
      items = [];
      const choices = options.filter((o) => o.value !== "" && !isAction(o));
      const actions = options.filter(isAction);

      const addItem = (option) => {
        const li = document.createElement("li");
        li.className = "hs-option";
        li.id = `${id}-option-${items.length}`;
        li.setAttribute("role", "option");
        li.textContent = option.textContent;
        li.setAttribute("aria-selected", String(option === current));
        li.classList.toggle("is-selected", option === current);
        if (isAction(option)) li.classList.add("hs-option--action");
        if (option.disabled) li.setAttribute("aria-disabled", "true");
        items.push({ option, li });
        list.appendChild(li);
      };

      choices.forEach(addItem);
      if (choices.length && actions.length) {
        const divider = document.createElement("li");
        divider.className = "hs-divider";
        divider.setAttribute("role", "none");
        divider.setAttribute("aria-hidden", "true");
        list.appendChild(divider);
      }
      actions.forEach(addItem);

      if (open) {
        const again = items.findIndex((it) => it.option.value === activeValue);
        setActive(again >= 0 ? again : selectedIndex(), { scroll: false });
      }
    }

    function selectedIndex() {
      const i = items.findIndex((it) => it.option.selected && it.option.value !== "");
      return i >= 0 ? i : firstEnabled(0, 1);
    }

    const enabled = (i) => i >= 0 && i < items.length && !items[i].option.disabled;

    function firstEnabled(from, step) {
      for (let i = from; i >= 0 && i < items.length; i += step) if (enabled(i)) return i;
      return -1;
    }

    function setActive(i, { scroll = true } = {}) {
      activeIndex = i;
      items.forEach((it, k) => it.li.classList.toggle("is-active", k === i));
      if (i >= 0) {
        list.setAttribute("aria-activedescendant", items[i].li.id);
        if (scroll) items[i].li.scrollIntoView({ block: "nearest" });
      } else {
        list.removeAttribute("aria-activedescendant");
      }
    }

    // ── Open / close / pick ───────────────────────────────────────────────

    function openList({ byHover = false, focusList = false } = {}) {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = null;
      instances.forEach((other) => { if (other !== inst) other.close({ quiet: true }); });

      if (!open) {
        open = true;
        usedList = !byHover;   // opened by click or keyboard: a real menu from the start
        render();  // fresh from the select, in case its value changed quietly
        list.hidden = false;
        wrap.classList.add("hs--open");
        button.setAttribute("aria-expanded", "true");
        setActive(selectedIndex());
      }
      hoverOpenedAt = byHover ? performance.now() : 0;
      if (focusList) list.focus({ preventScroll: true });
    }

    // quiet: the mouse moved away or another list took over, so nothing is
    // left sitting under a still mouse. Otherwise (pick, Esc, click outside)
    // the list vanishing could leave the mouse resting on another dropdown.
    function closeList({ quiet = false, focusButton = false } = {}) {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = null;
      if (!open) return;
      open = false;
      list.hidden = true;
      wrap.classList.remove("hs--open");
      button.setAttribute("aria-expanded", "false");
      list.removeAttribute("aria-activedescendant");
      if (!quiet) pauseHoverOpen();
      if (focusButton) button.focus({ preventScroll: true });
    }

    function pick(i, { focusButton = false } = {}) {
      if (!enabled(i)) return;
      const { option } = items[i];
      closeList({ focusButton });
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // A "change" handler may have put the value back ("+ Create Course"
      // opens a form instead of selecting anything).
      render();
    }

    // ── Mouse ─────────────────────────────────────────────────────────────

    // pointermove as well as pointerenter: the mouse may already be inside
    // when it starts to count (resting here after the list above closed).
    const intent = (e) => {
      if (e.pointerType !== "mouse" || button.disabled) return;
      clearTimeout(closeTimer);
      if (open || openTimer || shutUntilLeave || isStillMouse(e)) return;

      const otherOpen = instances.some((other) => other !== inst && other.isOpen());
      openTimer = setTimeout(() => openList({ byHover: true }), otherOpen ? HOVER_SWITCH_MS : HOVER_OPEN_MS);
    };
    wrap.addEventListener("pointerenter", intent);
    wrap.addEventListener("pointermove", intent);

    wrap.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = null;
      shutUntilLeave = false;
      if (open && !usedList) closeTimer = setTimeout(() => closeList({ quiet: true }), HOVER_CLOSE_MS);
    });

    button.addEventListener("click", () => {
      if (open && performance.now() - hoverOpenedAt > CLICK_KEEPS_MS) {
        closeList({ quiet: true });
        shutUntilLeave = wrap.matches(":hover");  // or the next nudge reopens it
      } else {
        openList();
      }
    });

    let usedList = false;
    list.addEventListener("pointerenter", () => { usedList = true; });

    // The item under the mouse is the active one.
    list.addEventListener("pointermove", (e) => {
      const i = items.findIndex((it) => it.li === e.target.closest?.(".hs-option"));
      if (i !== activeIndex && enabled(i)) setActive(i, { scroll: false });
    });

    // Picking with the mouse leaves focus where it was.
    list.addEventListener("mousedown", (e) => e.preventDefault());

    list.addEventListener("click", (e) => {
      const i = items.findIndex((it) => it.li === e.target.closest?.(".hs-option"));
      if (i >= 0) pick(i, { focusButton: list.contains(document.activeElement) });
    });

    // ── Keyboard ──────────────────────────────────────────────────────────

    button.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) return;
      e.preventDefault();  // Enter/Space would also click the button
      openList({ focusList: true });
    });

    list.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = firstEnabled(activeIndex + 1, 1);
          if (next >= 0) setActive(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = firstEnabled(activeIndex - 1, -1);
          if (prev >= 0) setActive(prev);
          break;
        }
        case "Home":
          e.preventDefault();
          setActive(firstEnabled(0, 1));
          break;
        case "End":
          e.preventDefault();
          setActive(firstEnabled(items.length - 1, -1));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          pick(activeIndex, { focusButton: true });
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          closeList({ focusButton: true });
          shutUntilLeave = wrap.matches(":hover");
          break;
        case "Tab":
          closeList({ quiet: true });  // and let Tab move focus on
          break;
      }
    });

    // Focus left the dropdown some other way (e.g. a click elsewhere).
    wrap.addEventListener("focusout", (e) => {
      if (open && list.contains(e.target) && !wrap.contains(e.relatedTarget)) {
        closeList({ quiet: true });
      }
    });

    // ── Keeping up with the select ────────────────────────────────────────

    new MutationObserver(render).observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "disabled", "selected", "value", "label"]
    });
    select.addEventListener("change", render);
    select.addEventListener("input", render);

    const inst = { wrap, isOpen: () => open, close: closeList };
    instances.push(inst);
    render();
  }

  // A press anywhere else closes open lists.
  document.addEventListener("pointerdown", (e) => {
    instances.forEach((inst) => {
      if (inst.isOpen() && !inst.wrap.contains(e.target)) inst.close();
    });
  }, true);

  globalThis.enhanceSelect = enhanceSelect;

  // Side panel: the course pickers (both tabs) and the Study topic picker.
  document.addEventListener("DOMContentLoaded", () => {
    ["home-course-select", "study-course-select", "study-topic-select"].forEach((id) => {
      const select = document.getElementById(id);
      if (select) enhanceSelect(select);
    });
    pauseHoverOpen();  // the panel may have opened under a resting mouse
  });
})();
