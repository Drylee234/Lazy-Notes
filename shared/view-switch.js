// Q-notes — the view switcher in a built-in panel's title bar
// (readers' panel and the web-page panel). The title names the view you're
// in (Study / AI / Home); resting on it (~0.5s) or clicking it shows the list
// to pick from; a list opened by hovering closes 0.4s after the mouse leaves
// (same feel as the course/topic dropdowns).
// lnViewSwitch(titleEl, send) → { update({ views:[{view,name}], active }) }
//   send(view) asks the panel to show that view.
function lnViewSwitch(titleEl, send) {
  const OPEN_MS = 500, CLOSE_MS = 400;
  let views = [], active = "study", menu = null, byHover = false, tOpen = 0, tClose = 0;
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  function render() {
    const cur = views.find((v) => v.view === active);
    titleEl.textContent = cur?.name || "Study";
    titleEl.style.cursor = views.length > 1 ? "pointer" : "";
    if (views.length > 1) {
      const caret = document.createElement("span");
      caret.textContent = " ▾";
      caret.style.cssText = "opacity:.7;font-weight:400";
      titleEl.appendChild(caret);
    }
    titleEl.title = views.length > 1 ? "Switch view (rest here or click)" : "";
  }
  function close() { clearTimeout(tOpen); clearTimeout(tClose); menu?.remove(); menu = null; }
  function open(hover) {
    if (views.length < 2) return;
    clearTimeout(tClose);
    if (menu) { if (!hover) byHover = false; return; }
    byHover = hover;
    const d = dark();
    menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.style.cssText = `position:absolute;z-index:20;min-width:140px;padding:4px;border-radius:8px;
      background:${d ? "#27272a" : "#fff"};color:${d ? "#e4e4e7" : "#27272a"};border:1px solid ${d ? "#3f3f46" : "#e4e4e7"};
      box-shadow:0 8px 24px rgba(0,0,0,.22);font:500 13px system-ui,sans-serif;`;
    views.forEach((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      const on = v.view === active;
      b.textContent = (on ? "✓ " : "   ") + v.name;
      b.style.cssText = `display:block;width:100%;text-align:left;border:0;background:none;padding:6px 10px;border-radius:5px;cursor:pointer;
        font:inherit;white-space:pre;color:${on ? "#6366f1" : "inherit"};font-weight:${on ? 650 : 500};`;
      b.addEventListener("mouseenter", () => { b.style.background = d ? "#3f3f46" : "#f4f4f5"; });
      b.addEventListener("mouseleave", () => { b.style.background = "none"; });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => { e.stopPropagation(); close(); if (v.view !== active) send(v.view); });
      menu.appendChild(b);
    });
    const host = titleEl.offsetParent || titleEl.parentElement;
    menu.style.left = `${titleEl.offsetLeft}px`;
    menu.style.top = `${titleEl.offsetTop + titleEl.offsetHeight + 4}px`;
    host.appendChild(menu);
    menu.addEventListener("mouseenter", () => clearTimeout(tClose));
    menu.addEventListener("mouseleave", () => { if (byHover) tClose = setTimeout(close, CLOSE_MS); });
  }
  titleEl.addEventListener("mouseenter", () => { if (!menu) tOpen = setTimeout(() => open(true), OPEN_MS); else clearTimeout(tClose); });
  titleEl.addEventListener("mouseleave", () => { clearTimeout(tOpen); if (menu && byHover) tClose = setTimeout(close, CLOSE_MS); });
  let down = null;
  titleEl.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  // (window, not the title: the bar captures the pointer to drag the box)
  addEventListener("pointerup", (e) => {
    const d0 = down;
    down = null;
    if (!d0 || Math.hypot(e.clientX - d0[0], e.clientY - d0[1]) > 4) return;   // a drag of the bar
    clearTimeout(tOpen);
    if (menu && !byHover) close(); else open(false);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) close(); }, true);
  document.addEventListener("pointerdown", (e) => { if (menu && !e.composedPath().includes(menu) && !e.composedPath().includes(titleEl)) close(); }, true);

  return {
    update(info) {
      views = info.views || views;
      active = info.active || active;
      render();
      if (menu) { close(); }
    }
  };
}
