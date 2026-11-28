// QNotes — the AI view as a chat with threads.
//
// Like any AI chat: each conversation is a thread; every message goes to the
// open thread; you can keep many threads and come back to them. A thread
// remembers what it was about (course › topic, and the document if one was
// open) so the list can be grouped by course or by document (owner to pick:
// the switch in the thread list, lnAiGroup = "course" | "doc" | "none").
//
// Each question reads what you choose under the box: the open Document, the
// Page you're on, or My notes on this topic (shared/ai-ask.js sources()), plus
// the last messages of the thread. Summarise / Quiz me are messages too.
// Answers only reach your notes through "Keep as note".
//
// Threads: chrome.storage.local "lnAiThreads" = { [id]: { id, title, course,
// topic, doc, createdAt, updatedAt, messages: [{ role, text, at, offline? }] } }
// (kept: 60 threads, 80 messages each). Settings › Old ways › lnAiView =
// "answers" brings back the old answers list.

globalThis.LazyAIChat = (() => {
  "use strict";
  const KEY = "lnAiThreads", MAX_THREADS = 60, MAX_MSGS = 80;
  const send = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r || { ok: false, reason: "QNotes didn't answer. Reload the panel." }); }); }
    catch (_) { resolve({ ok: false, reason: "QNotes didn't answer. Reload the panel." }); }
  });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ago = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString();
  };

  function mount(container, { onKeep } = {}) {
    let threads = {}, openId = null, scope = "notes", group = "course", now = null, busy = false;
    container.classList.add("ln-ai-chat");
    container.innerHTML = `
      <div class="aic-head">
        <button type="button" class="aic-list-btn" aria-expanded="false" title="All threads">☰</button>
        <span class="aic-title">New chat</span>
        <button type="button" class="aic-new" title="Start a new thread">+ New</button>
      </div>
      <div class="aic-drawer" hidden>
        <div class="aic-group" role="radiogroup" aria-label="Group threads by">
          <span>Group by</span>
          <button type="button" data-g="course" role="radio">Course</button>
          <button type="button" data-g="doc" role="radio">Document</button>
          <button type="button" data-g="none" role="radio">None</button>
        </div>
        <div class="aic-threads"></div>
      </div>
      <div class="aic-msgs" aria-live="polite"></div>
      <form class="aic-form" autocomplete="off">
        <div class="aic-scopes" role="radiogroup" aria-label="What the AI reads">
          <button type="button" data-scope="doc" role="radio">Document</button>
          <button type="button" data-scope="page" role="radio">This page</button>
          <button type="button" data-scope="notes" role="radio">My notes</button>
        </div>
        <div class="aic-row">
          <textarea class="aic-input" rows="1" placeholder="Ask anything…" aria-label="Message"></textarea>
          <button type="submit" class="aic-send" title="Send (Enter)">↑</button>
        </div>
        <div class="aic-quick"><button type="button" data-job="summarise">Summarise</button><button type="button" data-job="quiz">Quiz me</button>
          <span class="aic-hint">Enter sends · Shift+Enter new line</span></div>
      </form>`;
    const $ = (c) => container.querySelector(c);
    const msgsEl = $(".aic-msgs"), input = $(".aic-input"), drawer = $(".aic-drawer");
    const scopeBtns = [...container.querySelectorAll("[data-scope]")];

    const save = () => {
      const ids = Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt).map((t) => t.id);
      ids.slice(MAX_THREADS).forEach((id) => delete threads[id]);
      try { chrome.storage.local.set({ [KEY]: threads }); } catch (_) {}
    };
    const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };

    // ── what can be read now (same as the Ask bar) ──
    async function refresh() {
      now = await LazyAIAsk.sources();
      const can = { doc: !!now.doc, page: !!now.doc, notes: !!now.topic };
      scopeBtns.forEach((b) => {
        const s = b.dataset.scope;
        b.disabled = !can[s];
        b.title = can[s] ? (s === "doc" ? `Reads all of “${now.doc.title}”` : s === "page" ? `Reads page ${now.page}` : `Reads your notes on ${now.course} › ${now.topicName}`)
          : (s === "notes" ? "Pick a topic first" : "Open a document in the reader first");
        if (s === "page") b.textContent = can.page ? `Page ${now.page}` : "This page";
      });
      if (!can[scope]) scope = ["doc", "notes", "page"].find((s) => can[s]) || scope;
      scopeBtns.forEach((b) => { b.classList.toggle("on", b.dataset.scope === scope); b.setAttribute("aria-checked", String(b.dataset.scope === scope)); });
      input.placeholder = scope === "notes" ? `Ask about your notes${now.topicName ? ` on ${now.topicName}` : ""}…` : scope === "page" ? `Ask about page ${now.page}…` : "Ask about this document…";
    }

    // ── drawing ──
    function drawThread() {
      const t = threads[openId];
      $(".aic-title").textContent = t ? t.title : "New chat";
      $(".aic-title").title = t ? [t.course && `${t.course} › ${t.topic || ""}`, t.doc].filter(Boolean).join(" · ") : "";
      msgsEl.replaceChildren();
      if (!t) {
        const e = el("div", "aic-empty");
        e.append(el("b", null, "Ask about what you're studying."), el("span", null, " Pick what the AI reads below: the document, the page you're on, or your notes. Each chat is kept in ☰ so you can come back to it."));
        msgsEl.append(e);
        return;
      }
      t.messages.forEach((m, i) => msgsEl.append(bubble(t, m, i)));
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    function bubble(t, m, i) {
      const b = el("div", `aic-msg aic-${m.role}${m.failed ? " aic-failed" : ""}`);
      if (m.role === "ai") {
        const tag = el("span", "aic-badge", m.offline ? "Offline" : "AI");
        tag.title = m.offline ? "Picked from your own text by the offline helper (no AI)" : "Written by AI, not by you";
        b.append(tag);
      }
      b.append(el("div", "aic-text", m.pending ? "Thinking…" : m.text));
      if (m.role === "ai" && !m.pending && !m.failed) {
        const acts = el("div", "aic-acts");
        const copy = el("button", null, "Copy"); copy.type = "button";
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(m.text); copy.textContent = "Copied"; } catch (_) { copy.textContent = "Couldn't copy"; } });
        acts.append(copy);
        if (typeof onKeep === "function") {
          const keep = el("button", null, m.kept ? "Kept ✓" : "Keep as note"); keep.type = "button"; keep.disabled = !!m.kept;
          keep.addEventListener("click", async () => {
            keep.disabled = true;
            const ok = (await onKeep({ text: m.text, task: m.job || "ask" })) === true;
            if (ok) { m.kept = true; save(); keep.textContent = "Kept ✓"; } else { keep.disabled = false; keep.textContent = "Not saved: pick a topic"; }
          });
          acts.append(keep);
        }
        b.append(acts);
      }
      return b;
    }
    function drawList() {
      $(".aic-group").querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.g === group); b.setAttribute("aria-checked", String(b.dataset.g === group)); });
      const list = $(".aic-threads");
      const all = Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt);
      list.replaceChildren();
      if (!all.length) { list.append(el("div", "aic-none", "No chats yet.")); return; }
      const keyOf = (t) => (group === "course" ? (t.course || "No course") : group === "doc" ? (t.doc || "No document") : "");
      const groups = new Map();
      all.forEach((t) => { const k = keyOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
      groups.forEach((ts, k) => {
        if (group !== "none") list.append(el("div", "aic-group-name", k));
        ts.forEach((t) => {
          const row = el("div", `aic-thread${t.id === openId ? " on" : ""}`);
          const open = el("button", "aic-thread-open"); open.type = "button";
          open.append(el("span", "aic-thread-title", t.title),
            el("span", "aic-thread-meta", [group !== "course" && t.course, group !== "doc" && t.doc, ago(t.updatedAt)].filter(Boolean).join(" · ")));
          open.addEventListener("click", () => { openId = t.id; showList(false); drawThread(); input.focus(); });
          const del = el("button", "aic-thread-del", "×"); del.type = "button"; del.title = "Delete this chat (your notes aren't touched)";
          del.addEventListener("click", () => {
            if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Delete?"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "×"; }, 3000); return; }
            delete threads[t.id]; if (openId === t.id) openId = null; save(); drawList(); drawThread();
          });
          row.append(open, del);
          list.append(row);
        });
      });
    }
    function showList(on) {
      drawer.hidden = !on;
      $(".aic-list-btn").setAttribute("aria-expanded", String(on));
      if (on) drawList();
    }

    // ── sending ──
    async function ask(question, job = "ask") {
      if (busy || !question) return;
      await refresh();
      if (scopeBtns.find((b) => b.dataset.scope === scope)?.disabled) return;
      let t = threads[openId];
      if (!t) {
        const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        t = threads[id] = { id, title: question.length > 48 ? question.slice(0, 47) + "…" : question,
          course: now.course || "", topic: now.topicName || "", doc: now.doc?.title || "", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        openId = id;
      }
      const history = t.messages.filter((m) => !m.pending && !m.failed).map((m) => ({ role: m.role, text: m.text }));
      t.messages.push({ role: "user", text: question, at: Date.now() });
      const reply = { role: "ai", text: "", at: Date.now(), pending: true, job };
      t.messages.push(reply);
      t.messages = t.messages.slice(-MAX_MSGS);
      t.updatedAt = Date.now();
      busy = true;
      drawThread();
      const notes = scope === "notes" ? LazyAIAsk.notesText(now.topic) : "";
      let r;
      if (job === "ask") {
        r = await send({ type: "AI_CHAT", question, scope, page: now.page, text: notes, history, title: [t.course, t.topic].filter(Boolean).join(" › ") });
      } else {
        const task = scope === "notes" ? job : `${job}Doc`;
        r = await send({ type: "AI_RUN", task, text: notes || undefined, scope: scope === "page" ? "page" : "all", page: now.page });
      }
      delete reply.pending;
      if (r?.ok) { reply.text = r.note ? `${r.text}\n\n(${r.note})` : r.text; reply.offline = !!r.offline; }
      else { reply.failed = true; reply.text = r?.reason || "That didn't work. Try again."; }
      t.updatedAt = Date.now();
      busy = false;
      save();
      if (openId === t.id) drawThread();
    }

    $(".aic-form").addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ""; grow(); ask(q); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".aic-form").requestSubmit(); } });
    input.addEventListener("input", grow);
    container.querySelectorAll(".aic-quick [data-job]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.job === "quiz" ? "Quiz me" : "Summarise", b.dataset.job)));
    scopeBtns.forEach((b) => b.addEventListener("click", () => { scope = b.dataset.scope; try { chrome.storage.local.set({ lnAiAskScope: scope }); } catch (_) {} refresh(); input.focus(); }));
    $(".aic-new").addEventListener("click", () => { openId = null; showList(false); drawThread(); input.focus(); });
    $(".aic-list-btn").addEventListener("click", () => showList(drawer.hidden));
    $(".aic-group").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { group = b.dataset.g; try { chrome.storage.local.set({ lnAiGroup: group }); } catch (_) {} drawList(); }));

    chrome.storage.local.get([KEY, "lnAiGroup", "lnAiAskScope"], (r) => {
      threads = r?.[KEY] || {};
      group = r?.lnAiGroup || "course";
      if (r?.lnAiAskScope) scope = r.lnAiAskScope;
      // Open the newest thread about what you're studying now, if any.
      LazyAIAsk.sources().then((s) => {
        now = s;
        const mine = Object.values(threads).filter((t) => t.course === s.course && t.topic === s.topicName).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        openId = mine?.id || null;
        drawThread();
        refresh();
      });
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "session" && c.lnDocPages) refresh();
      if (area === "local" && (c.activeCourse || c.activeTopic || c.lnDocs)) refresh();
      if (area === "local" && c[KEY] && !busy) { threads = c[KEY].newValue || {}; if (!threads[openId]) openId = null; drawThread(); if (!drawer.hidden) drawList(); }
    });
    return { focus: () => input.focus() };
  }

  return { mount };
})();
