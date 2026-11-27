// Lazy Notes — mobile reader (read-only). Shows the last snapshot the
// extension synced: Courses → Topics → a topic's notes, plus search.
// The key lives in localStorage; the last snapshot is cached there too, so
// the page shows something at once (and offline), then refreshes.

(() => {
  const $ = (id) => document.getElementById(id);
  const view = $("view"), title = $("title"), crumb = $("crumb"), status = $("status");
  const backBtn = $("back"), menuBtn = $("menu-btn"), menu = $("menu");
  const searchWrap = $("search-wrap"), search = $("search");

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} }
  };

  let key = store.get("ln-key") || "";
  let snap = null;   // { savedAt, data }
  try { snap = JSON.parse(store.get("ln-snapshot") || "null"); } catch (_) {}

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const enc = encodeURIComponent, dec = decodeURIComponent;

  // ── Loading ──
  async function load() {
    if (!key) return;
    status.textContent = snap ? `Last synced ${ago(snap.savedAt)} · checking…` : "Loading…";
    try {
      const r = await fetch("/api/snapshot", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
      if (r.status === 401) { key = ""; store.del("ln-key"); route(); keyError("That key didn't work."); return; }
      if (r.status === 404) { snap = null; status.textContent = "Nothing synced yet: turn on sync in the extension."; route(); return; }
      if (!r.ok) throw new Error(`server answered ${r.status}`);
      snap = await r.json();
      store.set("ln-snapshot", JSON.stringify(snap));
      route();
    } catch (err) {
      status.textContent = snap ? `Offline · showing what was synced ${ago(snap.savedAt)}` : `Couldn't reach the server (${err.message}).`;
    }
  }

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  const courses = () => snap?.data?.lazynotes?.courses || {};
  const timeOf = (n) => Date.parse(n.timestamp) || 0;
  const orderOf = (n) => (typeof n.order === "number" ? n.order : timeOf(n));

  function topicNotes(topic) {
    const hs = Object.entries(topic.highlights || {}).map(([id, h]) => ({ id, kind: "highlight", ...h }));
    const ts = Object.entries(topic.notes || {}).map(([id, n]) => ({ id, kind: "typed", ...n }));
    return [...hs, ...ts].sort((a, b) => orderOf(a) - orderOf(b) || timeOf(a) - timeOf(b));
  }
  const lastTime = (topic) => Math.max(0, ...topicNotes(topic).map(timeOf));

  // ── Rendering notes ──
  const inline = (s) => esc(s)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, "<mark>$1</mark>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, "$1<em>$2</em>");

  // Typed notes: # headings, - / 1. lists (2 spaces per level), > quotes.
  function typedHtml(text) {
    const out = [];
    const stack = [];
    let para = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
    const closeAll = () => { while (stack.length) out.push(`</li></${stack.pop()}>`); };
    String(text || "").split("\n").forEach((raw) => {
      const line = raw.replace(/\s+$/, "");
      let m;
      if ((m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) {
        flushPara();
        const level = Math.floor(m[1].length / 2), tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > level + 1) out.push(`</li></${stack.pop()}>`);
        if (stack.length === level + 1) {
          if (stack[stack.length - 1] === tag) out.push("</li>");
          else { out.push(`</li></${stack.pop()}><${tag}>`); stack.push(tag); }
        } else { out.push(`<${tag}>`); stack.push(tag); }
        out.push(`<li>${inline(m[3])}`);
        return;
      }
      closeAll();
      if (!line.trim()) { flushPara(); return; }
      if ((m = line.match(/^(#{1,3})\s+(.+)$/))) { flushPara(); out.push(`<div class="th th${m[1].length}">${inline(m[2])}</div>`); return; }
      if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); return; }
      para.push(line);
    });
    flushPara();
    closeAll();
    return out.join("");
  }

  const BULLETS = ["•", "◦", "▪", "▫"];

  let mixedSources = false;
  function noteHtml(n, next, prev) {
    // The source shows only where it changes, not under every note.
    // And only in a topic that mixes sources: one document = no repeated file name.
    const showSrc = mixedSources && (!prev || (prev.sourceTitle || prev.sourceUrl) !== (n.sourceTitle || n.sourceUrl));
    const indent = Math.max(0, Math.min(3, n.indent || 0));
    const style = `style="--indent:${indent * 18}px;--bullet:'${BULLETS[indent]}'"`;
    if (n.kind === "typed") return `<div class="note typed" ${style}>${typedHtml(n.text)}</div>`;

    const cat = n.category || "generic";
    const cls = `note note--${cat.replace(/\s+/g, "-")}`;
    let body;
    if (cat === "figure") {
      body = `<figure style="margin:0">${n.image ? `<img src="${esc(n.image)}" alt="${esc(n.text || "Figure")}" loading="lazy">` : ""}` +
             `${n.text ? `<figcaption>${esc(n.text)}</figcaption>` : ""}</figure>`;
    } else {
      let text = esc(n.text);
      if (cat === "definition") {
        const m = String(n.text).match(/^([^:–—]{1,60}?)(\s*(?::|\s[-–—]\s))([\s\S]*)$/);
        if (m) text = `<span class="term">${esc(m[1])}</span>${esc(m[2])}${esc(m[3])}`;
      }
      const ended = /[:：]\s*$/.test(n.text || "");
      const listHead = cat === "list head" || (cat === "generic" && next?.category === "list point" && next.kind !== "typed");
      if (listHead && !ended) text += ":";
      if (cat === "note") text = `<span class="callout">Important:</span> ${text}`;
      body = `<span class="note-text"><span class="hl">${text}</span></span>`;
      if (cat === "formula" && n.context) body += `<div class="context">${esc(n.context)}</div>`;
      if (listHead && cat === "generic") return `<div class="${cls} list-head-auto" ${style}>${body}${showSrc ? meta(n) : ""}</div>`;
    }
    return `<div class="${cls}" ${style}>${body}${n.annotation ? `<div class="annot">${esc(n.annotation)}</div>` : ""}${showSrc ? meta(n) : ""}</div>`;
  }

  function meta(n) {
    if (!n.sourceTitle && !n.sourceUrl) return "";
    const label = n.sourceTitle || (() => { try { return new URL(n.sourceUrl).hostname; } catch (_) { return "source"; } })();
    // Links into the extension's own reader only work on the computer.
    const url = /^https?:/i.test(n.sourceUrl || "") ? n.sourceUrl : "";
    return `<div class="meta">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label)}</div>`;
  }

  // ── Screens ──
  function setBar(t, c = "", back = null) {
    title.textContent = t;
    crumb.textContent = c;
    backBtn.hidden = !back;
    backBtn.onclick = back ? () => { location.hash = back; } : null;
    menuBtn.hidden = !key;
  }

  function keyScreen(error = "") {
    setBar("Lazy Notes");
    searchWrap.hidden = true;
    status.textContent = "";
    view.innerHTML = `<form class="key-card" id="login-form">
      <p>Log in with the account you made in the extension (Settings › Sync).</p>
      <input id="login-user" type="text" autocomplete="username" autocapitalize="none" placeholder="Username" required>
      <input id="login-pass" type="password" autocomplete="current-password" placeholder="Password" required>
      <button class="btn" type="submit">Log in</button>
      <div class="err" id="key-err">${esc(error)}</div>
      <details class="key-alt"><summary>Use the server key instead</summary>
        <input id="key-input" type="password" autocomplete="off" placeholder="Server key (LAZYNOTES_KEY)">
        <button class="btn" type="button" id="key-go">Open my notes</button></details></form>`;
    const useKey = (k) => { key = k; store.set("ln-key", key); route(); load(); };
    $("login-form").onsubmit = async (e) => {
      e.preventDefault();
      keyError("Logging in…");
      try {
        const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: $("login-user").value.trim(), password: $("login-pass").value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { keyError(j.reason || `The server answered ${r.status}.`); return; }
        store.set("ln-user", j.username);
        useKey(j.token);
      } catch (_) { keyError("Couldn't reach the server. Check your internet."); }
    };
    $("key-go").onclick = () => { const k = $("key-input").value.trim(); if (k) useKey(k); };
  }

  // A shared topic (/s/<id>): anyone with the link can read it; no login.
  async function sharedScreen(id) {
    setBar("Shared notes");
    menuBtn.hidden = true;
    searchWrap.hidden = true;
    view.innerHTML = `<div class="empty">Loading…</div>`;
    try {
      const r = await fetch(`/api/share/${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { view.innerHTML = `<div class="empty">${esc(j.reason || "That shared link doesn't work.")}</div>`; return; }
      setBar(j.topic || "Shared notes", `${j.course || ""} · shared by ${j.from || "someone"}`);
      menuBtn.hidden = true;
      const notes = topicNotes(j.notes || {});
      mixedSources = false;
      view.innerHTML = `<div class="notes">${notes.map((n, i) => noteHtml(n, notes[i + 1], notes[i - 1])).join("")}</div>
        <p class="shared-foot">A copy, as it was when it was shared. To keep it, paste this link in the Lazy Notes extension: Settings › Sync › Add shared notes.</p>`;
      status.textContent = `Shared ${ago(j.createdAt)}`;
    } catch (_) { view.innerHTML = `<div class="empty">Couldn't reach the server.</div>`; }
  }
  const keyError = (msg) => { const el = $("key-err"); if (el) el.textContent = msg; };

  function coursesScreen() {
    setBar("Your notes");
    searchWrap.hidden = false;
    const cs = Object.entries(courses()).map(([name, c]) => {
      const topics = Object.values(c.topics || {});
      return { name, count: topics.length, last: Math.max(0, ...topics.map(lastTime)) };
    }).sort((a, b) => b.last - a.last);
    if (!cs.length) { view.innerHTML = `<div class="empty">${snap ? "No courses yet." : "Loading…"}</div>`; return; }
    view.innerHTML = `<div class="section-title">Courses</div><ul class="list">${cs.map((c) => `
      <li><a class="row" href="#/course/${enc(c.name)}"><span class="row-main">
        <div class="row-name">${esc(c.name)}</div>
        <div class="row-meta">${c.count} topic${c.count === 1 ? "" : "s"}${c.last ? ` · updated ${ago(new Date(c.last).toISOString())}` : ""}</div>
      </span><span class="chev">›</span></a></li>`).join("")}</ul>`;
  }

  function topicsScreen(courseName) {
    const c = courses()[courseName];
    setBar(courseName, "Courses", "#/");
    searchWrap.hidden = true;
    if (!c) { view.innerHTML = `<div class="empty">This course isn't in the last sync.</div>`; return; }
    const ts = Object.entries(c.topics || {}).map(([name, t]) => ({ name, count: topicNotes(t).length, last: lastTime(t) }))
      .sort((a, b) => b.last - a.last);
    view.innerHTML = ts.length ? `<ul class="list">${ts.map((t) => `
      <li><a class="row" href="#/course/${enc(courseName)}/topic/${enc(t.name)}"><span class="row-main">
        <div class="row-name">${esc(t.name)}</div>
        <div class="row-meta">${t.count} note${t.count === 1 ? "" : "s"}${t.last ? ` · ${ago(new Date(t.last).toISOString())}` : ""}</div>
      </span><span class="chev">›</span></a></li>`).join("")}</ul>` : `<div class="empty">No topics yet.</div>`;
  }

  // ── Ask the AI about a topic (the server holds the AI key) ──
  // Same wording as the extension's jobs (background/bg_ai.js), so answers
  // match. Answers are for reading only: the phone never changes your notes.
  const AI_SYSTEM = "You help a student keep study notes. Answer with the result only — no greeting, no explanation of what you did, no markdown code fences. Keep the student's own wording wherever it is already fine. Never invent facts that are not in what you were given.";
  const AI_JOBS = {
    summarise: { label: "Summary", maxTokens: 1500, prompt: (t) =>
      `Here are a student's notes on one topic. Write a short summary of them: 3 to 6 lines, each a single point, no numbering, no heading. Only use what is in the notes.\n\n---\n${t}` },
    quiz: { label: "Test questions", maxTokens: 1500, prompt: (t) =>
      `Write 5 short test-yourself questions from these notes, one per line, numbered. Each must be answerable from the notes. No answers.\n\n---\n${t}` },
    ask: { label: "", maxTokens: 1200, prompt: (t, q) =>
      `Answer this question about the passage below, for a student revising. Use only what the passage says; if it doesn't say, answer "The passage doesn't say" and then give the general answer in one line, marked "(general)". Keep it under 6 lines.\n\nQuestion: ${q}\n\n--- passage ---\n${t}` }
  };
  let aiState = null;   // null = not checked yet, true = ready, string = why not
  async function aiCheck() {
    if (aiState !== null) return aiState;
    try {
      const r = await fetch("/api/ai/status", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      aiState = r.ok && j.ok ? true : (j.reason || "The AI isn't set up on your server.");
    } catch (_) { return "Needs the internet."; }
    return aiState;
  }
  function plainNotes(notes) {
    return notes.filter((n) => n.category !== "figure").map((n) => {
      const pad = "  ".repeat(Math.max(0, Math.min(3, n.indent || 0)));
      const extra = n.annotation ? ` (my note: ${n.annotation})` : "";
      return n.text ? pad + String(n.text).split("\n").join(`\n${pad}`) + extra : "";
    }).filter(Boolean).join("\n");
  }
  function aiBar(notes) {
    const box = document.createElement("section");
    box.className = "ai";
    box.innerHTML = `<form class="ai-row" autocomplete="off">
        <input class="ai-q" type="text" enterkeyhint="send" placeholder="Ask about this topic…" aria-label="Ask the AI about this topic">
        <button class="ai-go" type="submit">Ask</button></form>
      <div class="ai-row"><button type="button" class="ai-job" data-job="summarise">Summarise</button>
        <button type="button" class="ai-job" data-job="quiz">Quiz me</button><span class="ai-why"></span></div>
      <div class="ai-answers"></div>`;
    const q = box.querySelector(".ai-q"), answers = box.querySelector(".ai-answers"), why = box.querySelector(".ai-why");
    const controls = box.querySelectorAll("button, input");
    aiCheck().then((st) => {
      if (st === true) return;
      controls.forEach((c) => { c.disabled = true; });
      why.textContent = st;
    });
    async function run(job, question = "") {
      const text = plainNotes(notes);
      if (!text) return;
      const card = document.createElement("article");
      card.className = "ai-card";
      card.innerHTML = `<div class="ai-card-head"><span class="ai-badge">AI</span><b></b></div><div class="ai-text">Thinking…</div>`;
      card.querySelector("b").textContent = question || AI_JOBS[job].label;
      answers.prepend(card);
      const out = card.querySelector(".ai-text");
      try {
        const r = await fetch("/api/ai", {
          method: "POST", cache: "no-store",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ system: AI_SYSTEM, prompt: AI_JOBS[job].prompt(text, question), max_tokens: AI_JOBS[job].maxTokens })
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) out.textContent = j.text;
        else { card.classList.add("failed"); out.textContent = `${j.reason || `The server answered ${r.status}.`}${j.code ? ` [${j.code}]` : ""}`; }
      } catch (_) {
        card.classList.add("failed");
        out.textContent = "Couldn't reach your server. The AI needs the internet.";
      }
    }
    box.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = q.value.trim(); if (v) { q.value = ""; run("ask", v); } };
    box.querySelectorAll(".ai-job").forEach((b) => { b.onclick = () => run(b.dataset.job); });
    return box;
  }

  function topicScreen(courseName, topicName) {
    const t = courses()[courseName]?.topics?.[topicName];
    setBar(topicName, courseName, `#/course/${enc(courseName)}`);
    searchWrap.hidden = true;
    if (!t) { view.innerHTML = `<div class="empty">This topic isn't in the last sync.</div>`; return; }
    const notes = topicNotes(t);
    view.innerHTML = notes.length
      ? `<div class="notes">${(mixedSources = new Set(notes.filter((n) => n.kind !== "typed").map((n) => n.sourceTitle || n.sourceUrl || "")).size > 1, "")}${notes.map((n, i) => noteHtml(n, notes[i + 1], notes[i - 1])).join("")}</div>`
      : `<div class="empty">No notes in this topic yet.</div>`;
    if (notes.length) view.prepend(aiBar(notes));
    window.scrollTo(0, 0);
  }

  function searchScreen(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    Object.entries(courses()).forEach(([cn, c]) => Object.entries(c.topics || {}).forEach(([tn, t]) =>
      topicNotes(t).forEach((n) => {
        const hay = `${n.text || ""} ${n.annotation || ""}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) hits.push({ cn, tn, n });
      })));
    // Typed notes' formatting marks aren't shown in a snippet.
    const plain = (t) => String(t).replace(/^\s*(#{1,3}|[-*•>]|\d+[.)])\s+/gm, "").replace(/\*\*|==/g, "")
      .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1").replace(/\s+/g, " ").trim();
    const mark = (s) => {
      let h = esc(s.length > 160 ? s.slice(0, 157) + "…" : s);
      words.forEach((w) => { h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); });
      return h;
    };
    view.innerHTML = hits.length ? `<div class="section-title">${hits.length} match${hits.length === 1 ? "" : "es"}</div><ul class="list">${hits.slice(0, 100).map((h) => `
      <li><a class="row" href="#/course/${enc(h.cn)}/topic/${enc(h.tn)}"><span class="row-main">
        <div class="row-meta">${esc(h.cn)} › ${esc(h.tn)}</div>
        <div class="row-snip">${mark(plain(h.n.text || h.n.annotation || ""))}</div>
      </span></a></li>`).join("")}</ul>` : `<div class="empty">No notes match “${esc(q)}”.</div>`;
  }

  function route() {
    menu.hidden = true;
    const shared = location.pathname.match(/^\/s\/([\w-]+)/);
    if (shared) { sharedScreen(shared[1]); return; }
    if (!key) { keyScreen(); return; }
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(dec);
    if (parts[0] === "course" && parts[2] === "topic") topicScreen(parts[1], parts[3]);
    else if (parts[0] === "course") topicsScreen(parts[1]);
    else if (search.value.trim()) { coursesScreenBar(); searchScreen(search.value.trim()); }
    else coursesScreen();
    if (snap) status.textContent = `Last synced ${ago(snap.savedAt)}`;
  }
  const coursesScreenBar = () => { setBar("Your notes"); searchWrap.hidden = false; };

  search.addEventListener("input", () => { if (!location.hash || location.hash === "#/") route(); else location.hash = "#/"; });
  window.addEventListener("hashchange", route);
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  $("refresh").addEventListener("click", () => { menu.hidden = true; load(); });
  $("forget").addEventListener("click", () => {
    if (key && store.get("ln-user")) fetch("/api/logout", { method: "POST", headers: { Authorization: `Bearer ${key}` } }).catch(() => {});
    key = ""; snap = null;
    store.del("ln-key"); store.del("ln-snapshot"); store.del("ln-user");
    location.hash = "#/";
    route();
  });
  // Coming back to the page (phone unlocked, tab switched): refresh.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && key) load(); });

  route();
  if (!/^\/s\//.test(location.pathname)) load();
})();
