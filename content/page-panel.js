// Lazy Notes — our own side panel on web pages (instead of Chrome's).
// The same sidepanel.html as the readers' built-in panel, in an iframe docked
// to the right edge; the page makes room for it. Opened by the toolbar
// button, Alt+Shift+L, Ctrl/⌘+. (also jumps into the note box), or by a
// page's ✎ Note / ❝ Quote. Chrome's own panel is used only if this is
// switched off (Settings › More options) or the page can't hold it.
(() => {
  if (window.top !== window || window.__lnPagePanel) return;
  window.__lnPagePanel = true;

  const OPEN_KEY = "ln-page-panel-open";
  const MIN_W = 300;
  let host = null, frame = null, root = null, width = 380, on = true;
  let loaded = false, pending = [];

  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} }
  };

  chrome.storage.local.get(["lnPageDockW", "lnPagePanelOwn"], (r) => {
    width = Math.max(MIN_W, Math.min(r?.lnPageDockW || 380, Math.floor(innerWidth * 0.6)));
    on = r?.lnPagePanelOwn !== false;
    if (store.get(OPEN_KEY) === "1" && on) build();
  });
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== "local" || !("lnPagePanelOwn" in c)) return;
    on = c.lnPagePanelOwn.newValue !== false;
    if (!on) close();
  });

  const isOpen = () => !!host;

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

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "lazy-notes-page-panel";
    host.style.cssText = "all:initial;position:fixed;top:0;right:0;bottom:0;z-index:2147483646;";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: #fff;
          border-left: 1px solid #d4d4d8; box-shadow: -6px 0 24px rgba(0,0,0,.14); font: 13px system-ui, sans-serif; }
        @media (prefers-color-scheme: dark) { .wrap { background: #18181b; border-color: #3f3f46; } .bar { background: #27272a; color: #e4e4e7; } }
        .bar { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 12px; background: #f4f4f5; color: #3f3f46; flex: none; font-weight: 600; }
        .bar span { flex: 1; }
        .bar button { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 2px 8px; border-radius: 6px; opacity: .75; }
        .bar button:hover { background: rgba(127,127,127,.2); opacity: 1; }
        iframe { flex: 1; border: 0; width: 100%; background: transparent; color-scheme: light dark; }
        .grip { position: absolute; left: -4px; top: 0; bottom: 0; width: 9px; cursor: ew-resize; z-index: 2; }
        .grip:hover, .resizing .grip { background: rgba(79,70,229,.35); }
        .resizing iframe { pointer-events: none; }
      </style>
      <div class="wrap" style="width:${width}px">
        <div class="grip" title="Drag to resize · double-click to reset"></div>
        <div class="bar"><span></span><button class="x" title="Close (Alt+Shift+L)" aria-label="Close">✕</button></div>
        <iframe title="${chrome.runtime.getManifest().name}" allow="clipboard-read; clipboard-write"></iframe>
      </div>`;
    frame = root.querySelector("iframe");
    frame.addEventListener("load", () => { loaded = true; pending.splice(0).forEach((m) => post(m)); });
    frame.src = chrome.runtime.getURL("sidepanel.html?embedded=1&page=1");
    root.querySelector(".x").addEventListener("click", close);
    const wrap = root.querySelector(".wrap"), grip = root.querySelector(".grip");
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      wrap.classList.add("resizing");
      const move = (ev) => {
        width = Math.max(MIN_W, Math.min(innerWidth - ev.clientX, Math.floor(innerWidth * 0.7)));
        wrap.style.width = `${width}px`;
        room(width);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        wrap.classList.remove("resizing");
        chrome.storage.local.set({ lnPageDockW: width });
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
    grip.addEventListener("dblclick", () => { width = 380; wrap.style.width = "380px"; room(380); chrome.storage.local.set({ lnPageDockW: 380 }); });
    document.documentElement.appendChild(host);
    room(width);
    store.set(OPEN_KEY, "1");
  }

  function close() {
    if (!host) return;
    host.remove();
    host = frame = root = null;
    loaded = false;
    pending = [];
    room(0);
    store.set(OPEN_KEY, "0");
  }

  const post = (m) => frame?.contentWindow?.postMessage(m, chrome.runtime.getURL("").replace(/\/$/, ""));
  const send = (m) => { if (loaded) post(m); else pending.push(m); };
  const toggle = () => (isOpen() ? close() : build());

  // Into the note box (also used by Ctrl+.).
  function focusComposer() {
    build();
    send({ type: "ln-focus-composer" });
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m?.type === "LN_PAGE_PANEL") {
      if (!on) { reply({ ok: false }); return; }
      if (m.action === "toggle") toggle(); else if (m.action === "open") build(); else if (m.action === "focus") focusComposer();
      reply({ ok: true });
    }
  });

  // The panel asking for the keyboard back / to close.
  addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === "ln-toggle-panel") toggle();
    if (e.data?.type === "ln-panel-done") { frame.blur(); window.focus(); }
  });

  // Ctrl/⌘+. from the page: into the note box.
  addEventListener("keydown", (e) => {
    if (!on || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key !== ".") return;
    e.preventDefault();
    e.stopPropagation();
    focusComposer();
  }, true);
})();
