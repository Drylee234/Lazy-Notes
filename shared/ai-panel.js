// Lazy Notes — the AI answers panel.
//
// Why it exists: the AI already answers in small boxes (the save pop-up's
// text box, the editor's Annotation field). Some answers are long — an
// explanation of a paragraph, a summary of 38 pages, five test questions —
// and a one-line field is the wrong place for those. This is a list of
// answers, newest first, that any page can mount into a container it owns.
//
// What it is NOT: it never saves anything to the user's notes. "Keep as
// note" is the only path in, and only the host page can do it (onKeep).
//
// Answers live in chrome.storage.session under lnAiAnswers (last 20), so
// closing the panel, switching tab or reloading the page does not lose a
// long explanation. Session, not local: these are scratch, not notes — they
// go when Chrome closes. Every storage call is wrapped, so a page without
// chrome.storage.session (a plain web page, a test harness) still works;
// it just forgets when reloaded.
//
// Needs shared/ai-panel.css, and shared/ai-providers.js for "↻ Again".

globalThis.LazyAIPanel = (() => {
  "use strict";

  const KEY = "lnAiAnswers";
  const MAX = 20;

  // Plain-English names for the jobs in background/bg_ai.js. No jargon:
  // the user never sees "task", "prompt" or a model name.
  const JOB_NAMES = {
    tidy: "Tidied highlight",
    summarise: "Summary",
    summariseDoc: "Summary",
    define: "Definition",
    explain: "Explanation",
    quiz: "Test questions",
    quizDoc: "Test questions",
    ask: "Question",
    askDoc: "Question",
    suggestType: "Suggested type"
  };

  // ── storage, wrapped ────────────────────────────────────────────────────
  // chrome.storage.session is missing on a plain web page and in older
  // Chrome. Everything below must keep working without it.
  const area = () => {
    try { return chrome?.storage?.session || null; } catch (_) { return null; }
  };

  function read(done) {
    const s = area();
    if (!s) return done([]);
    try {
      s.get(KEY, (r) => {
        void chrome.runtime?.lastError;
        const list = Array.isArray(r?.[KEY]) ? r[KEY] : [];
        done(list);
      });
    } catch (_) { done([]); }
  }

  function write(list) {
    const s = area();
    if (!s) return;
    try {
      // Never store sourceText: a whole PDF's words would blow the quota.
      // "↻ Again" only works on cards still in this page's memory.
      s.set({ [KEY]: list.slice(0, MAX).map(keep) }, () => void chrome.runtime?.lastError);
    } catch (_) { /* no session storage: answers are page-only */ }
  }

  const keep = (e) => ({
    id: e.id, task: e.task, question: e.question, scope: e.scope,
    text: e.text, state: e.state, reason: e.reason, at: e.at, extra: e.extra
  });

  // ── small helpers ───────────────────────────────────────────────────────
  let seq = 0;
  const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

  function ago(at) {
    const s = Math.max(0, Math.round((Date.now() - (at || 0)) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return `${s} seconds ago`;
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }

  // What was asked, in the user's words: the question for "ask", otherwise
  // the job's name, plus the scope ("Summary · pages 1-38").
  function titleOf(e) {
    const asked = String(e.question || "").trim();
    const name = asked || JOB_NAMES[e.task] || "AI answer";
    const scope = String(e.scope || "").trim();
    return scope ? `${name} · ${scope}` : name;
  }

  // Clipboard needs a user gesture and can still be refused (an iframe
  // without permission). Fall back to a hidden textarea + execCommand.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  // ── mount ───────────────────────────────────────────────────────────────
  function mount(container, { onKeep } = {}) {
    if (!container) throw new Error("LazyAIPanel.mount needs a container");

    let entries = [];                 // newest first
    let hostFocus = null;             // where Esc sends focus back to
    let ignoreNextChange = false;     // our own writes come back as changes

    container.classList.add("ln-ai-panel");
    container.innerHTML = `
      <div class="aip-head">
        <span class="aip-title">AI answers</span>
        <span class="aip-count" aria-live="polite"></span>
        <button type="button" class="aip-clear" title="Remove every answer here (your notes are not touched)">Clear</button>
      </div>
      <div class="aip-list" role="list" tabindex="-1" aria-label="AI answers, newest first"></div>
      <p class="aip-empty">Nothing yet. Ask the AI from a highlight, a topic or a document and the answer lands here — long ones included.</p>
      <p class="aip-foot">Written by AI. Check it before you keep it — nothing is saved to your notes unless you press <b>Keep as note</b>.</p>
    `;

    const list = container.querySelector(".aip-list");
    const empty = container.querySelector(".aip-empty");
    const countEl = container.querySelector(".aip-count");

    const find = (id) => entries.find((e) => e.id === id);
    const cardOf = (id) => list.querySelector(`.aip-card[data-id="${id}"]`);

    // ── drawing ──
    function draw() {
      const focusedId = document.activeElement?.closest?.(".aip-card")?.dataset.id || null;
      list.textContent = "";
      entries.forEach((e) => list.appendChild(card(e)));
      empty.hidden = entries.length > 0;
      countEl.textContent = entries.length ? `${entries.length}` : "";
      container.querySelector(".aip-clear").hidden = entries.length === 0;
      if (focusedId) cardOf(focusedId)?.focus();
    }

    function card(e) {
      const el = document.createElement("article");
      el.className = "aip-card";
      el.dataset.id = e.id;
      el.dataset.state = e.state;
      el.setAttribute("role", "listitem");
      el.tabIndex = 0;

      const head = document.createElement("div");
      head.className = "aip-card-head";
      const badge = document.createElement("span");
      badge.className = "aip-badge";
      badge.textContent = "AI";
      badge.title = "Written by AI, not by you";
      const asked = document.createElement("h4");
      asked.className = "aip-asked";
      asked.textContent = titleOf(e);
      head.append(badge, asked);

      const body = document.createElement("div");
      if (e.state === "working") {
        body.className = "aip-working";
        body.textContent = "Thinking…";
      } else if (e.state === "failed") {
        body.className = "aip-failed";
        body.textContent = e.reason || "That didn't work.";
      } else {
        // The whole point of the panel: selectable, wrapping, and it
        // scrolls inside the card instead of stretching the page.
        body.className = "aip-text";
        body.textContent = e.text || "";
        body.tabIndex = -1;
      }

      const foot = document.createElement("div");
      foot.className = "aip-card-foot";
      const when = document.createElement("span");
      when.className = "aip-when";
      when.textContent = e.state === "working" ? "asking now" : ago(e.at);
      when.title = e.at ? new Date(e.at).toLocaleString() : "";

      const acts = document.createElement("div");
      acts.className = "aip-acts";
      if (e.state !== "working") {
        acts.appendChild(button("Copy", "aip-copy", "Copy this answer", () => doCopy(e.id)));
        if (e.sourceText) acts.appendChild(button("↻ Again", "aip-again", "Ask again, same words", () => again(e.id)));
        if (typeof onKeep === "function" && e.state === "done") {
          acts.appendChild(button("Keep as note", "aip-keep", "Save this answer as a note", (b) => keepIt(e.id, b)));
        }
      }
      acts.appendChild(button("✕", "aip-drop", "Remove this answer", () => remove(e.id)));

      foot.append(when, acts);
      el.append(head, body, foot);
      return el;
    }

    function button(label, cls, title, run) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `aip-act ${cls}`;
      b.textContent = label;
      b.title = title;
      b.tabIndex = -1;                // the card is the tab stop (keyboard-first)
      b.addEventListener("click", (ev) => { ev.stopPropagation(); run(b); });
      return b;
    }

    function say(id, msg, bad = false) {
      const c = cardOf(id);
      if (!c) return;
      let line = c.querySelector(".aip-said");
      if (!line) {
        line = document.createElement("span");
        line.className = "aip-said";
        c.querySelector(".aip-card-foot").insertBefore(line, c.querySelector(".aip-acts"));
      }
      line.textContent = msg;
      line.classList.toggle("bad", bad);
      clearTimeout(line._t);
      line._t = setTimeout(() => line.remove(), 2500);
    }

    function save() {
      ignoreNextChange = true;
      write(entries);
    }

    // ── the actions ──
    async function doCopy(id) {
      const e = find(id);
      if (!e) return;
      const text = e.state === "failed" ? (e.reason || "") : (e.text || "");
      say(id, (await copyText(text)) ? "Copied" : "Couldn't copy — select it and press Ctrl+C", !text);
    }

    function remove(id) {
      const next = cardOf(id)?.nextElementSibling || cardOf(id)?.previousElementSibling;
      const keepId = next?.dataset.id;
      entries = entries.filter((e) => e.id !== id);
      save();
      draw();
      (keepId ? cardOf(keepId) : null)?.focus();
    }

    async function keepIt(id, btn) {
      const e = find(id);
      if (!e || typeof onKeep !== "function") return;
      if (btn) { btn.disabled = true; btn.textContent = "Keeping…"; }
      let ok = false;
      try {
        ok = (await onKeep(keep(e))) === true;   // only "true" counts as saved
      } catch (_) { ok = false; }
      if (btn) { btn.disabled = false; btn.textContent = "Keep as note"; }
      if (ok) {
        const c = cardOf(id);
        if (c) c.dataset.kept = "1";
        e.kept = true;
        say(id, "Kept as a note");
      } else {
        say(id, "Not saved — try again", true);
      }
      return ok;
    }

    // Re-run the same job with the same words. sourceText and extra are kept
    // on the card and never shown: the user asked about their highlight, not
    // about a blob of text.
    function again(id) {
      const e = find(id);
      if (!e || !e.sourceText) return;
      const AIP = globalThis.LazyAIProviders;
      if (!AIP || typeof AIP.ask !== "function") return say(id, "Can't ask again from here", true);
      e.state = "working";
      e.at = Date.now();
      save();
      draw();
      cardOf(id)?.focus();
      Promise.resolve(AIP.ask(e.task, e.sourceText, e.extra)).then((r) => {
        if (r && r.ok) api.resolve(id, { text: r.text });
        else api.fail(id, r?.reason || "The AI didn't answer.");
      }, () => api.fail(id, "The AI didn't answer."));
    }

    // ── keyboard: the owner is keyboard-first (hard rule 3) ──
    list.addEventListener("keydown", (ev) => {
      const c = ev.target.closest?.(".aip-card");
      if (!c) return;
      const cards = [...list.querySelectorAll(".aip-card")];
      const i = cards.indexOf(c);
      const go = (n) => { cards[n]?.focus(); ev.preventDefault(); };

      if (ev.key === "ArrowDown") return go(Math.min(i + 1, cards.length - 1));
      if (ev.key === "ArrowUp") return go(Math.max(i - 1, 0));
      if (ev.key === "Home") return go(0);
      if (ev.key === "End") return go(cards.length - 1);
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); return remove(c.dataset.id); }
      if (ev.key === "Escape") {
        ev.preventDefault();
        try { hostFocus?.focus(); } catch (_) { /* gone */ }
        if (!hostFocus) c.blur();
        return;
      }
      // Plain letters only: never steal a Ctrl+C from someone selecting text.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "c" || ev.key === "C") { ev.preventDefault(); return doCopy(c.dataset.id); }
      if (ev.key === "k" || ev.key === "K") {
        ev.preventDefault();
        return c.querySelector(".aip-keep")?.click();
      }
      if (ev.key === "r" || ev.key === "R") {
        ev.preventDefault();
        return c.querySelector(".aip-again")?.click();
      }
    });

    // Remember where focus came from, so Esc can hand it back to the host.
    list.addEventListener("focusin", (ev) => {
      const from = ev.relatedTarget;
      if (from && !container.contains(from)) hostFocus = from;
    });
    container.querySelector(".aip-clear").addEventListener("click", () => api.clear());

    // The clock on each card would otherwise say "just now" forever.
    const tick = setInterval(() => {
      entries.forEach((e) => {
        if (e.state === "working") return;
        const w = cardOf(e.id)?.querySelector(".aip-when");
        if (w) w.textContent = ago(e.at);
      });
    }, 30000);

    // Another panel (or another tab's panel) changed the list: follow it,
    // but keep the cards still being asked about here.
    let onChanged = null;
    try {
      onChanged = (changes, which) => {
        if (which !== "session" || !(KEY in changes)) return;
        if (ignoreNextChange) { ignoreNextChange = false; return; }
        if (!container.isConnected) return;
        const stored = Array.isArray(changes[KEY].newValue) ? changes[KEY].newValue : [];
        const working = entries.filter((e) => e.state === "working");
        const live = new Map(entries.map((e) => [e.id, e]));
        entries = [
          ...working,
          ...stored.filter((e) => !working.some((w) => w.id === e.id))
                   .map((e) => ({ ...e, sourceText: live.get(e.id)?.sourceText, extra: e.extra ?? live.get(e.id)?.extra }))
        ];
        draw();
      };
      chrome.storage.onChanged.addListener(onChanged);
    } catch (_) { onChanged = null; }

    // ── the API the host pages use ──
    const api = {
      add(entry = {}) {
        const e = {
          id: newId(),
          task: entry.task || "ask",
          question: entry.question || "",
          scope: entry.scope || "",
          text: String(entry.text || ""),
          sourceText: entry.sourceText || "",
          extra: entry.extra,
          state: "done",
          at: Date.now()
        };
        entries.unshift(e);
        entries = entries.slice(0, MAX);
        save();
        draw();
        return e.id;
      },

      // A card that says "…" while the service thinks. The label is what was
      // asked, so the user can see which answer is on its way.
      working(label = "", entry = {}) {
        const e = {
          id: newId(),
          task: entry.task || "ask",
          question: entry.question || label || "",
          scope: entry.scope || "",
          text: "",
          sourceText: entry.sourceText || "",
          extra: entry.extra,
          state: "working",
          at: Date.now()
        };
        entries.unshift(e);
        entries = entries.slice(0, MAX);
        draw();
        return e.id;
      },

      resolve(id, { text = "", question, scope, sourceText, extra } = {}) {
        const e = find(id);
        if (!e) return null;
        e.state = "done";
        e.text = String(text || "");
        e.reason = "";
        e.at = Date.now();
        if (question !== undefined) e.question = question;
        if (scope !== undefined) e.scope = scope;
        if (sourceText !== undefined) e.sourceText = sourceText;
        if (extra !== undefined) e.extra = extra;
        save();
        draw();
        return id;
      },

      fail(id, reason) {
        const e = find(id);
        if (!e) return null;
        e.state = "failed";
        e.reason = String(reason || "That didn't work. Try again.");
        e.at = Date.now();
        save();
        draw();
        return id;
      },

      clear() {
        entries = [];
        save();
        draw();
      },

      count() { return entries.length; },

      // Hosts that put the panel in a pop-out or a tab can let it go.
      destroy() {
        clearInterval(tick);
        if (onChanged) { try { chrome.storage.onChanged.removeListener(onChanged); } catch (_) {} }
        container.textContent = "";
        container.classList.remove("ln-ai-panel");
      }
    };
    // Also exposed on the element, so a host that only kept the container
    // (or a later script) can still reach the panel.
    container.lnAiPanel = api;

    // Older answers come back from this browser session.
    read((list0) => {
      if (!container.isConnected) return;
      const ids = new Set(entries.map((e) => e.id));
      entries = [...entries, ...list0.filter((e) => !ids.has(e.id))].slice(0, MAX);
      draw();
    });
    draw();
    return api;
  }

  return { mount, MAX, STORAGE_KEY: KEY };
})();
