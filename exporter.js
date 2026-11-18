// Lazy Notes — Export helpers (Markdown + HTML).
// Plain script shared by sidepanel.js and viewer.js. Load after utils.js
// (uses sortHighlights / sortTopics).
//
// Each category maps to a structural element, so an exported topic reads like
// a set of notes rather than a dump of highlights.

function topicNotes(topic) {
  const notes = Object.entries(topic?.highlights || {}).map(([id, f]) => ({ id, ...f }));
  return sortHighlights(notes, "chronological");
}

function courseTopics(course) {
  const topics = Object.entries(course?.topics || {}).map(([name, t]) => ({
    name,
    created: t.created,
    topic: t
  }));
  return sortTopics(topics, "chronological");
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

// Keep a highlight on one line so it cannot break the surrounding structure,
// and escape characters that would turn plain text into Markdown/HTML
// (e.g. "<b>" or a leading "#" / "-" / "1." in a summary).
function mdInline(text) {
  return String(text ?? "")
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/([\\`*_<>\[\]])/g, "\\$1")
    .replace(/^([#+-])(?=\s)/, "\\$1")
    .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2");
}

// Inline code span; widen the fence if the formula itself contains backticks.
function mdCode(raw) {
  const text = String(raw ?? "").replace(/\s*\n\s*/g, " ").trim();
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + pad + text + pad + fence;
}

function mdNotes(notes, depth) {
  // depth = heading level used for "header" notes (2 inside a topic export,
  // 3 inside a course export where the topic itself is ##).
  const h = (n) => "#".repeat(Math.min(n, 6));
  const out = [];
  let prevWasListPoint = false;

  notes.forEach((note) => {
    const text = mdInline(note.text);
    const isListPoint = note.category === "list point";

    // Blank line between blocks, but keep consecutive list points together.
    if (out.length && !(isListPoint && prevWasListPoint)) out.push("");

    switch (note.category) {
      case "header":     out.push(`${h(depth)} ${text}`); break;
      case "list head":  out.push(`${h(depth + 1)} ${text}`); break;
      case "list point": out.push(`- ${text}`); break;
      case "definition": out.push(`**${text}**`); break;
      case "formula":    out.push(mdCode(note.text)); break;
      default:           out.push(text);
    }

    const indent = isListPoint ? "  " : "";
    if (note.annotation) out.push(`${indent}> ${mdInline(note.annotation)}`);

    prevWasListPoint = isListPoint && !note.annotation;
  });

  return out.join("\n");
}

function mdSources(notes) {
  const urls = [...new Set(notes.map((n) => n.sourceUrl).filter(Boolean))];
  if (urls.length === 0) return "";
  return "\n\n---\n\n**Sources**\n\n" + urls.map((u) => `- <${u}>`).join("\n");
}

function topicToMarkdown(courseName, topicName, topic) {
  const notes = topicNotes(topic);
  return `# ${topicName}\n\n_${courseName}_\n\n` + mdNotes(notes, 2) + mdSources(notes) + "\n";
}

function courseToMarkdown(courseName, course) {
  const parts = [`# ${courseName}`];
  const meta = [course?.level, course?.semester].filter(Boolean).join(" · ");
  if (meta) parts.push(`_${meta}_`);
  if (course?.details) parts.push(course.details);

  const all = [];
  courseTopics(course).forEach(({ name, topic }) => {
    const notes = topicNotes(topic);
    all.push(...notes);
    parts.push(`## ${name}`);
    parts.push(notes.length ? mdNotes(notes, 3) : "_No notes yet._");
  });

  return parts.join("\n\n") + mdSources(all) + "\n";
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlNotes(notes, depth) {
  const out = [];
  let inList = false;

  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  notes.forEach((note) => {
    const text = escHtml(note.text);
    const ann  = note.annotation
      ? `<blockquote>${escHtml(note.annotation)}</blockquote>`
      : "";

    if (note.category === "list point") {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${text}${ann}</li>`);
      return;
    }

    closeList();
    const hd = Math.min(depth, 6);
    switch (note.category) {
      case "header":     out.push(`<h${hd}>${text}</h${hd}>`); break;
      case "list head":  out.push(`<h${Math.min(hd + 1, 6)}>${text}</h${Math.min(hd + 1, 6)}>`); break;
      case "definition": out.push(`<p class="definition"><strong>${text}</strong></p>`); break;
      case "formula":    out.push(`<pre class="formula"><code>${text}</code></pre>`); break;
      default:           out.push(`<p>${text}</p>`);
    }
    if (ann) out.push(ann);
  });

  closeList();
  return out.join("\n");
}

function htmlSources(notes) {
  const urls = [...new Set(notes.map((n) => n.sourceUrl).filter(Boolean))];
  if (urls.length === 0) return "";
  const items = urls
    .map((u) => `<li><a href="${escHtml(u)}">${escHtml(u)}</a></li>`)
    .join("\n");
  return `<footer><h2>Sources</h2><ul>${items}</ul></footer>`;
}

function htmlDocument(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(title)}</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px; font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; background: #fff; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .meta { color: #777; margin-top: 0; }
  h2 { margin-top: 32px; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
  blockquote { margin: 4px 0 12px; padding-left: 12px; border-left: 3px solid #ddd; color: #555; }
  pre.formula { background: #f5f5f5; padding: 8px 12px; border-radius: 6px; white-space: pre-wrap; }
  footer { margin-top: 48px; font-size: 13px; color: #555; }
  footer h2 { font-size: 14px; }
  a { color: #3b5bdb; word-break: break-all; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #ebebeb; }
    h2 { border-color: #2a2a2a; }
    blockquote { border-color: #333; color: #aaa; }
    pre.formula { background: #1c1c1c; }
    footer, .meta { color: #999; }
    a { color: #91a7ff; }
  }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function topicToHtml(courseName, topicName, topic) {
  const notes = topicNotes(topic);
  const body =
    `<h1>${escHtml(topicName)}</h1>\n<p class="meta">${escHtml(courseName)}</p>\n` +
    htmlNotes(notes, 2) + "\n" + htmlSources(notes);
  return htmlDocument(`${topicName} — ${courseName}`, body);
}

function courseToHtml(courseName, course) {
  const parts = [`<h1>${escHtml(courseName)}</h1>`];
  const meta = [course?.level, course?.semester].filter(Boolean).join(" · ");
  if (meta) parts.push(`<p class="meta">${escHtml(meta)}</p>`);
  if (course?.details) parts.push(`<p>${escHtml(course.details)}</p>`);

  const all = [];
  courseTopics(course).forEach(({ name, topic }) => {
    const notes = topicNotes(topic);
    all.push(...notes);
    parts.push(`<h2>${escHtml(name)}</h2>`);
    parts.push(notes.length ? htmlNotes(notes, 3) : "<p><em>No notes yet.</em></p>");
  });

  parts.push(htmlSources(all));
  return htmlDocument(courseName, parts.join("\n"));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
}

// format: "md" | "html"
function exportNotes({ format, courseName, course, topicName }) {
  const isHtml = format === "html";
  let content;

  if (topicName) {
    const topic = course?.topics?.[topicName];
    if (!topic) return;
    content = isHtml
      ? topicToHtml(courseName, topicName, topic)
      : topicToMarkdown(courseName, topicName, topic);
  } else {
    if (!course) return;
    content = isHtml ? courseToHtml(courseName, course) : courseToMarkdown(courseName, course);
  }

  const base = topicName ? `${courseName} - ${topicName}` : courseName;
  const filename = safeFilename(`${base}.${isHtml ? "html" : "md"}`);
  const blob = new Blob([content], { type: isHtml ? "text/html" : "text/markdown" });
  const url  = URL.createObjectURL(blob);

  // The download callback fires when the download starts, not when it has
  // read the blob — give it time before releasing the URL.
  chrome.downloads.download({ url, filename }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}
