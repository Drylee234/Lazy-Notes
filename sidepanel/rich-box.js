// Q-notes — the note box that shows formatting while you type (Study tab).
//
// It looks like the saved note (headings, bold, lists, highlight, quotes) but
// reads and writes the same plain text as before (see typedNoteHtml in
// utils.js), so storage, exports and All notes are unchanged:
//   # / ## / ###  heading      - point (2 spaces per indent)   1. point
//   **bold**  *italic*  ==highlight==   > quote
//
// createRichBox({ placeholder }) returns the editable element itself, with
// textarea-like extras so the Study code barely changes:
//   .value (get/set) · .disabled · .placeholder · .isRich
//   .caretToEnd() · .insertQuoteAt(block, text) → quote line · .blockAt(x, y)
// createFormatBar(box) returns the B / I / highlight / H / lists bar.
//
// Typing shortcuts: "- " or "* " starts a list, "1. " a numbered one, "# "
// a heading, "> " a quote. Ctrl/⌘+B bold, Ctrl/⌘+I italic, Ctrl/⌘+Shift+H
// highlight. Shift+Enter: new line / next point (on an empty point: leave
// the list). Shift+Tab indents a point, Alt+Shift+Tab (or Backspace at its start) outdents;
// Tab goes on to the "Save as" picker. Pasting pastes plain
// text.

