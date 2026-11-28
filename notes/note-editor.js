// Q-notes — the editor for a saved highlight, shared by the All notes
// viewer and the side panel's Study tab. Plain script; needs notes-render.js
// (CATEGORY_LABELS). Styles live in notes.css.
//
// Only the text shows at first. Type, annotation and context fold under a
// "More" line (which says what's in there), so fixing a word stays a small
// thing. Enter saves, Shift+Enter starts a new line, Esc cancels, and Delete
// needs a second click.

// noteEditor(note, { onSave, onCancel, onDelete }) → the form element.
//   onSave({ text, category, annotation, context })   may return a promise
//   onDelete() → promise of true once deleted
//   onAiNote({ text, category }) → promise of true: save a brand-new note in
//     the same topic (used by 📖 Define). Without it, Define isn't offered.
// form.focusText() puts the cursor at the end of the text.
// Compact (default): the note keeps its own place and look while you edit its
// words; type / annotation / context / AI / Delete sit behind "⋯" (Alt+M).
// The caller puts a compact form where the note's text was (form.inPlace).
// Settings › Old ways › "Big edit card" (lnEditCard = "full") = the old card.
let lnEditCardFull = false;
try {
  chrome.storage.local.get("lnEditCard", (r) => { lnEditCardFull = r?.lnEditCard === "full"; });
  chrome.storage.onChanged.addListener((c, a) => { if (a === "local" && c.lnEditCard) lnEditCardFull = c.lnEditCard.newValue === "full"; });
} catch (_) {}

