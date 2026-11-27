// Lazy Notes test bench — a stand-in for the Chrome extension APIs.
//
// The bench runs the extension's real files in frames of one web page:
//   bg.html       the background (background/background.js, as a module)
//   sidepanel.html, display.html, courses.html …   extension pages
//   article.html  a sample lecture page with content/content.js (the highlighter)
// Every frame loads this file first. The top page (index.html) holds the
// "hub": one shared chrome.storage (saved in this browser's localStorage),
// and message passing between the frames, the way Chrome passes them
// between the service worker, extension pages and content scripts.
// Anything the bench doesn't model (context menus, the toolbar icon, side
// panel options, alarms…) is a quiet no-op.
(() => {
  "use strict";
  const MANIFEST = __MANIFEST__;
  const SAVE_KEY = "lnBench.v1";
  const ARTICLE_URL = "https://lecture.example/bme213/membrane-transport";

  // ── the hub (lives on the top window) ───────────────────────────────────
  function makeHub(base) {
    const areas = { local: {}, session: {}, sync: {} };
    try { Object.assign(areas.local, JSON.parse(localStorage.getItem(SAVE_KEY) || "{}")); } catch (_) {}
    const contexts = new Set();
    let bgReady, bgReadyResolve;
    bgReady = new Promise((r) => { bgReadyResolve = r; });
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const later = (fn) => setTimeout(fn, 0);
    const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(areas.local)); } catch (_) {} };

    function fireChanged(area, changes) {
      if (!Object.keys(changes).length) return;
      later(() => contexts.forEach((c) => {
        [...c.storageListeners, ...(c.areaListeners[area] || [])].forEach((l) => {
          try { c.areaListeners[area]?.includes(l) ? l(clone(changes)) : l(clone(changes), area); } catch (e) { console.error(e); }
        });
      }));
    }

    const hub = {
      base, areas, contexts, ARTICLE_URL,
      bgReady: () => bgReadyResolve(),
      whenBgReady: () => bgReady,
      openLeft: (url) => {},          // index.html replaces these two
      notify: (text) => {},
      storageGet(area, keys) {
        const a = areas[area];
        if (keys == null) return clone(a);
        if (typeof keys === "string") keys = [keys];
        const out = {};
        if (Array.isArray(keys)) keys.forEach((k) => { if (k in a) out[k] = clone(a[k]); });
        else Object.entries(keys).forEach(([k, d]) => { out[k] = k in a ? clone(a[k]) : d; });
        return out;
      },
      storageSet(area, items) {
        const a = areas[area], changes = {};
        Object.entries(items || {}).forEach(([k, v]) => {
          const nv = clone(v);
          if (JSON.stringify(a[k]) === JSON.stringify(nv)) return;
          changes[k] = { oldValue: clone(a[k]), newValue: clone(nv) };
          a[k] = nv;
        });
        if (area === "local") persist();
        fireChanged(area, changes);
      },
      storageRemove(area, keys) {
        const a = areas[area], changes = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in a) { changes[k] = { oldValue: a[k] }; delete a[k]; } });
        if (area === "local") persist();
        fireChanged(area, changes);
      },
      storageClear(area) { hub.storageRemove(area, Object.keys(areas[area])); },

      // Chrome's rules, roughly: runtime messages go to every extension
      // context but the sender (never to content scripts); tab messages go
      // to that tab's content scripts. The first sendResponse wins.
      async deliver(from, targets, msg) {
        if (from.kind !== "bg") await bgReady;
        return new Promise((resolve) => {
          let done = false, waiting = 0;
          const answer = (r) => { if (!done) { done = true; resolve({ response: clone(r) }); } };
          const listeners = [];
          targets.forEach((c) => c.messageListeners.forEach((l) => listeners.push([c, l])));
          if (!listeners.length) { resolve({ error: "Could not establish connection. Receiving end does not exist." }); return; }
          const sender = from.kind === "content"
            ? { id: "lazy-notes-bench", url: ARTICLE_URL, tab: hub.articleTab() }
            : { id: "lazy-notes-bench", url: from.url };
          later(() => {
            listeners.forEach(([, l]) => {
              let keep = false;
              try { keep = l(clone(msg), sender, answer) === true; } catch (e) { console.error(e); }
              if (keep) waiting++;
            });
            if (!waiting && !done) later(() => { if (!done) { done = true; resolve({}); } });
          });
        });
      },
      articleTab: () => ({ id: 1, windowId: 1, index: 0, active: true, url: ARTICLE_URL, title: "Membrane transport — BME213 lecture notes", status: "complete" }),
      readerTab: () => ({ id: 2, windowId: 1, index: 1, active: false, url: base + "pdfreader.html?bench=1", title: "PIO 201 lecture (sample text)", status: "complete" })
    };
    return hub;
  }

  // ── find (or make) the hub ──────────────────────────────────────────────
  let hub = null;
  try {
    for (let w = window; w; w = w.parent) {
      if (w.__lnHub) { hub = w.__lnHub; break; }
      if (w === w.parent) break;
    }
  } catch (_) {}
  if (!hub) {
    const base = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
    hub = makeHub(base);
    window.__lnHub = hub;
  }
  window.__lnHub = hub;      // the same hub in every frame
  window.__lnBenchMakeHub = makeHub;
  if (window === window.top && !window.frameElement && !document.currentScript?.dataset.context) {
    // The bench page itself: just the hub, no extension context.
    if (document.currentScript?.dataset.hubOnly !== undefined) return;
  }

  // ── this frame's context ────────────────────────────────────────────────
  const kind = document.currentScript?.dataset.context
    || (/\/bg\.html$/.test(location.pathname) ? "bg" : /article\.html$/.test(location.pathname) ? "content" : "page");
  const ctx = { kind, url: location.href, messageListeners: [], storageListeners: [], areaListeners: {} };
  hub.contexts.add(ctx);
  addEventListener("pagehide", () => hub.contexts.delete(ctx));

  let lastError;
  const withError = (err, cb, value) => {
    lastError = err ? { message: err } : undefined;
    try { cb(value); } finally { lastError = undefined; }
  };
  // Callback or promise, like Chrome's own APIs.
  const api = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
    const p = Promise.resolve().then(() => fn(...args));
    if (!cb) return p;
    p.then((v) => withError(null, cb, v), (e) => withError(String(e?.message || e), cb, undefined));
  };
  const event = (list) => ({
    addListener: (l) => list.push(l),
    removeListener: (l) => { const i = list.indexOf(l); if (i >= 0) list.splice(i, 1); },
    hasListener: (l) => list.includes(l)
  });

  // Anything not modelled: a function that does nothing, with properties
  // that are the same (chrome.contextMenus.onClicked.addListener(…) etc.).
  function stub() {
    const f = function (...a) {
      const cb = typeof a[a.length - 1] === "function" ? a[a.length - 1] : null;
      if (cb) { setTimeout(() => withError(null, cb, undefined), 0); return undefined; }
      return Promise.resolve(undefined);
    };
    return new Proxy(f, {
      get(t, k) {
        if (k === "then") return undefined;
        if (k === "addListener" || k === "removeListener") return () => {};
        if (k === "hasListener") return () => false;
        if (!(k in t)) t[k] = stub();
        return t[k];
      }
    });
  }

  const storageArea = (area) => ({
    get: api((keys) => hub.storageGet(area, keys)),
    set: api((items) => hub.storageSet(area, items)),
    remove: api((keys) => hub.storageRemove(area, keys)),
    clear: api(() => hub.storageClear(area)),
    getBytesInUse: api(() => JSON.stringify(hub.areas[area]).length),
    setAccessLevel: api(() => {}),
    onChanged: event(ctx.areaListeners[area] = [])
  });

  const isExtUrl = (u) => String(u || "").startsWith(hub.base);
  const matches = (url, pattern) => {
    if (pattern === "<all_urls>") return true;
    const re = new RegExp("^" + String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(url);
  };
  const extensionContexts = () => [...hub.contexts].filter((c) => c !== ctx && c.kind !== "content");

  const sendMessage = (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
    const msg = args.length > 1 && typeof args[0] === "string" ? args[1] : args[0];
    const p = hub.deliver(ctx, extensionContexts(), msg);
    if (!cb) return p.then((r) => (r.error ? Promise.reject(new Error(r.error)) : r.response));
    p.then((r) => withError(r.error, cb, r.response));
  };

  const tabs = () => [hub.articleTab(), hub.readerTab()];
  const chromeApi = {
    runtime: {
      id: "lazy-notes-bench",
      get lastError() { return lastError; },
      getURL: (p) => hub.base + String(p || "").replace(/^\//, ""),
      getManifest: () => JSON.parse(JSON.stringify(MANIFEST)),
      sendMessage,
      onMessage: event(ctx.messageListeners),
      onInstalled: event([]), onStartup: event([]),
      getPlatformInfo: api(() => ({ os: "win", arch: "x86-64" })),
      openOptionsPage: api(() => hub.openLeft(hub.base + "sidepanel.html"))
    },
    storage: {
      local: storageArea("local"),
      session: storageArea("session"),
      sync: storageArea("sync"),
      onChanged: event(ctx.storageListeners)
    },
    tabs: {
      query: api((q = {}) => {
        let list = tabs();
        if (q.url) list = list.filter((t) => [].concat(q.url).some((p) => matches(t.url, p)));
        if (q.active) list = list.filter((t) => t.active);
        return list;
      }),
      get: api((id) => tabs().find((t) => t.id === id) || hub.articleTab()),
      getCurrent: api(() => undefined),
      create: api(({ url } = {}) => { hub.openLeft(url); return { id: 9, windowId: 1, url }; }),
      update: api((id, props = {}) => {
        if (typeof id === "object") props = id;
        if (props.url) hub.openLeft(props.url);
        return hub.articleTab();
      }),
      sendMessage: (tabId, msg, ...rest) => {
        const cb = typeof rest[rest.length - 1] === "function" ? rest.pop() : null;
        const targets = tabId === 1 ? [...hub.contexts].filter((c) => c.kind === "content") : [];
        const p = hub.deliver(ctx, targets, msg);
        if (!cb) return p.then((r) => (r.error ? Promise.reject(new Error(r.error)) : r.response));
        p.then((r) => withError(r.error, cb, r.response));
      },
      onUpdated: event([]), onActivated: event([]), onCreated: event([]), onRemoved: event([])
    },
    windows: {
      getCurrent: api(() => ({ id: 1, focused: true, type: "normal" })),
      get: api((id) => ({ id, focused: true, type: "normal" })),
      update: api(() => ({ id: 1 })),
      create: api(({ url } = {}) => { if (url) hub.openLeft([].concat(url)[0]); return { id: 2 }; }),
      onRemoved: event([]), onFocusChanged: event([]),
      WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2
    },
    downloads: {
      download: api(() => { hub.notify("Downloads don't work in the test bench (Chrome would save the file here)."); return 1; }),
      onCreated: event([]), onChanged: event([])
    }
  };
  const chromeObj = new Proxy(chromeApi, {
    get(t, k) { if (!(k in t)) t[k] = stub(); return t[k]; }
  });
  window.chrome = chromeObj;

  // The background's AI goes to a pretend service, so the AI view can be
  // tried without a key. Its answers say so.
  if (kind === "bg") {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (!String(url).startsWith("https://bench-ai.invalid")) return realFetch(url, init);
      await new Promise((r) => setTimeout(r, 600));
      let prompt = "";
      try { const b = JSON.parse(init?.body || "{}"); prompt = (b.messages || []).map((m) => m.content).join("\n"); } catch (_) {}
      const q = (prompt.match(/Question: (.*)/) || [])[1];
      const body = prompt.split(/\n---[^\n]*\n/).slice(1).join("\n").trim();
      const lines = body.split("\n").map((l) => l.trim()).filter((l) => l && !/^\[Page \d+\]$/.test(l));
      const job = /test-yourself questions/.test(prompt) ? "quiz" : /Summarise|summary/.test(prompt) ? "summary" : q ? "ask" : "other";
      const text = job === "quiz"
        ? lines.slice(0, 5).map((l, i) => `${i + 1}. What does this say: “${l.slice(0, 60)}${l.length > 60 ? "…" : ""}”?`).join("\n")
        : job === "summary" ? lines.slice(0, 5).map((l) => l.slice(0, 110)).join("\n")
        : job === "ask" ? `You asked: “${q}”.\nThe text it read starts: “${(lines[0] || "").slice(0, 120)}”.`
        : (lines[0] || "OK").slice(0, 200);
      const reply = { choices: [{ message: { content: `${text}\n\n(Test bench answer: no real AI here. It read ${body.length} characters.)` } }] };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }
})();
