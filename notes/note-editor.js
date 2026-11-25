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
function noteEditor(note, { onSave, onCancel, onDelete }) {
  const form = document.createElement("div");
  form.className = "edit-form";
  form.addEventListener("click", (e) => e.stopPropagation());

  const text       = editorArea(note.text, "Highlighted text", "Text");
  const annotation = editorArea(note.annotation, "Your own note about this (optional)", "Annotation");
  const context    = editorArea(note.context, "Surrounding text (optional)", "Context");
  text.classList.add("edit-text");

  const type = document.createElement("select");
  type.setAttribute("aria-label", "Type");
  Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === note.category;
    type.appendChild(opt);
  });

  // "More": shut until asked for; its line says what's inside.
  const more    = document.createElement("details");
  const summary = document.createElement("summary");
  more.className = "edit-more";
  const describe = () => {
    const parts = [CATEGORY_LABELS[type.value] || type.value];
    if (annotation.value.trim()) parts.push("annotation");
    if (context.value.trim())    parts.push("context");
    summary.textContent = ["More", ...parts].join(" · ");
  };
  type.addEventListener("change", describe);
  [annotation, context].forEach((area) => area.addEventListener("input", describe));
  describe();

  more.append(summary, editorField("Type", type), editorField("Annotation", annotation), editorField("Context", context));
  // Hidden areas can't be measured, so size them once they show.
  more.addEventListener("toggle", () => { if (more.open) [annotation, context].forEach(fitEditorArea); });

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
    try { await onSave(fields); } finally { save.disabled = false; }
  }

  footer.append(del, cancel, save);
  form.append(text, more, footer);

  // Clicking anywhere else ends editing: saves if something changed,
  // otherwise just closes. (Dropdown lists and the Study dock don't count.)
  const snapshot = () => [text.value, type.value, annotation.value, context.value].join("\u0000");
  const initial = snapshot();
  const outside = (e) => {
    if (!form.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
    if (form.contains(e.target) || e.target.closest?.(".hs-list, #study-dock, .ln-spell-bar")) return;
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