function noteEditor(note, { onSave, onCancel, onDelete, onConvert, onAiNote }) {
  const form = document.createElement("div");
  form.className = "edit-form";
  form.inPlace = !lnEditCardFull;
  if (form.inPlace) form.classList.add("compact");
  form.addEventListener("click", (e) => e.stopPropagation());

  const isFigure   = note.category === "figure";   // a picture: only its caption is text
  const text       = editorArea(note.text, isFigure ? "Caption (optional)" : "Highlighted text", isFigure ? "Caption" : "Text");
  const annotation = editorArea(note.annotation, "Your own note about this (optional)", "Annotation");
  const context    = editorArea(note.context, "Surrounding text (optional)", "Context");
  text.classList.add("edit-text");

  const type = document.createElement("select");
  type.setAttribute("aria-label", "Type");
  const offered = PICK_TYPES.includes(note.category) ? PICK_TYPES : [...PICK_TYPES, note.category];
  offered.map((v) => [v, CATEGORY_LABELS[v] || v]).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === note.category;
    type.appendChild(opt);
  });

  // "My note": turn the highlight into one of your own typed notes (Study
  // tab only, where onConvert is given).
  if (onConvert) type.add(new Option("Note (your own, typed)", "__typed__"));

  // Type › Annotation › Context: each folded on its own line, which says
  // what's in it; click a line to open just that one.
  const more = document.createElement("div");
  more.className = "edit-folds";
  const fold = (field, describe) => {
    const d = document.createElement("details");
    d.className = "edit-fold";
    const sum = document.createElement("summary");
    const redraw = () => { sum.textContent = describe(); };
    redraw();
    d.append(sum, field);
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      const area = field.querySelector("textarea, select");
      if (area?.tagName === "TEXTAREA") fitEditorArea(area);
      area?.focus();
    });
    return { d, redraw };
  };
  const short = (v) => (v.length > 28 ? v.slice(0, 27) + "…" : v);
  // Type: a small button; the choices float beside it instead of opening
  // a field inside the editor.
  const typeName = () => (type.value === "__typed__" ? "Note" : (CATEGORY_LABELS[type.value] || type.value));
  const typeBtn = document.createElement("button");
  typeBtn.type = "button";
  typeBtn.className = "edit-type-btn";
  const palette = document.createElement("div");
  palette.className = "type-palette";
  palette.hidden = true;
  palette.setAttribute("role", "listbox");
  const drawPalette = () => {
    palette.replaceChildren(...[...type.options].map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "type-palette-item" + (o.value === type.value ? " on" : "");
      b.textContent = o.textContent;
      b.addEventListener("click", () => {
        type.value = o.value;
        type.dispatchEvent(new Event("change"));
        palette.hidden = true;
        typeBtn.focus();
      });
      return b;
    }));
  };
  typeBtn.addEventListener("click", () => {
    drawPalette();
    palette.hidden = !palette.hidden;
    if (!palette.hidden) {
      palette.style.left = `${typeBtn.offsetLeft + typeBtn.offsetWidth + 6}px`;
      palette.style.top = `${Math.max(0, typeBtn.offsetTop - 40)}px`;
      palette.querySelector(".on")?.focus();
    }
  });
  palette.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); palette.hidden = true; typeBtn.focus(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...palette.children];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  const fType = { d: typeBtn, redraw: () => { typeBtn.textContent = `${typeName()} ›`; } };
  fType.redraw();
  const fAnn  = fold(editorField("Annotation", annotation), () => `Annotation ${annotation.value.trim() ? "· " + short(annotation.value.trim()) : "›"}`);
  const fCtx  = fold(editorField("Context", context), () => `Context ${context.value.trim() ? "· " + short(context.value.trim()) : "›"}`);
  type.addEventListener("change", fType.redraw);
  annotation.addEventListener("input", fAnn.redraw);
  context.addEventListener("input", fCtx.redraw);
  more.append(fType.d, fAnn.d, fCtx.d);
  form.appendChild(palette);


  // ── AI help (Settings › AI). The row only appears when the AI is on, and
  //    nothing here saves by itself: it fills the boxes you can already see
  //    and edit, and a second press puts things back.
  const aiRow = document.createElement("div");
  aiRow.className = "edit-ai";
  aiRow.hidden = true;
  const AIP = globalThis.LazyAIProviders;

  function aiButton(label, title, run) {
    const b = editorButton(label, "edit-btn edit-ai-btn");
    b.title = title;
    let before = null;          // what it said before the AI changed it
    const reset = (ms) => setTimeout(() => { b.textContent = label; b.title = title; b.disabled = false; }, ms);
    b.addEventListener("click", async () => {
      if (before !== null) { before.undo(); before = null; b.textContent = label; b.title = title; return; }
      const words = text.value.trim();
      if (!words) { text.focus(); return; }
      b.disabled = true;
      b.textContent = "…";
      const out = await run(words);
      b.disabled = false;
      if (out?.ok) {
        if (out.undo) { before = { undo: out.undo }; b.textContent = "↩ Undo"; b.title = "Put it back as it was"; }
        else { b.textContent = out.said || "Saved"; reset(3000); }
      } else {
        b.textContent = "didn't work";
        b.title = out?.reason || "The AI couldn't be reached.";
        reset(5000);
      }
    });
    return b;
  }

  // ✨ Tidy — clean the highlighted words up, in place.
  aiRow.appendChild(aiButton("✨ Tidy", "Fix broken lines and typing in the text above", async (words) => {
    const r = await AIP.ask("tidy", words);
    if (!r.ok) return r;
    const was = text.value;
    text.value = r.text;
    fitEditorArea(text);
    return { ok: true, undo: () => { text.value = was; fitEditorArea(text); } };
  }));

  // 💡 Explain — plain words, into your own note about this highlight.
  aiRow.appendChild(aiButton("💡 Explain", "Explain this in plain words, into the Annotation", async (words) => {
    const r = await AIP.ask("explain", words);
    if (!r.ok) return r;
    const was = annotation.value;
    annotation.value = was.trim() ? `${was.trim()}\n${r.text}` : r.text;
    fAnn.redraw();
    fAnn.d.open = true;
    fitEditorArea(annotation);
    return { ok: true, undo: () => { annotation.value = was; fAnn.redraw(); fitEditorArea(annotation); } };
  }));

  // 📖 Define — a definition of this term, saved as its own Definition note.
  if (onAiNote) {
    aiRow.appendChild(aiButton("📖 Define", "Write a definition of this and keep it as its own Definition note", async (words) => {
      const r = await AIP.ask("define", words);
      if (!r.ok) return r;
      const saved = await onAiNote({ text: r.text, category: "definition" });
      return saved ? { ok: true, said: "✓ Definition saved" } : { ok: false, reason: "The note couldn't be saved." };
    }));
  }

  if (AIP) AIP.ready().then((st) => { aiRow.hidden = !(st.on && st.hasKey); });

  // ── Footer: Delete (two clicks) · Cancel · Save ──
  const footer = document.createElement("div");
  footer.className = "edit-form-footer";

  const del = editorButton("Delete", "edit-btn edit-delete");
  let armTimer = null;
  const disarm = () => {
    clearTimeout(armTimer);
    del.classList.remove("armed");
    del.textContent = "Delete";
  };
  del.addEventListener("click", async () => {
    if (!del.classList.contains("armed")) {
      del.classList.add("armed");
      del.textContent = "Delete note?";
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    del.disabled = true;
    if (!await onDelete()) del.disabled = false;
  });
  del.addEventListener("blur", disarm);

  const cancel = editorButton("Cancel", "edit-btn");
  const save   = editorButton("Save", "edit-btn primary");
  cancel.addEventListener("click", () => onCancel());
  save.addEventListener("click", () => submit());

  async function submit() {
    const fields = {
      text:       text.value.trim(),
      category:   type.value,
      annotation: annotation.value.trim() || null,
      context:    context.value.trim() || null
    };
    if (!fields.text && !isFigure) {    // emptying the text isn't how to delete: that's Delete
      text.focus();
      return;
    }
    save.disabled = true;
    try {
      if (fields.category === "__typed__" && onConvert) await onConvert(fields);
      else await onSave(fields);
    } finally { save.disabled = false; }
  }

  footer.append(del, cancel, save);
  // Compact: a quiet line under the words; "⋯" shows everything else.
  const row = document.createElement("div");
  row.className = "edit-compact-row";
  const hint = document.createElement("span");
  hint.textContent = "Enter saves · Esc cancels";
  const moreBtn = editorButton("⋯", "edit-more-btn");
  moreBtn.title = "Type, annotation, context, AI, delete (Alt+M)";
  moreBtn.setAttribute("aria-expanded", "false");
  const toggleMore = () => {
    const on = form.classList.toggle("show-more");
    moreBtn.setAttribute("aria-expanded", String(on));
    moreBtn.textContent = on ? "Less" : "⋯";
  };
  moreBtn.addEventListener("click", toggleMore);
  row.append(hint, moreBtn);
  form.append(text, row, more, aiRow, footer);
  // A figure: show the picture above its caption; its type stays Figure.
  if (isFigure && note.image) {
    const img = document.createElement("img");
    img.className = "note-figure edit-figure";
    img.src = note.image;
    img.alt = "";
    form.prepend(img);
    fType.d.hidden = true;
  }

  // Clicking anywhere else ends editing: saves if something changed,
  // otherwise just closes. (Dropdown lists and the Study dock don't count.)
  const snapshot = () => [text.value, type.value, annotation.value, context.value].join("\u0000");
  const initial = snapshot();
  const outside = (e) => {
    if (!form.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
    if (form.contains(e.target) || e.target.closest?.(".hs-list, #drop-card, #drop-choice, .ln-spell-bar")) return;
    document.removeEventListener("pointerdown", outside, true);
    if (snapshot() !== initial && text.value.trim()) submit(); else onCancel();
  };
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  // Clicking the web page (the panel loses focus) ends it the same way.
  const stopLeave = onLeaveWindow(() => {
    stopLeave();
    if (!form.isConnected) return;
    document.removeEventListener("pointerdown", outside, true);
    if (snapshot() !== initial && text.value.trim()) submit(); else onCancel();
  });

  form.addEventListener("keydown", (e) => {
    if (e.isComposing) return;  // Enter that confirms an IME composition
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.altKey && (e.key === "m" || e.key === "M") && form.inPlace) {
      e.preventDefault();
      toggleMore();
      return;
    }
    if (e.key !== "Enter") return;
    // Buttons and the "More" line keep their own Enter.
    if (e.target.tagName === "BUTTON" || e.target.tagName === "SUMMARY") return;
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) return;  // Shift+Enter: new line
    e.preventDefault();
    submit();
  });

  form.focusText = () => {
    fitEditorArea(text);
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  };
  return form;
}

