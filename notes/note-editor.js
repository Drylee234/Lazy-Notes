// Lazy Notes — the editor for a saved highlight, shared by the All notes
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
// form.focusText() puts the cursor at the end of the text.
function noteEditor(note, { onSave, onCancel, onDelete, onConvert }) {
  const form = document.createElement("div");
  form.className = "edit-form";
  form.addEventListener("click", (e) => e.stopPropagation());

  const text       = editorArea(note.text, "Highlighted text", "Text");
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
  if (onConvert) type.add(new Option("My note (typed)", "__typed__"));

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
  const fType = fold(editorField("Type", type), () => `${type.value === "__typed__" ? "My note" : (CATEGORY_LABELS[type.value] || type.value)} ›`);
  const fAnn  = fold(editorField("Annotation", annotation), () => `Annotation ${annotation.value.trim() ? "· " + short(annotation.value.trim()) : "›"}`);
  const fCtx  = fold(editorField("Context", context), () => `Context ${context.value.trim() ? "· " + short(context.value.trim()) : "›"}`);
  type.addEventListener("change", fType.redraw);
  annotation.addEventListener("input", fAnn.redraw);
  context.addEventListener("input", fCtx.redraw);
  more.append(fType.d, fAnn.d, fCtx.d);

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
    if (!fields.text) {    // emptying the text isn't how to delete: that's Delete
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
  form.append(text, more, footer);

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

  form.addEventListener("keydown", (e) => {
    if (e.isComposing) return;  // Enter that confirms an IME composition
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
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

// Writes an edit straight to storage (extension pages may), marked as
// edited. Returns the updated note, or null if it's gone (deleted elsewhere).
async function saveHighlightEdit(id, courseName, topicName, fields) {
  const { lazynotes } = await chrome.storage.local.get("lazynotes");
  const topic = lazynotes?.courses?.[courseName]?.topics?.[topicName];
  const note  = topic?.highlights?.[id];
  if (!note) return null;

  topic.highlights[id] = { ...note, ...fields, edited: new Date().toISOString() };
  await chrome.storage.local.set({ lazynotes });
  return topic.highlights[id];
}
