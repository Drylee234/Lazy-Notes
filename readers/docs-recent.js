// Lazy Notes — recent documents and where each one saves its notes.
// Loaded by every reader (pdfreader.html, pptxreader.html, docxreader.html).
//
// chrome.storage.local.lnDocs = { [key]: { key, name, kind, page, pages,
//   openedAt, course, topic } }, key = reader page + ?url=/?local= (no #),
// e.g. "/pdfreader.html?url=…". The side panel reads it for "Continue
// reading" and for "Saving to …" while a document is open.
//
// Each document remembers the course › topic that was active while it was
// open. Reopening it switches back to them, unless the user turned off
// "Switch to a document's course & topic" (lnDocAutoSelect === false).
//
// A NEW document no longer inherits the last course › topic: it starts with
// none and asks (a small box with a suggestion: the course code in the title,
// else the AI if it is on). Skip leaves it unfiled. Switch: lnAskPlace.

globalThis.LazyDocs = (() => {
  const MAX = 30;
  let key = null;
  let pageTimer = null;

  const keyNow = () => location.pathname + location.search;

  // One read-modify-write at a time: two overlapping updates (e.g. the
  // course changing while a document is being recorded) would drop one.
  let queue = Promise.resolve();
  const update = (fn) => (queue = queue.then(() => update1(fn), () => update1(fn)));
  async function update1(fn) {
    const { lnDocs = {} } = await chrome.storage.local.get("lnDocs");
    fn(lnDocs);
    const keys = Object.keys(lnDocs).sort((a, b) => (lnDocs[b].openedAt || 0) - (lnDocs[a].openedAt || 0));
    keys.slice(MAX).forEach((k) => delete lnDocs[k]);
    await chrome.storage.local.set({ lnDocs });
  }

  // A document finished loading: { kind: "pdf" | "pptx" | "docx", name, pages, page }
  async function opened({ kind, name, pages, page }) {
    key = keyNow();
    const { lnDocs = {}, lnDocAutoSelect, activeCourse, activeTopic, lazynotes } =
      await chrome.storage.local.get(["lnDocs", "lnDocAutoSelect", "activeCourse", "activeTopic", "lazynotes"]);
    const prev = lnDocs[key];
    const exists = (c, t) => !!lazynotes?.courses?.[c]?.topics?.[t];

    const { lnAskPlace } = await chrome.storage.local.get("lnAskPlace");
    const known = prev?.course && exists(prev.course, prev.topic);
    const ask = lnAskPlace !== false && !known && !prev?.asked;

    let course = activeCourse ?? null, topic = activeTopic ?? null;
    if (ask) {
      course = null; topic = null;
      await chrome.storage.local.remove(["activeCourse", "activeTopic"]);
    } else if (prev?.course && exists(prev.course, prev.topic) && lnDocAutoSelect !== false) {
      course = prev.course; topic = prev.topic;
      if (course !== activeCourse || topic !== activeTopic) {
        await chrome.storage.local.set({ activeCourse: course, activeTopic: topic });
      }
    } else if (prev?.course && lnDocAutoSelect === false) {
      course = prev.course; topic = prev.topic;   // keep what it had; just not switched
    }

    await update((docs) => {
      docs[key] = { ...prev, key, kind, name, pages, page: page ?? prev?.page ?? 1,
                    openedAt: Date.now(), course, topic };
    });
    // Opened from a course's page (All notes): that course is picked, so
    // only the topic is asked.
    const fromCourse = new URLSearchParams(location.search).get("course");
    if (ask) askWhere(name, lazynotes, lazynotes?.courses?.[fromCourse] ? fromCourse : null);
  }

  // ── "Where do these notes go?" ─────────────────────────────────────────────
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  // Course code (GET 205, BME213) in the document's name → that course.
  function guessByName(name, courses) {
    const n = norm(name);
    let best = null;
    for (const c of Object.keys(courses)) {
      const codes = (c.match(/[A-Za-z]{2,4}\s?\d{3}/g) || []).map(norm);
      const hit = codes.some((k) => n.includes(k)) || (norm(c).length >= 4 && n.includes(norm(c)));
      if (!hit) continue;
      const topics = Object.keys(courses[c].topics || {});
      const t = topics.find((x) => norm(x).length >= 4 && n.includes(norm(x))) || null;
      best = { course: c, topic: t };
      break;
    }
    return best;
  }

  async function guessByAi(name, courses, lnDocs) {
    const extra = JSON.stringify(Object.entries(courses).map(([c, v]) => ({
      course: c,
      topics: Object.keys(v.topics || {}),
      documents: Object.values(lnDocs).filter((d) => d.course === c).slice(0, 5).map((d) => d.name)
    })));
    const ready = await chrome.runtime.sendMessage({ type: "AI_READY" }).catch(() => null);
    if (!ready?.on || !ready.hasKey && ready.provider !== "server") return null;
    const r = await chrome.runtime.sendMessage({ type: "AI_RUN", task: "suggestPlace", text: name, extra }).catch(() => null);
    if (!r?.ok) return null;
    const [c, t] = String(r.text || "").split("|").map((x) => x.replace(/^[\s"'`*]+|[\s"'`*.]+$/g, ""));
    const course = Object.keys(courses).find((x) => norm(x) === norm(c));
    if (!course) return null;
    const topic = Object.keys(courses[course].topics || {}).find((x) => norm(x) === norm(t)) || null;
    return { course, topic, ai: true };
  }

  function askWhere(name, lazynotes, presetCourse = null) {
    const courses = lazynotes?.courses || {};
    const NEW = "\u0000new";
    const names = Object.keys(courses);
    const wrap = document.createElement("div");
    wrap.id = "ln-place";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Where do these notes go?");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);font:14px/1.4 var(--font,system-ui,sans-serif)";
    const box = document.createElement("div");
    box.style.cssText = "width:min(420px,92vw);background:var(--bg,#fff);color:var(--pri,#111);border:1px solid var(--border,#ddd);border-radius:12px;box-shadow:var(--shadow,0 8px 30px rgba(0,0,0,.3));padding:16px 18px";
    const mk = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
    const sel = "width:100%;margin-top:4px;padding:7px 8px;background:var(--surface,#f7f7f8);color:inherit;border:1px solid var(--border-strong,#ccc);border-radius:6px;font:inherit";
    const title = mk("div", "font-weight:700;font-size:15px", "Where do these notes go?");
    const doc = mk("div", "color:var(--sec,#666);margin:2px 0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", name);
    const hint = mk("div", "margin:0 0 10px;padding:6px 8px;border-radius:6px;background:var(--accent-soft,#eef);display:none");
    const lc = mk("label", "display:block;color:var(--sec,#666)", "Course");
    const cs = mk("select", sel);
    const lt = mk("label", "display:block;margin-top:10px;color:var(--sec,#666)", "Topic");
    const ts = mk("select", sel);
    lc.append(cs); lt.append(ts);
    const row = mk("div", "display:flex;gap:8px;justify-content:flex-end;margin-top:14px");
    const skip = mk("button", "padding:7px 12px;border:1px solid var(--border-strong,#ccc);background:transparent;color:inherit;border-radius:6px;cursor:pointer;font:inherit", "Not now");
    const ok = mk("button", "padding:7px 14px;border:0;background:var(--accent,#4f46e5);color:var(--on-accent,#fff);border-radius:6px;cursor:pointer;font:inherit;font-weight:600", "Save notes here");
    skip.type = ok.type = "button";
    row.append(skip, ok);
    box.append(title, doc, hint, lc, lt, row);
    wrap.append(box);

    const fillC = (v) => {
      cs.replaceChildren(new Option(names.length ? "Pick a course…" : "No courses yet", ""), ...names.map((n) => new Option(n, n)));
      cs.value = names.includes(v) ? v : "";
    };
    const fillT = (v) => {
      const topics = Object.keys(courses[cs.value]?.topics || {});
      ts.replaceChildren(new Option(cs.value ? (topics.length ? "Pick a topic…" : "No topics yet") : "", ""), ...topics.map((n) => new Option(n, n)),
        ...(cs.value ? [new Option("+ New topic…", NEW)] : []));
      // A course with one topic: that's the one (Enter saves straight away).
      ts.value = topics.includes(v) ? v : (v === null && topics.length === 1 ? topics[0] : "");
      ts.disabled = !cs.value;
      ok.disabled = !(cs.value && ts.value);
      ok.style.opacity = ok.disabled ? ".5" : "1";
    };
    const suggest = (g) => {
      if (!g || cs.value) return;
      const only = Object.keys(courses[g.course]?.topics || {});
      fillC(g.course); fillT(g.topic || (only.length === 1 ? only[0] : null));
      g = { ...g, topic: cs.value && ts.value || null };
      hint.style.display = "block";
      hint.textContent = `${g.ai ? "AI suggests" : "Looks like"}: ${g.course}${g.topic ? " › " + g.topic : ""}`;
      (g.topic ? ok : ts).focus();
    };
    fillC(""); fillT("");
    cs.addEventListener("change", () => { hint.style.display = "none"; fillT(null); (ts.value ? ok : cs.value ? ts : cs).focus(); });
    ts.addEventListener("change", async () => {
      if (ts.value === NEW) {
        // A new lecture usually wants a new topic: make it right here.
        const name = (prompt(`New topic in ${cs.value}:`) || "").trim();
        if (name) {
          await chrome.runtime.sendMessage({ type: "CREATE_TOPIC", courseName: cs.value, name }).catch(() => {});
          for (let i = 0; i < 20; i++) {
            const { lazynotes: fresh } = await chrome.storage.local.get("lazynotes");
            const made = Object.keys(fresh?.courses?.[cs.value]?.topics || {}).find((t) => t.toLowerCase().replace(/\s+/g, " ") === name.toLowerCase().replace(/\s+/g, " "));
            if (made) { courses[cs.value] = fresh.courses[cs.value]; fillT(made); break; }
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        if (ts.value === NEW) fillT("");
      }
      ok.disabled = !ts.value; ok.style.opacity = ok.disabled ? ".5" : "1"; if (ts.value) ok.focus();
    });

    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
    async function finish(save) {
      close();
      const course = save ? cs.value : null, topic = save ? ts.value : null;
      if (save) {
        await chrome.storage.local.set({ activeCourse: course, activeTopic: topic });
        // You just said where notes go: selecting text should now save.
        const { highlighterActive } = await chrome.storage.local.get("highlighterActive");
        if (!highlighterActive) chrome.runtime.sendMessage({ type: "TOGGLE_HIGHLIGHTER_REQUEST" }).catch(() => {});
      }
      await update((docs) => { if (docs[key]) Object.assign(docs[key], { course, topic, asked: true }); });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Enter" && !ok.disabled && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); finish(true); }
    }
    ok.addEventListener("click", () => finish(true));
    skip.addEventListener("click", () => finish(false));
    document.addEventListener("keydown", onKey, true);
    document.body.append(wrap);
    if (presetCourse) {
      fillC(presetCourse); fillT(null);
      (ts.value ? ok : ts).focus();
    } else (cs).focus();

    // Suggestion: the course code in the name is instant; the AI (if on)
    // fills in when it answers and nothing is picked yet.
    chrome.storage.local.get("lnDocs").then(async ({ lnDocs = {} }) => {
      const byName = guessByName(name, courses);
      if (byName) { suggest(byName); return; }
      if (names.length) suggest(await guessByAi(name, courses, lnDocs));
    });
  }

  function page(n) {
    if (!key) return;
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => update((docs) => { if (docs[key]) docs[key].page = n; }), 800);
  }

  // The course/topic changed while this document is the one being read:
  // that's now where it saves.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !key || document.visibilityState !== "visible") return;
    if (!changes.activeCourse && !changes.activeTopic) return;
    chrome.storage.local.get(["activeCourse", "activeTopic"], ({ activeCourse, activeTopic }) => {
      update((docs) => {
        if (docs[key]) Object.assign(docs[key], { course: activeCourse ?? null, topic: activeTopic ?? null });
      });
    });
  });

  return { opened, page };
})();