function editorArea(value, placeholder, label) {
  const area = document.createElement("textarea");
  area.value = value ?? "";
  area.placeholder = placeholder;
  area.rows = 1;
  area.setAttribute("aria-label", label);
  area.addEventListener("input", () => fitEditorArea(area));
  return area;
}

function fitEditorArea(area) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}

function editorField(label, control) {
  const row  = document.createElement("label");
  const name = document.createElement("span");
  row.className = "edit-field";
  name.textContent = label;
  row.append(name, control);
  return row;
}

function editorButton(label, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  return btn;
}

// Saves an edit through the background (so it queues with every other
// change and can't undo one made at the same moment), marked as edited.
// Returns the updated note, or null if it's gone (deleted elsewhere).
function saveHighlightEdit(id, courseName, topicName, fields) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "UPDATE_HIGHLIGHT", id, courseName, topicName, fields }, (reply) => {
      resolve(chrome.runtime.lastError || !reply?.ok ? null : reply.note);
    });
  });
}


// Calls done() when you click away into the web page (this panel loses
// focus), unless you came back or started dragging text from the page (to
// drop into the editor; content.js stamps "lastDrag"). Returns a remover.
function onLeaveWindow(done) {
  let timer = null;
  const blur = () => {
    const at = Date.now();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (document.hasFocus()) return;
      try {
        const { lastDrag } = await chrome.storage.local.get("lastDrag");
        if (lastDrag && lastDrag.at >= at - 200) return;   // a drag from the page: keep editing
      } catch (_) {}
      done();
    }, 700);
  };
  window.addEventListener("blur", blur);
  return () => { clearTimeout(timer); window.removeEventListener("blur", blur); };
}
