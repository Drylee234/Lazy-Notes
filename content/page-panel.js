// QNotes — our own side panel on web pages (instead of Chrome's).
// The same sidepanel.html as the readers' built-in panel, in an iframe.
// Two looks (Settings › More options › Panel on web pages):
//   docked   — on the right edge, the page makes room for it
//   floating — a box over the page: drag the title bar, resize any edge,
//              fold with −, fades while the mouse is away (like the readers)
// The title bar names the view (Study / AI); click it to switch.
// Opened by the toolbar button, Alt+Shift+L, Ctrl/⌘+. (also jumps into the
// note box), or by a page's ✎ Note / ❝ Quote.
(() => {
  if (window.top !== window || window.__lnPagePanel) return;
  window.__lnPagePanel = true;

  const OPEN_KEY = "ln-page-panel-open";
  const MIN_W = 300, MIN_H = 200;
  const EXT = chrome.runtime.getURL("").replace(/\/$/, "");
  let host = null, frame = null, root = null, wrap = null;
  let on = true, floating = false, fade = true;
  let dockW = 380;
  let fl = { x: null, y: null, w: 360, h: null, folded: false };
  let loaded = false, pending = [], viewSwitch = null;

  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} }
  };

  chrome.storage.local.get(["lnPageDockW", "lnPagePanelOwn", "lnPagePanelMode", "lnPageFloat", "lnPanelFade"], (r) => {
    dockW = Math.max(MIN_W, Math.min(r?.lnPageDockW || 380, Math.floor(innerWidth * 0.6)));
    on = r?.lnPagePanelOwn !== false;
    floating = r?.lnPagePanelMode === "float";
    fade = r?.lnPanelFade !== false;
    if (r?.lnPageFloat) fl = { ...fl, ...r.lnPageFloat };
    if (store.get(OPEN_KEY) === "1" && on) build();
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== "local") return;
    if ("lnPagePanelOwn" in c) { on = c.lnPagePanelOwn.newValue !== false; if (!on) close(); }
    if ("lnPanelFade" in c) { fade = c.lnPanelFade.newValue !== false; wrap?.classList.toggle("fade", fade && floating); }
    if ("lnPagePanelMode" in c) {
      floating = c.lnPagePanelMode.newValue === "float";
      if (host) { close(); build(); }
    }
  });

  // Hover settings shared with the readers' panel (Settings › More options).
  const hover = { on: true, openMs: 300, closeMs: 700 };
  const num = (v, d) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);
  chrome.storage.local.get(["lnPanelHover", "lnPanelHoverMs", "lnPanelHoverCloseMs"], (r) => {
    hover.on = r?.lnPanelHover !== false; hover.openMs = num(r?.lnPanelHoverMs, 300); hover.closeMs = num(r?.lnPanelHoverCloseMs, 700);
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== "local") return;
    if ("lnPanelHover" in c) hover.on = c.lnPanelHover.newValue !== false;
    if ("lnPanelHoverMs" in c) hover.openMs = num(c.lnPanelHoverMs.newValue, 300);
    if ("lnPanelHoverCloseMs" in c) hover.closeMs = num(c.lnPanelHoverCloseMs.newValue, 700);
  });

  const isOpen = () => !!host;
  const saveFloat = () => chrome.storage.local.set({ lnPageFloat: fl });

  function room(w) {
    const de = document.documentElement;
    if (w) {
      de.style.setProperty("width", `calc(100% - ${w}px)`, "important");
      de.style.setProperty("position", "relative", "important");
    } else {
      de.style.removeProperty("width");
      de.style.removeProperty("position");
    }
  }

  // Where the floating box sits (kept on screen).
  function placeFloat() {
    const w = Math.min(Math.max(fl.w || 360, MIN_W), innerWidth - 16);
    const h = Math.min(Math.max(fl.h || Math.round(innerHeight * 0.62), MIN_H), innerHeight - 16);
    const x = Math.min(Math.max(fl.x ?? innerWidth - w - 24, 8 - w + 80), innerWidth - 80);
    const y = Math.min(Math.max(fl.y ?? 64, 0), innerHeight - 32);
    Object.assign(wrap.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: fl.folded ? "auto" : `${h}px`, right: "auto", bottom: "auto" });
  }

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "lazy-notes-page-panel";
    host.style.cssText = "all:initial;position:fixed;top:0;right:0;width:0;height:0;z-index:2147483646;";
    root = host.attachShadow({ mode: "open" });   // open: the view switcher needs composedPath()
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; display: flex; flex-direction: column; background: #fff; font: 13px system-ui, sans-serif;
          border: 1px solid #d4d4d8; color-scheme: light dark; }
        .wrap.dock { top: 0; right: 0; bottom: 0; border-width: 0 0 0 1px; box-shadow: -6px 0 24px rgba(0,0,0,.14); }
        .wrap.float { border-radius: 10px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
        .wrap.float.fade { opacity: .45; transition: opacity .18s; }
        .wrap.float.fade:hover, .wrap.float.fade.active, .wrap.float.fade.busy { opacity: 1; }
        @media (prefers-color-scheme: dark) { .wrap { background: #18181b; border-color: #3f3f46; } }
        .bar { position: relative; display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 12px; background: #6366f1; color: #fff; flex: none; font-weight: 600; user-select: none; }
        .dock .bar { background: #f4f4f5; color: #3f3f46; }
        @media (prefers-color-scheme: dark) { .dock .bar { background: #27272a; color: #e4e4e7; } }
        .float .bar { cursor: grab; }
        .busy .bar { cursor: grabbing; }
        .title { flex: 1; }
        .bar button { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 1px 8px; border-radius: 6px; opacity: .85; }
        .bar button:hover { background: rgba(127,127,127,.25); opacity: 1; }
        .fold { display: none; font-size: 17px; line-height: 1; }
        .float .fold { display: inline-block; }
        iframe { flex: 1; border: 0; width: 100%; background: transparent; color-scheme: light dark; }
        .folded iframe, .folded .rz { display: none; }
        .busy iframe { pointer-events: none; }
        .rz { position: absolute; z-index: 3; touch-action: none; display: none; }
        .float .rz { display: block; }
        .n, .s { left: 10px; right: 10px; height: 7px; cursor: ns-resize; } .n { top: 0; } .s { bottom: 0; }
        .e, .w { top: 10px; bottom: 10px; width: 7px; cursor: ew-resize; } .e { right: 0; } .w { left: 0; }
        .ne, .nw, .se, .sw { width: 14px; height: 14px; }
        .ne { top: 0; right: 0; cursor: nesw-resize; } .sw { bottom: 0; left: 0; cursor: nesw-resize; }
        .nw { top: 0; left: 0; cursor: nwse-resize; } .se { bottom: 0; right: 0; cursor: nwse-resize; }
        .grip { position: absolute; left: -4px; top: 0; bottom: 0; width: 9px; cursor: ew-resize; z-index: 2; }
        .float .grip { display: none; }
        .grip:hover, .busy .grip { background: rgba(79,70,229,.35); }
      </style>
      <div class="wrap ${floating ? "float" : "dock"}${floating && fade ? " fade" : ""}${floating && fl.folded ? " folded" : ""}">
        <div class="grip" title="Drag to resize · double-click to reset"></div>
        <div class="bar"><span class="title">Study</span>
          <button class="fold" title="Fold to this bar" aria-label="Fold">−</button>
          <button class="x" title="Close (Alt+Shift+L)" aria-label="Close">✕</button></div>
        <iframe title="${chrome.runtime.getManifest().name}" allow="clipboard-read; clipboard-write"></iframe>
        ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="rz ${d}" data-d="${d}"></div>`).join("")}
      </div>`;
    wrap = root.querySelector(".wrap");
    frame = root.querySelector("iframe");
    const title = root.querySelector(".title");
    frame.addEventListener("load", () => { loaded = true; pending.splice(0).forEach((m) => post(m)); });
    frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1&page=1");
    root.querySelector(".x").addEventListener("click", close);
    root.querySelector(".fold").addEventListener("click", () => { fl.folded = !fl.folded; wrap.classList.toggle("folded", fl.folded); placeFloat(); saveFloat(); });
    wrap.addEventListener("focusin", () => wrap.classList.add("active"));
    wrap.addEventListener("focusout", () => wrap.classList.remove("active"));
    frame.addEventListener("focus", () => wrap.classList.add("active"));
    frame.addEventListener("blur", () => wrap.classList.remove("active"));

    // Title: names the view; rest on it or click it to switch (Study / AI / Home).
    viewSwitch = lnViewSwitch(title, (view) => send({ type: "ln-set-view", view }));

    if (floating) {
      placeFloat();
      // Hover to open (lnPanelHover, like the readers): resting on the folded
      // bar unfolds it; moving away folds it back, unless you clicked into it.
      let hoverAuto = false, hoverT = 0, inside = false;
      const unfold = (v) => { fl.folded = !v; wrap.classList.toggle("folded", fl.folded); placeFloat(); };
      wrap.addEventListener("pointerenter", () => {
        inside = true;
        clearTimeout(hoverT);
        if (!hover.on || !fl.folded) return;
        hoverT = setTimeout(() => { if (fl.folded && inside) { hoverAuto = true; unfold(true); } }, hover.openMs);
      });
      wrap.addEventListener("pointerleave", () => {
        inside = false;
        clearTimeout(hoverT);
        if (!hoverAuto) return;
        hoverT = setTimeout(() => {
          if (!hoverAuto || inside || wrap.classList.contains("busy") || document.activeElement === host) return;
          hoverAuto = false;
          unfold(false);
        }, hover.closeMs);
      });
      wrap.addEventListener("pointerdown", () => { hoverAuto = false; }, true);   // a click = you're using it
      frame.addEventListener("focus", () => { hoverAuto = false; });
      const bar = root.querySelector(".bar");
      bar.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        const r = wrap.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        wrap.classList.add("busy");
        const move = (ev) => {
          fl.x = Math.min(Math.max(ev.clientX - dx, 8 - r.width + 80), innerWidth - 80);
          fl.y = Math.min(Math.max(ev.clientY - dy, 0), innerHeight - 32);
          wrap.style.left = `${fl.x}px`; wrap.style.top = `${fl.y}px`;
        };
        const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); wrap.classList.remove("busy"); saveFloat(); };
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", up);
      });
      bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) root.querySelector(".fold").click(); });
      root.querySelectorAll(".rz").forEach((h) => h.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        h.setPointerCapture(e.pointerId);
        const d = h.dataset.d, r = wrap.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
        wrap.classList.add("busy");
        const move = (ev) => {
          let l = r.left, t = r.top, w = r.width, ht = r.height;
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (d.includes("e")) w = Math.min(Math.max(r.width + dx, MIN_W), innerWidth - r.left - 4);
          if (d.includes("s")) ht = Math.min(Math.max(r.height + dy, MIN_H), innerHeight - r.top - 4);
          if (d.includes("w")) { w = Math.min(Math.max(r.width - dx, MIN_W), r.right - 4); l = r.right - w; }
          if (d.includes("n")) { ht = Math.min(Math.max(r.height - dy, MIN_H), r.bottom - 4); t = r.bottom - ht; }
          Object.assign(wrap.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${ht}px` });
          fl = { ...fl, x: Math.round(l), y: Math.round(t), w: Math.round(w), h: Math.round(ht) };
        };
        const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); wrap.classList.remove("busy"); saveFloat(); };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", up);
      }));
      addEventListener("resize", onResize);
    } else {
      wrap.style.width = `${dockW}px`;
      const grip = root.querySelector(".grip");
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        wrap.classList.add("busy");
        const move = (ev) => {
          dockW = Math.max(MIN_W, Math.min(innerWidth - ev.clientX, Math.floor(innerWidth * 0.7)));
          wrap.style.width = `${dockW}px`;
          room(dockW);
        };
        const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); wrap.classList.remove("busy"); chrome.storage.local.set({ lnPageDockW: dockW }); };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", up);
      });
      grip.addEventListener("dblclick", () => { dockW = 380; wrap.style.width = "380px"; room(380); chrome.storage.local.set({ lnPageDockW: 380 }); });
    }
    document.documentElement.appendChild(host);
    if (!floating) room(dockW);
    store.set(OPEN_KEY, "1");
  }

  const onResize = () => { if (floating && wrap) placeFloat(); };

  function close() {
    if (!host) return;
    host.remove();
    host = frame = root = wrap = null;
    loaded = false;
    pending = [];
    room(0);
    removeEventListener("resize", onResize);
    store.set(OPEN_KEY, "0");
  }

  const post = (m) => frame?.contentWindow?.postMessage(m, EXT);
  const send = (m) => { if (loaded) post(m); else pending.push(m); };
  const toggle = () => (isOpen() ? close() : build());

  // Into the note box (also used by Ctrl+.).
  function focusComposer() {
    build();
    if (fl.folded && floating) { fl.folded = false; wrap.classList.remove("folded"); placeFloat(); }
    send({ type: "ln-focus-composer" });
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m?.type === "LN_PAGE_PANEL") {
      if (!on) { reply({ ok: false }); return; }
      if (m.action === "toggle") toggle(); else if (m.action === "open") build(); else if (m.action === "focus") focusComposer();
      reply({ ok: true });
    }
  });

  // From the panel: toggle / done / which view it's showing.
  addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === "ln-toggle-panel") toggle();
    if (e.data?.type === "ln-panel-done") { frame.blur(); window.focus(); }
    if (e.data?.type === "ln-view") viewSwitch?.update(e.data);
  });

  // Ctrl/⌘+. from the page: into the note box.
  addEventListener("keydown", (e) => {
    if (!on || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key !== ".") return;
    e.preventDefault();
    e.stopPropagation();
    focusComposer();
  }, true);
})();
