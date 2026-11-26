// Lazy Notes — save a picture as a note ("figure"), shared by the readers.
//
//   LazyFigure.ask({ canvas | img, rect, el, page })
//     A small pop-up by `rect` (viewport coordinates): preview, a caption box
//     (focused; Enter saves, Esc cancels). Saved like a highlight with
//     category "figure", the picture as a data URL, the caption as its text,
//     and the same source link/title/page as text taken from `el`.
//   LazyFigure.imageButtons(root, selector, pageOf)
//     A "Save image" button on hover over matching images (slides, Word).
//
// Pictures are shrunk to at most 1200px wide and kept small (PNG, or JPEG
// when PNG would be big), so notes storage stays light.

globalThis.LazyFigure = (() => {
  const MAX_W = 1200;
  const MAX_BYTES = 600 * 1024;

  function toDataUrl(src, sw, sh) {
    const scale = Math.min(1, MAX_W / sw);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";              // transparent parts read as paper
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    src(ctx, c.width, c.height);
    let url = c.toDataURL("image/png");
    if (url.length * 0.75 > MAX_BYTES) url = c.toDataURL("image/jpeg", 0.85);
    if (url.length * 0.75 > MAX_BYTES) url = c.toDataURL("image/jpeg", 0.7);
    return url;
  }

  // A region of a canvas (in its own pixels).
  const fromCanvas = (canvas, x, y, w, h) =>
    toDataUrl((ctx, cw, ch) => ctx.drawImage(canvas, x, y, w, h, 0, 0, cw, ch), w, h);
  // A whole <img>.
  const fromImg = (img) =>
    toDataUrl((ctx, cw, ch) => ctx.drawImage(img, 0, 0, cw, ch), img.naturalWidth || img.width, img.naturalHeight || img.height);

  // ── The caption pop-up ────────────────────────────────────────────────────
  let pop = null;
  const STYLE = `
    .lnf-pop { position: fixed; z-index: 2147483000; width: 260px; padding: 12px; box-sizing: border-box;
      background: #1e1e24; color: #f0f0f0; border: 1px solid #33333d; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; }
    .lnf-pop img { display: block; max-width: 100%; max-height: 160px; margin: 0 auto 10px; border-radius: 5px; background: #fff; }
    .lnf-pop input { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #33333d; border-radius: 6px;
      background: #121216; color: #fff; font: inherit; outline: none; }
    .lnf-pop input:focus { border-color: #6366f1; }
    .lnf-hint { margin: 6px 0 10px; color: #8e8e99; font-size: 10.5px; }
    .lnf-warn { margin: 0 0 8px; color: #ef6461; }
    .lnf-row { display: flex; justify-content: flex-end; gap: 6px; }
    .lnf-pop button { border: 0; border-radius: 5px; padding: 5px 12px; font: inherit; cursor: pointer; }
    .lnf-cancel { background: #2a2a32; color: #d4d4d8; }
    .lnf-save { background: #4f46e5; color: #fff; }
    .lnf-save:disabled { opacity: .45; cursor: default; }
    .lnf-toast { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: flex; gap: 12px; align-items: center;
      padding: 10px 10px 10px 14px; background: #1e1e24; color: #f0f0f0; border: 1px solid #33333d; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.3); font: 13px -apple-system, "Segoe UI", Roboto, sans-serif; }
    .lnf-toast button { border: 0; background: transparent; color: #a5b4fc; font: 600 13px inherit; cursor: pointer; padding: 4px 6px; }
    .lnf-imgbtn { position: fixed; z-index: 2147482000; display: none; padding: 4px 9px; border: 0; border-radius: 6px;
      background: rgba(30,30,36,.92); color: #fff; font: 600 12px -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.3); }
    .lnf-imgbtn:hover { background: #4f46e5; }`;
  function ensureStyle() {
    if (document.getElementById("lnf-style")) return;
    const st = document.createElement("style");
    st.id = "lnf-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  function close() { pop?.remove(); pop = null; }

  async function ask({ dataUrl, rect, el, page, onDone }) {
    ensureStyle();
    close();
    const { activeCourse, activeTopic } = await chrome.storage.local.get(["activeCourse", "activeTopic"]);
    pop = document.createElement("div");
    pop.className = "lnf-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Save figure");
    pop.innerHTML = `<img alt=""><input type="text" placeholder="Caption (optional)" aria-label="Caption">
      <div class="lnf-hint">Saved as a Figure · Enter saves · Esc cancels</div>
      <div class="lnf-warn" hidden>Pick a course and topic in the Lazy Notes side panel first.</div>
      <div class="lnf-row"><button type="button" class="lnf-cancel">Cancel</button><button type="button" class="lnf-save">Save</button></div>`;
    pop.querySelector("img").src = dataUrl;
    const input = pop.querySelector("input");
    const save = pop.querySelector(".lnf-save");
    const ready = !!(activeCourse && activeTopic);
    pop.querySelector(".lnf-warn").hidden = ready;
    save.disabled = !ready;
    document.body.appendChild(pop);

    // Beside the snipped area: right of it, else left, else below/above.
    const w = pop.offsetWidth, h = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
    let left = rect.right + 12, top = rect.top;
    if (left + w > vw - 8) left = rect.left - w - 12;
    if (left < 8) { left = Math.min(Math.max(8, rect.left), vw - w - 8); top = rect.bottom + 10 + h > vh ? rect.top - h - 10 : rect.bottom + 10; }
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${Math.max(8, Math.min(top, vh - h - 8))}px`;

    const done = (saved) => { close(); onDone?.(saved); };
    const doSave = async () => {
      if (!ready) return;
      const host = globalThis.LazyNotesHost;
      const msg = {
        type: "NEW_HIGHLIGHT", id: crypto.randomUUID(), category: "figure", image: dataUrl,
        text: input.value.trim(), context: null, annotation: "",
        course: activeCourse, topic: activeTopic,
        sourceUrl: host?.sourceUrl ? host.sourceUrl(el) : location.href,
        sourceTitle: host?.sourceTitle ? host.sourceTitle(el) : document.title || null,
        anchor: page ? { page, occurrence: 0 } : null
      };
      try { chrome.runtime.sendMessage(msg); } catch (_) { return; }
      toast(msg);
      done(true);
    };
    save.addEventListener("click", doSave);
    pop.querySelector(".lnf-cancel").addEventListener("click", () => done(false));
    pop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      if (e.key === "Enter" && !e.isComposing && e.target !== pop.querySelector(".lnf-cancel")) { e.preventDefault(); doSave(); }
    });
    pop.addEventListener("mousedown", (e) => e.stopPropagation());
    setTimeout(() => input.focus(), 0);
  }

  // "Figure saved to … · Undo", 6 seconds.
  function toast(saved) {
    ensureStyle();
    document.querySelector(".lnf-toast")?.remove();
    const t = document.createElement("div");
    t.className = "lnf-toast";
    t.setAttribute("role", "status");
    const msg = document.createElement("span");
    msg.textContent = `Figure saved to ${saved.course} › ${saved.topic}`;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "DELETE_HIGHLIGHT", id: saved.id, courseName: saved.course, topicName: saved.topic });
      t.remove();
    });
    t.append(msg, undo);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  // ── "Save image" on hover (slides, Word) ──────────────────────────────────
  function imageButtons(root, selector, pageOf) {
    ensureStyle();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lnf-imgbtn";
    btn.textContent = "Save image";
    btn.title = "Save this picture as a note";
    document.body.appendChild(btn);
    let current = null, hideTimer = null;
    const place = () => {
      if (!current) return;
      const r = current.getBoundingClientRect();
      btn.style.left = `${Math.max(4, r.right - btn.offsetWidth - 6)}px`;
      btn.style.top = `${Math.max(4, r.top + 6)}px`;
    };
    root.addEventListener("mouseover", (e) => {
      const img = e.target.closest?.(selector);
      if (!img || !img.complete || (img.naturalWidth || 0) < 24) return;
      clearTimeout(hideTimer);
      current = img;
      btn.style.display = "block";
      place();
    });
    const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { btn.style.display = "none"; current = null; }, 250); };
    root.addEventListener("mouseout", (e) => { if (e.target.closest?.(selector) && e.relatedTarget !== btn) hideSoon(); });
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    btn.addEventListener("mouseleave", hideSoon);
    addEventListener("scroll", () => { btn.style.display = "none"; }, true);
    btn.addEventListener("click", () => {
      if (!current) return;
      const img = current;
      btn.style.display = "none";
      let dataUrl;
      try { dataUrl = fromImg(img); } catch (_) { return; }
      ask({ dataUrl, rect: img.getBoundingClientRect(), el: img, page: pageOf?.(img) ?? null });
    });
  }

  return { ask, fromCanvas, fromImg, imageButtons, close };
})();
