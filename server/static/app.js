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

  function noteHtml(n, next, prev) {
    // The source shows only where it changes, not under every note.
    const showSrc = !prev || (prev.sourceTitle || prev.sourceUrl) !== (n.sourceTitle || n.sourceUrl);
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
    view.innerHTML = `<form class="key-card" id="key-form">
      <p>Enter the key you set for your Lazy Notes server (the same one the extension syncs with).</p>
      <input id="key-input" type="password" autocomplete="current-password" placeholder="Your key" required>
      <button class="btn" type="submit">Open my notes</button>
      <div class="err" id="key-err">${esc(error)}</div></form>`;
    $("key-form").onsubmit = (e) => {
      e.preventDefault();
      key = $("key-input").value.trim();
      if (!key) return;
      store.set("ln-key", key);
      route();
      load();
    };
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

  function topicScreen(courseName, topicName) {
    const t = courses()[courseName]?.topics?.[topicName];
    setBar(topicName, courseName, `#/course/${enc(courseName)}`);
    searchWrap.hidden = true;
    if (!t) { view.innerHTML = `<div class="empty">This topic isn't in the last sync.</div>`; return; }
    const notes = topicNotes(t);
    view.innerHTML = notes.length
      ? `<div class="notes">${notes.map((n, i) => noteHtml(n, notes[i + 1], notes[i - 1])).join("")}</div>`
      : `<div class="empty">No notes in this topic yet.</div>`;
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
    key = ""; snap = null;
    store.del("ln-key"); store.del("ln-snapshot");
    location.hash = "#/";
    route();
  });
  // Coming back to the page (phone unlocked, tab switched): refresh.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && key) load(); });

  route();
  load();
})();
