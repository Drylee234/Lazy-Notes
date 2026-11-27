// Lazy Notes — "Ask the AI" bar at the top of the AI view.
//
// Why: the AI jobs for a whole document, one page or a topic's notes
// (background/bg_ai.js: askDoc, summariseDoc, quizDoc, ask, summarise, quiz)
// had no way in. This bar is that way in: pick what the AI reads, then type
// a question (Enter) or press Summarise / Quiz me. The answer lands in the
// answers list below (shared/ai-panel.js), which never touches your notes
// unless you press Keep as note.
//
// What it reads:
//   Document   the open reader's text (chrome.storage.session lnDocPages)
//   This page  the page/slide you're on (lnDocs keeps it per document)
//   My notes   the notes of the topic you're saving to
//
// LazyAIAsk.mount(container, panelApi) puts the bar first in container.

globalThis.LazyAIAsk = (() => {
  "use strict";

  const SCOPE_KEY = "lnAiAskScope";   // remembered choice (local, a convenience)

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r || { ok: false, reason: "Lazy Notes didn't answer. Reload the panel." }); });
    } catch (_) { resolve({ ok: false, reason: "Lazy Notes didn't answer. Reload the panel." }); }
  });

  // What can be read right now.
  async function sources() {
    let doc = null;
    try {
      const { lnDocPages } = await chrome.storage.session.get("lnDocPages");
      if (lnDocPages?.pages?.length) doc = lnDocPages;
    } catch (_) { /* no session storage */ }
    const { lnDocs = {}, activeCourse, activeTopic, lazynotes } =
      await chrome.storage.local.get(["lnDocs", "activeCourse", "activeTopic", "lazynotes"]);
    let page = 1;
    if (doc) {
      // The page you're on: the reader keeps it in lnDocs, per document.
      const all = Object.values(lnDocs).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
      const mine = all.find((d) => d.name === doc.title) || all[0];
      page = Math.max(1, Number(mine?.page) || 1);
    }
    const topic = activeCourse && activeTopic ? lazynotes?.courses?.[activeCourse]?.topics?.[activeTopic] : null;
    return { doc, page, course: activeCourse, topicName: activeTopic, topic };
  }

  // The topic's notes as plain lines, in the order you see them, indented
  // the way they are nested.
  function notesText(topic) {
    const items = [
      ...Object.values(topic?.highlights || {}).filter((h) => h.category !== "figure"),
      ...Object.values(topic?.notes || {})
    ].sort((a, b) => noteOrder(a) - noteOrder(b));
    return items.map((n) => {
      const pad = "  ".repeat(Math.max(0, Math.min(3, n.indent || 0)));
      const text = String(n.text || "").replace(/<[^>]+>/g, "").trim();
      const extra = n.annotation ? ` (my note: ${String(n.annotation).trim()})` : "";
      return text ? pad + text.split("\n").join(`\n${pad}`) + extra : "";
    }).filter(Boolean).join("\n");
  }

  function mount(container, panel) {
    const bar = document.createElement("form");
    bar.className = "aia-bar";
    bar.innerHTML = `
      <div class="aia-scopes" role="radiogroup" aria-label="What the AI reads">
        <button type="button" role="radio" data-scope="doc">Document</button>
        <button type="button" role="radio" data-scope="page">This page</button>
        <button type="button" role="radio" data-scope="notes">My notes</button>
      </div>
      <textarea class="aia-input" rows="1" placeholder="Ask about this document…" aria-label="Your question"></textarea>
      <div class="aia-row">
        <button type="button" class="aia-job" data-job="summarise">Summarise</button>
        <button type="button" class="aia-job" data-job="quiz">Quiz me</button>
        <span class="aia-hint">Enter asks</span>
        <button type="submit" class="aia-go">Ask</button>
      </div>
      <p class="aia-status" aria-live="polite" hidden></p>`;
    container.prepend(bar);

    const input = bar.querySelector(".aia-input");
    const status = bar.querySelector(".aia-status");
    const scopeBtns = [...bar.querySelectorAll("[data-scope]")];
    let scope = "doc";
    let now = { doc: null, page: 1 };

    const say = (msg) => { status.textContent = msg || ""; status.hidden = !msg; };
    const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };

    function setScope(s, remember = true) {
      scope = s;
      scopeBtns.forEach((b) => {
        const on = b.dataset.scope === s;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", String(on));
      });
      input.placeholder = s === "notes" ? `Ask about your notes${now.topicName ? ` on ${now.topicName}` : ""}…`
        : s === "page" ? `Ask about page ${now.page}…` : "Ask about this document…";
      if (remember) { try { chrome.storage.local.set({ [SCOPE_KEY]: s }); } catch (_) {} }
    }

    // Grey out what can't be read now, and say why on hover.
    async function refresh() {
      now = await sources();
      const can = { doc: !!now.doc, page: !!now.doc, notes: !!now.topic };
      const why = { doc: "Open a document in the reader first", page: "Open a document in the reader first", notes: "Pick a topic first" };
      scopeBtns.forEach((b) => {
        const s = b.dataset.scope;
        b.disabled = !can[s];
        b.title = can[s]
          ? (s === "doc" ? `Reads all of “${now.doc.title}”` : s === "page" ? `Reads page ${now.page} only` : `Reads your notes on ${now.course} › ${now.topicName}`)
          : why[s];
        if (s === "page") b.textContent = can.page ? `Page ${now.page}` : "This page";
      });
      let { [SCOPE_KEY]: want } = await chrome.storage.local.get(SCOPE_KEY).catch(() => ({}));
      if (!can[want || scope]) want = ["doc", "notes", "page"].find((s) => can[s]) || scope;
      setScope(want || scope, false);
      const none = !can.doc && !can.notes;
      bar.querySelectorAll(".aia-job, .aia-go").forEach((b) => { b.disabled = none; });
      input.disabled = none;
      say(none ? "Open a document or pick a topic, then ask about it here." : "");
    }

    async function run(job) {
      const question = input.value.trim();
      if (job === "ask" && !question) { input.focus(); return; }
      await refresh();
      if (scopeBtns.find((b) => b.dataset.scope === scope)?.disabled) return;

      let msg, label, where;
      if (scope === "notes") {
        const text = notesText(now.topic);
        if (!text) { say("That topic has no notes yet."); return; }
        msg = { type: "AI_RUN", task: job, text, extra: job === "ask" ? question : undefined };
        where = `notes: ${now.topicName}`;
      } else {
        const task = job === "ask" ? "askDoc" : job === "summarise" ? "summariseDoc" : "quizDoc";
        msg = { type: "AI_RUN", task, scope: scope === "page" ? "page" : "all", page: now.page, extra: job === "ask" ? question : undefined };
        where = scope === "page" ? `page ${now.page}` : now.doc.title;
      }
      label = job === "ask" ? question : job === "summarise" ? "Summary" : "Test questions";
      const id = panel.working(label, { task: msg.task, question: job === "ask" ? question : "", scope: where });
      if (job === "ask") { input.value = ""; grow(); }
      say("");
      const r = await send(msg);
      if (r?.ok) {
        panel.resolve(id, {
          text: r.note ? `${r.text}\n\n(${r.note})` : r.text,
          ...(msg.text ? { sourceText: msg.text, extra: msg.extra } : {})
        });
      } else {
        panel.fail(id, r?.reason);
      }
    }

    scopeBtns.forEach((b) => b.addEventListener("click", () => { setScope(b.dataset.scope); input.focus(); }));
    bar.querySelectorAll(".aia-job").forEach((b) => b.addEventListener("click", () => run(b.dataset.job)));
    bar.addEventListener("submit", (e) => { e.preventDefault(); run("ask"); });
    input.addEventListener("input", grow);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run("ask"); }
    });

    chrome.storage.onChanged.addListener((c, area) => {
      if ((area === "session" && c.lnDocPages) || (area === "local" && (c.lnDocs || c.activeCourse || c.activeTopic || c.lazynotes))) refresh();
    });
    refresh();
    return { focus: () => input.focus(), refresh };
  }

  return { mount, notesText };
})();