(() => {
  // ── Plain text → editor HTML ──────────────────────────────────────────────
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, "<mark>$1</mark>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, "$1<i>$2</i>");

  function toHtml(text) {
    const out = [];
    const stack = [];   // open lists, innermost last: tag names
    const closeAll = () => { while (stack.length) out.push(`</li></${stack.pop()}>`); };
    String(text ?? "").split("\n").forEach((raw) => {
      const line = raw.replace(/\s+$/, "");
      let m;
      if ((m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) {
        const level = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > level + 1) out.push(`</li></${stack.pop()}>`);
        if (stack.length === level + 1) {
          if (stack[stack.length - 1] === tag) out.push("</li>");
          else { out.push(`</li></${stack.pop()}>`); out.push(`<${tag}>`); stack.push(tag); }
        } else {
          out.push(`<${tag}>`);   // one level deeper (inside the open point)
          stack.push(tag);
        }
        out.push(`<li>${inline(m[3]) || "<br>"}`);
        return;
      }
      closeAll();
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) out.push(`<h${m[1].length + 2}>${inline(m[2]) || "<br>"}</h${m[1].length + 2}>`);
      else if ((m = line.match(/^>\s?(.*)$/))) out.push(`<blockquote>${inline(m[1]) || "<br>"}</blockquote>`);
      else out.push(`<p>${inline(line) || "<br>"}</p>`);
    });
    closeAll();
    return out.join("");
  }

  // ── Editor HTML → plain text ──────────────────────────────────────────────
  const BLOCK = /^(P|DIV|UL|OL|H[1-6]|BLOCKQUOTE)$/;

  function inlineNodes(nodes) {
    let s = "";
    nodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) { s += n.nodeValue.replace(/ /g, " "); return; }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName;
      if (tag === "BR") { s += "\n"; return; }
      if (tag === "UL" || tag === "OL") return;   // nested lists: the list walker
      const inner = inlineNodes([...n.childNodes]);
      if (!inner.trim()) { s += inner; return; }
      const bg = n.style?.backgroundColor;
      const wrap = (mark) => {
        const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0];
        return lead + mark + inner.trim() + mark + trail;
      };
      if (tag === "B" || tag === "STRONG" || Number(n.style?.fontWeight) >= 600) s += wrap("**");
      else if (tag === "I" || tag === "EM" || n.style?.fontStyle === "italic") s += wrap("*");
      else if (tag === "MARK" || (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)")) s += wrap("==");
      else s += inner;
    });
    return s;
  }
  const inlineText = (el) => inlineNodes([...el.childNodes]);

  function toText(root) {
    const lines = [];
    const pushText = (t) => t.replace(/\n$/, "").split("\n").forEach((l) => lines.push(l));

    const walkList = (list, level) => {
      let n = 1;
      [...list.children].forEach((li) => {
        if (li.tagName === "UL" || li.tagName === "OL") { walkList(li, level + 1); return; }
        if (li.tagName !== "LI") return;
        const marker = list.tagName === "OL" ? `${n++}.` : "-";
        const own = [...li.childNodes].filter((c) => !(c.nodeType === 1 && BLOCK.test(c.tagName)));
        const body = inlineNodes(own).replace(/\n+$/, "").replace(/\n/g, " ");
        lines.push(`${"  ".repeat(level)}${marker} ${body}`);
        [...li.children].forEach((c) => {
          if (c.tagName === "UL" || c.tagName === "OL") walkList(c, level + 1);
          else if (BLOCK.test(c.tagName)) lines[lines.length - 1] += " " + inlineText(c).replace(/\n/g, " ");
        });
      });
    };

    // Any element: runs of inline content become lines; blocks are handled
    // by kind (Chrome sometimes nests a list inside a <p>).
    const walk = (el) => {
      let buf = [];
      const flush = () => { if (buf.length) { const t = inlineNodes(buf); if (t.trim() || buf.some((n) => n.tagName === "BR")) pushText(t); } buf = []; };
      el.childNodes.forEach((c) => {
        if (c.nodeType !== Node.ELEMENT_NODE || !BLOCK.test(c.tagName)) { buf.push(c); return; }
        flush();
        const tag = c.tagName;
        if (tag === "UL" || tag === "OL") walkList(c, 0);
        else if (/^H\d$/.test(tag)) lines.push(`${"#".repeat(Math.max(1, Math.min(3, Number(tag[1]) - 2)))} ${inlineText(c).replace(/\n/g, " ").trim()}`);
        else if (tag === "BLOCKQUOTE") inlineText(c).replace(/\n+$/, "").split("\n").forEach((l) => lines.push(`> ${l}`));
        else if ([...c.children].some((k) => BLOCK.test(k.tagName))) walk(c);
        else { const t = inlineText(c); if (t.trim()) pushText(t); else lines.push(""); }
      });
      flush();
    };
    walk(root);
    return lines.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
  }

  // ── The box ───────────────────────────────────────────────────────────────
  function blockOf(node, root) {
    let n = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (n && n !== root && n.parentNode !== root) n = n.parentNode;
    return n && n !== root ? n : null;
  }
  // Two spaces at the start of the line, as text, so an indent survives being
  // saved and read back. The browser's own indent wraps the line in a
  // <blockquote>, which this box saves as a "> " quote — that would quietly
  // turn your note into a quotation. Alt+Shift+Tab takes the step back off.
  const INDENT_STEP = "\u00a0\u00a0";
  function indentLine(box, out) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    let block = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (block && block !== box && !/^(P|DIV|H3|H4|H5)$/.test(block.tagName)) {
      block = block.parentElement;
    }
    if (!block) block = box;

    const first = block.firstChild;
    if (out) {
      if (first?.nodeType === Node.TEXT_NODE && first.textContent.startsWith(INDENT_STEP)) {
        first.textContent = first.textContent.slice(INDENT_STEP.length);
      }
      return;
    }
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = INDENT_STEP + first.textContent;
    else block.insertBefore(document.createTextNode(INDENT_STEP), first || null);
  }

  const closestIn = (node, sel, root) => {
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const hit = el?.closest?.(sel);
    return hit && root.contains(hit) ? hit : null;
  };

  function createRichBox({ placeholder = "" } = {}) {
    const box = document.createElement("div");
    box.className = "rich-box";
    box.contentEditable = "true";
    box.spellcheck = true;
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-multiline", "true");
    box.isRich = true;
    let disabled = false;

    Object.defineProperties(box, {
      value: {
        get: () => toText(box),
        set: (v) => { box.innerHTML = v ? toHtml(v) : ""; updateEmpty(); }
      },
      disabled: {
        get: () => disabled,
        set: (v) => { disabled = !!v; box.contentEditable = disabled ? "false" : "true"; box.classList.toggle("is-disabled", disabled); }
      },
      placeholder: {
        get: () => box.dataset.placeholder || "",
        set: (v) => { box.dataset.placeholder = v; }
      }
    });
    box.placeholder = placeholder;

    function updateEmpty() {
      const empty = !box.textContent.trim() && !box.querySelector("li, h3, h4, h5, blockquote, img");
      box.classList.toggle("is-empty", empty);
    }
    box.addEventListener("input", updateEmpty);
    box.addEventListener("focus", () => {
      document.execCommand("defaultParagraphSeparator", false, "p");
      // Typing into an empty box: start inside a paragraph, so lists and
      // headings made from it are blocks of their own.
      if (!box.firstElementChild && !box.textContent) {
        box.innerHTML = "<p><br></p>";
        const r = document.createRange();
        r.setStart(box.firstChild, 0);
        r.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
    });

    box.caretToEnd = () => {
      box.focus();
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    };

    // The block under a point (for drops), or the caret's block, or null.
    box.blockAt = (x, y) => {
      const r = document.caretRangeFromPoint?.(x, y);
      if (r && box.contains(r.startContainer)) return blockOf(r.startContainer, box);
      const sel = getSelection();
      if (sel.rangeCount && box.contains(sel.anchorNode)) return blockOf(sel.anchorNode, box);
      return null;
    };

    // Where a drop at (x, y) lands: { block, range } (the exact spot).
    box.pointAt = (x, y) => {
      const r = document.caretRangeFromPoint?.(x, y);
      if (r && box.contains(r.startContainer)) return { block: blockOf(r.startContainer, box), range: r };
      return { block: box.blockAt(x, y), range: null };
    };

    // "> text" as a quote block exactly where it was dropped: a paragraph
    // dropped into the middle of is split around it (in a list, it goes
    // after the list). Caret goes on a fresh line under it. Returns the
    // quote's text line.
    box.insertQuoteAt = (at, rawText) => {
      const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      const block = at?.block ?? at ?? null;
      const range = at?.range ?? null;
      const q = document.createElement("blockquote");
      q.textContent = text;
      const after = document.createElement("p");
      after.appendChild(document.createElement("br"));
      let placed = false;
      if (block && block.parentNode === box && range && !/^(UL|OL)$/.test(block.tagName) && block.contains(range.startContainer)) {
        const head = document.createRange();
        head.setStart(block, 0);
        head.setEnd(range.startContainer, range.startOffset);
        if (!head.toString().trim()) {
          block.before(q);                      // dropped at the start: above it
        } else {
          const tail = document.createRange();
          tail.setStart(range.startContainer, range.startOffset);
          tail.setEnd(block, block.childNodes.length);
          const rest = tail.extractContents();
          block.after(q);
          if (rest.textContent.trim()) {        // dropped mid-line: split it
            const second = document.createElement(block.tagName);
            second.appendChild(rest);
            const first = document.createTreeWalker(second, NodeFilter.SHOW_TEXT).nextNode();
            if (first) first.nodeValue = first.nodeValue.replace(/^\s+/, "");
            q.after(second);
          }
        }
        placed = true;
      }
      if (!placed) {
        if (block && block.parentNode === box) block.after(q);
        else box.appendChild(q);
      }
      // Caret on the line under the quote (a fresh one if there isn't one).
      q.after(after);
      const next = after;
      box.focus();
      const r = document.createRange();
      r.setStart(next, 0);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      updateEmpty();
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return `> ${text}`;
    };

    // Plain-text paste. Text copied from a PDF comes in broken lines: join
    // them back into sentences ("-" at a line end glues a split word), keep
    // real line ends (after . ! ? :) and turn bullets into "- " points.
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = cleanPdfText(e.clipboardData.getData("text/plain"));
      if (t) document.execCommand("insertText", false, t);
    });

    box.addEventListener("keydown", (e) => {
      if (e.isComposing || disabled) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && k === "b") { e.preventDefault(); format(box, "bold"); return; }
      if (mod && !e.shiftKey && k === "i") { e.preventDefault(); format(box, "italic"); return; }
      if (mod && e.shiftKey && k === "h") { e.preventDefault(); format(box, "mark"); return; }
      if (mod && k === "u") { e.preventDefault(); return; }   // no underline in notes

      const sel = getSelection();
      const li = sel.rangeCount && closestIn(sel.anchorNode, "li", box);

      // Shift+Tab indents, Alt+Shift+Tab (or Backspace at the very start of
      // an indented point) outdents. Plain Tab is left alone: it goes to the
      // "Save as" picker.
      //
      // This used to need the cursor to be inside a bullet. On an ordinary
      // line nothing happened, the browser moved focus instead, and it looked
      // like Shift+Tab was changing the type. It now indents whatever line
      // you're on, list or not, and never lets the key escape to the picker.
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (li) {
          document.execCommand(e.altKey ? "outdent" : "indent");
        } else {
          // Not in a list. The browser's own indent wraps the line in a
          // <blockquote>, which this box saves as a "> " quote — so your
          // note would quietly become a quotation. Indent the words instead.
          indentLine(box, e.altKey);
        }
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (e.key === "Backspace" && li && !mod && !e.shiftKey && sel.isCollapsed &&
          li.parentElement?.parentElement?.closest?.("ul, ol") && box.contains(li.parentElement.parentElement)) {
        const r = sel.getRangeAt(0).cloneRange();
        r.setStart(li, 0);
        if (!r.toString().length) {
          e.preventDefault();
          document.execCommand("outdent");
          box.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
      }
      if (e.key === "Enter" && e.shiftKey && !mod) {
        e.preventDefault();
        if (li && !li.textContent.trim()) {
          // Empty point: leave the list.
          document.execCommand(li.parentNode.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList");
          document.execCommand("formatBlock", false, "p");
        } else if (li || closestIn(sel.anchorNode, "h3, h4, h5, blockquote", box)) {
          document.execCommand("insertParagraph");
          const after = sel.rangeCount && closestIn(sel.anchorNode, "h3, h4, h5, blockquote", box);
          if (after && !after.textContent.trim()) document.execCommand("formatBlock", false, "p");
        } else {
          document.execCommand("insertParagraph");
        }
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    // Markdown-style starts: "- ", "* ", "1. ", "# ", "## ", "> ".
    box.addEventListener("input", (e) => {
      if (e.inputType !== "insertText" || e.data !== " ") return;
      const sel = getSelection();
      if (!sel.rangeCount) return;
      // At the start of a point: "- " / "* " makes this level bullets,
      // "1. " makes it numbered (e.g. bullets under a numbered point).
      const li = closestIn(sel.anchorNode, "li", box);
      if (li) {
        const node0 = sel.anchorNode;
        if (node0.nodeType !== Node.TEXT_NODE) return;
        const typed = node0.nodeValue.slice(0, sel.anchorOffset).replace(/\u00a0/g, " ");
        if (li.textContent.replace(/\u00a0/g, " ").indexOf(typed) !== 0) return;
        const want = /^[-*•] $/.test(typed) ? "UL" : /^1[.)] $/.test(typed) ? "OL" : null;
        if (!want) return;
        const r = document.createRange();
        r.setStart(node0, 0);
        r.setEnd(node0, sel.anchorOffset);
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand("delete");
        const list = li.parentElement;
        if (list.tagName !== want) {
          const swap = document.createElement(want);
          while (list.firstChild) swap.appendChild(list.firstChild);
          list.replaceWith(swap);
          const c = document.createRange();
          c.setStart(li, 0);
          c.collapse(true);
          sel.removeAllRanges();
          sel.addRange(c);
        }
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      const block = blockOf(sel.anchorNode, box);
      const node = sel.anchorNode;
      if (!block || node.nodeType !== Node.TEXT_NODE) return;
      const before = node.nodeValue.slice(0, sel.anchorOffset);
      if (block.textContent.indexOf(before) !== 0) return;   // only at the very start
      const kinds = { "- ": "ul", "* ": "ul", "• ": "ul", "1. ": "ol", "1) ": "ol", "# ": "h3", "## ": "h4", "### ": "h5", "> ": "blockquote" };
      const kind = kinds[before.replace(/ /g, " ")];
      if (!kind) return;
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, sel.anchorOffset);
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("delete");
      if (kind === "ul") document.execCommand("insertUnorderedList");
      else if (kind === "ol") document.execCommand("insertOrderedList");
      else document.execCommand("formatBlock", false, kind);
      updateEmpty();
    });

    updateEmpty();
    return box;
  }

  const BULLET = /^\s*[•●○◦▪■□►▸▹➢➤✓✔·\uF0A7\uF0B7\uF076\uF0D8\uF0FC\uF0A8\uF06C\uF06E]\s*/;
  const POINT = /^\s*([-*]|\d{1,2}[.)]|[a-z][.)])\s+/i;
  // Lone page / slide numbers ("8", "10") pasted along with PDF lines are
  // dropped (Settings › More options: lnDropPageNums).
  let dropPageNums = true;
  try {
    chrome.storage.local.get("lnDropPageNums", (r) => { dropPageNums = r?.lnDropPageNums !== false; });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "local" && c.lnDropPageNums) dropPageNums = c.lnDropPageNums.newValue !== false;
    });
  } catch (_) {}
  const PAGE_NUM = /^\s*\d{1,3}\s*$/;
  function cleanPdfText(text) {
    let lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
    if (dropPageNums && !/\t/.test(text) && lines.length > 1 && lines.some((l) => l.trim() && !PAGE_NUM.test(l))) {
      const kept = [];
      let cut = false;
      lines.forEach((l) => {
        if (PAGE_NUM.test(l)) { while (kept.length && !kept[kept.length - 1].trim()) kept.pop(); cut = true; return; }
        if (!l.trim() && cut) return;
        cut = false;
        kept.push(l);
      });
      lines = kept;
    }
    if (lines.length < 2) return lines.join("");
    const out = [];
    lines.forEach((raw) => {
      let l = raw.replace(BULLET, (m) => (m.trim() ? "- " : ""));
      if (!l.trim()) { out.push(""); return; }
      const prev = out[out.length - 1];
      const startsPoint = POINT.test(l) || BULLET.test(raw);
      if (prev && !startsPoint && !/[.!?:;]["')\]]?$/.test(prev) && prev.length > 25) {
        out[out.length - 1] = /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(l.trim())
          ? prev.slice(0, -1) + l.trim()
          : `${prev} ${l.trim()}`;
      } else out.push(l.trim() ? l.replace(/^\s+/, (m) => (startsPoint ? m : "")) : l);
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // ── Formatting commands (bar + shortcuts) ─────────────────────────────────
  function inHighlight() {
    const sel = getSelection();
    const el = sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
    return !!el?.closest?.("mark, span[style*='background']");
  }

  function format(box, cmd) {
    if (document.activeElement !== box) box.focus();
    const sel = getSelection();
    const block = sel.rangeCount ? blockOf(sel.anchorNode, box) : null;
    switch (cmd) {
      case "bold":   document.execCommand("bold"); break;
      case "italic": document.execCommand("italic"); break;
      case "mark":
        document.execCommand("styleWithCSS", false, true);
        document.execCommand("hiliteColor", false, inHighlight() ? "transparent" : "rgba(253, 224, 71, 0.55)");
        document.execCommand("styleWithCSS", false, false);
        break;
      case "heading": {
        const isH = block && /^H\d$/.test(block.tagName);
        document.execCommand("formatBlock", false, isH ? "p" : "h3");
        break;
      }
      case "ul": document.execCommand("insertUnorderedList"); break;
      case "ol": document.execCommand("insertOrderedList"); break;
    }
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function createFormatBar(box) {
    const bar = document.createElement("div");
    bar.className = "format-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Formatting");
    const mac = /Mac/.test(navigator.platform);
    const key = mac ? "⌘" : "Ctrl+";
    const items = [
      ["bold", "<b>B</b>", `Bold (${key}B)`],
      ["italic", "<i>I</i>", `Italic (${key}I)`],
      ["mark", '<span class="fb-mark">H</span>', `Highlight (${key}${mac ? "⇧" : "Shift+"}H)`],
      ["sep"],
      ["heading", "Heading", "Heading (type # then space)"],
      ["ul", "• List", "Bullet list (type - then space)"],
      ["ol", "1. List", "Numbered list (type 1. then space)"]
    ];
    const buttons = {};
    items.forEach(([cmd, html, title]) => {
      if (cmd === "sep") { const s = document.createElement("span"); s.className = "fb-sep"; bar.appendChild(s); return; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fb-btn";
      b.innerHTML = html;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("mousedown", (e) => e.preventDefault());   // keep the caret
      b.addEventListener("click", () => { if (!box.disabled) { format(box, cmd); refresh(); } });
      if (cmd === "bold" || cmd === "italic") b.classList.add("fb-bi");
      buttons[cmd] = b;
      bar.appendChild(b);
    });
    // B / I buttons: hidden unless Settings › More options turns them on
    // (lnBoldItalic); Ctrl/⌘+B and +I still work either way.
    const showBI = (on) => bar.classList.toggle("fb-no-bi", on !== true);
    globalThis.chrome?.storage?.local.get("lnBoldItalic", (r) => showBI(r?.lnBoldItalic));
    globalThis.chrome?.storage?.onChanged.addListener((c, area) => { if (area === "local" && c.lnBoldItalic) showBI(c.lnBoldItalic.newValue); });

    function refresh() {
      const sel = getSelection();
      if (!sel.rangeCount || !box.contains(sel.anchorNode)) return;
      const block = blockOf(sel.anchorNode, box);
      const on = {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        mark: inHighlight(),
        heading: !!block && /^H\d$/.test(block.tagName),
        ul: !!closestIn(sel.anchorNode, "ul", box) && !closestIn(sel.anchorNode, "ol", box),
        ol: !!closestIn(sel.anchorNode, "ol", box)
      };
      Object.entries(buttons).forEach(([cmd, b]) => b.classList.toggle("on", !!on[cmd]));
    }
    document.addEventListener("selectionchange", refresh);
    box.addEventListener("input", refresh);
    return bar;
  }

  globalThis.createRichBox = createRichBox;
  globalThis.createFormatBar = createFormatBar;
  globalThis.richText = { toHtml, toText };
})();
