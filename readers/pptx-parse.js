// Lazy Notes — reads a .pptx into plain slides for the slides reader:
// titles, text, bullets, tables, pictures and speaker notes, in reading
// order. Not a renderer: charts, SmartArt and animations are left out on
// purpose; lines, arrows and plain shapes are drawn (ooxml-drawing.js). The point is text that can be selected and saved as notes.
//
// A .pptx is a ZIP of XML parts (Office Open XML). The ZIP is read with the
// browser's own DecompressionStream, so there's no library to ship.
//
// readPptx(arrayBuffer) → { slides: [{ number, title, hidden, blocks, notes }] }
//   blocks: { kind: "title" | "subtitle", text }
//         | { kind: "text", paras: [{ text, level, marker }] }   marker: "•", "1." or null
//         | { kind: "table", rows: [[{ text, colSpan, rowSpan }]], header }   header: first row is headings
//         | { kind: "image", blob, alt }
//         | { kind: "shape", blob }   lines, arrows and outlined/filled shapes, as SVG
//   notes:  [{ text, level, marker }]
//   paragraphs also carry runs: [{ text, b, i, u, color, size }] for light
//   formatting; slides carry background ("#rrggbb" or null).

import { shapeSvg, themeColours } from "./ooxml-drawing.js";

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ---------------------------------------------------------------------------
// ZIP (no encryption or ZIP64 — .pptx files don't use them)
// ---------------------------------------------------------------------------

function openZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);
  const utf8  = new TextDecoder();

  // The end-of-central-directory record sits in the last 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("this isn't a .pptx file");

  const entries = new Map();
  let p = view.getUint32(eocd + 16, true);
  for (let n = view.getUint16(eocd + 10, true); n > 0; n--) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("the file is damaged");
    const nameLen = view.getUint16(p + 28, true);
    entries.set(utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)), {
      method:   view.getUint16(p + 10, true),
      compSize: view.getUint32(p + 20, true),
      offset:   view.getUint32(p + 42, true)
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }

  async function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    // Sizes come from the central directory: local headers may leave them 0.
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const data = bytes.subarray(start, start + e.compSize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error(`unsupported compression in ${name}`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return {
    read,
    async readText(name) {
      const data = await read(name);
      return data && utf8.decode(data);
    }
  };
}

// ---------------------------------------------------------------------------
// XML and package helpers
// ---------------------------------------------------------------------------

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid  = (el, name) => (el ? [...el.children].find((c) => c.localName === name) ?? null : null);
const path = (el, ...names) => names.reduce((node, name) => kid(node, name), el);

async function readXml(zip, name) {
  const text = await zip.readText(name);
  if (text == null) return null;
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc.documentElement;
}

// "../media/image1.png" seen from "ppt/slides/slide2.xml" → "ppt/media/image1.png"
function resolve(from, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// A part's relationships: rId → { type, target } (internal targets only).
async function readRels(zip, part) {
  const i = part.lastIndexOf("/");
  const root = await readXml(zip, `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`);
  const rels = new Map();
  kids(root, "Relationship").forEach((r) => {
    if (r.getAttribute("TargetMode") === "External") return;
    rels.set(r.getAttribute("Id"), { type: r.getAttribute("Type") || "", target: resolve(part, r.getAttribute("Target") || "") });
  });
  return rels;
}

const relOfType = (rels, suffix) => [...rels.values()].find((r) => r.type.endsWith(suffix))?.target ?? null;

// ---------------------------------------------------------------------------
// Placeholders and positions
// ---------------------------------------------------------------------------
// A placeholder on a slide usually has no position of its own: it inherits
// one from the slide's layout, which may inherit it from the master. The
// position only matters for putting things in reading order.

const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const SKIP_TYPES  = new Set(["dt", "ftr", "sldNum", "hdr", "sldImg"]);  // dates, footers, numbers

function placeholderOf(shape) {
  const nv = kid(shape, "nvSpPr") || kid(shape, "nvPicPr") || kid(shape, "nvGraphicFramePr") || kid(shape, "nvGrpSpPr");
  const ph = path(nv, "nvPr", "ph");
  return ph ? { type: ph.getAttribute("type") || "obj", idx: ph.getAttribute("idx") } : null;
}

// Where a shape sits on the slide, in EMU: { x, y, w, h } (w/h 0 if unknown).
function offsetOf(shape) {
  const holder = kid(shape, "spPr") || kid(shape, "grpSpPr") || shape;  // graphicFrame: p:xfrm directly
  const xfrm = kid(holder, "xfrm");
  const off = kid(xfrm, "off");
  if (!off) return null;
  const ext = kid(xfrm, "ext");
  return { x: Number(off.getAttribute("x")), y: Number(off.getAttribute("y")),
           w: Number(ext?.getAttribute("cx") || 0), h: Number(ext?.getAttribute("cy") || 0) };
}

// The placeholders of a layout or master: [{ type, idx, off }]
function placeholderList(root) {
  return kids(path(root, "cSld", "spTree"), "sp")
    .map((sp) => ({ ...placeholderOf(sp), off: offsetOf(sp) }))
    .filter((p) => p.type);
}

function findPlaceholder(list, ph) {
  if (ph.idx != null) {
    const byIdx = list.find((p) => p.idx === ph.idx);
    if (byIdx) return byIdx;
  }
  if (TITLE_TYPES.has(ph.type)) return list.find((p) => TITLE_TYPES.has(p.type));
  return list.find((p) => p.type === ph.type);
}

function inheritedOffset(ph, layout, master) {
  const fromLayout = findPlaceholder(layout, ph);
  if (fromLayout?.off) return fromLayout.off;
  const type = fromLayout?.type ?? ph.type;
  const masterType = TITLE_TYPES.has(type) ? "title" : ["obj", "body", "subTitle"].includes(type) ? "body" : type;
  return master.find((p) => p.type === masterType)?.off ?? null;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const BULLETS = ["•", "◦", "▪"];

function numberLabel(n, type) {
  const [, base = "arabic", suffix = "Period"] = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(.*)$/.exec(type) || [];
  let label = String(n);
  if (base.startsWith("alpha")) label = String.fromCharCode(96 + ((n - 1) % 26) + 1);
  if (base.startsWith("roman")) label = toRoman(n);
  if (base.endsWith("Uc")) label = label.toUpperCase();
  return suffix === "ParenR" ? `${label})` : suffix === "ParenBoth" ? `(${label})` : suffix === "Plain" ? label : `${label}.`;
}

function toRoman(n) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
                 [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, digits] of table) while (n >= value) { out += digits; n -= value; }
  return out;
}

// Paragraphs of a text body. Body placeholders are bulleted unless a
// paragraph says <a:buNone/>; elsewhere only explicit bullets/numbers count.
function paragraphsOf(txBody, { bulleted = false } = {}) {
  const out = [];
  const counters = [];

  kids(txBody, "p").forEach((p) => {
    let text = "";
    const runs = [];   // [{ text, b, i, u, color, size }]: light formatting
    for (const c of p.children) {
      if (c.localName === "r" || c.localName === "fld") {
        const t = kid(c, "t")?.textContent ?? "";
        text += t;
        if (t) runs.push({ text: t, ...runStyle(kid(c, "rPr")) });
      } else if (c.localName === "br") {
        text += "\n";
        runs.push({ text: "\n" });
      }
    }
    if (!text.trim()) return;

    const pPr   = kid(p, "pPr");
    const level = Math.min(Number(pPr?.getAttribute("lvl") || 0), 8);
    const auto  = kid(pPr, "buAutoNum");

    counters.length = level + 1;  // deeper levels start over after this paragraph
    let marker = null;
    if (auto) {
      const start = Number(auto.getAttribute("startAt") || 1);
      counters[level] = counters[level] == null ? start : counters[level] + 1;
      marker = numberLabel(counters[level], auto.getAttribute("type") || "arabicPeriod");
    } else {
      counters[level] = null;     // a plain paragraph ends a numbered run
      if (kid(pPr, "buChar") || (bulleted && !kid(pPr, "buNone"))) marker = BULLETS[level % BULLETS.length];
    }
    const algn = pPr?.getAttribute("algn");
    out.push({ text, level, marker, runs, align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : null });
  });
  return out;
}

// Bold, italic, underline, an explicit colour and the size of a run. Theme
// ("scheme") colours are left out: they need the deck's theme to resolve.
function runStyle(rPr) {
  if (!rPr) return {};
  const style = {};
  if (rPr.getAttribute("b") === "1") style.b = true;
  if (rPr.getAttribute("i") === "1") style.i = true;
  if ((rPr.getAttribute("u") || "none") !== "none") style.u = true;
  const color = path(rPr, "solidFill", "srgbClr")?.getAttribute("val");
  if (color) style.color = `#${color}`;
  const sz = Number(rPr.getAttribute("sz"));   // hundredths of a point
  if (sz) style.size = sz / 100;
  return style;
}

// A slide's (or layout's / master's) own solid background colour
// ("#rrggbb"), if it sets one.
function slideBackground(root) {
  const val = path(root, "cSld", "bg", "bgPr", "solidFill", "srgbClr")?.getAttribute("val");
  return val ? `#${val}` : null;
}

// How a text box lays out: vertical anchor and PowerPoint's shrink-to-fit.
function bodyLayout(txBody) {
  const bodyPr = kid(txBody, "bodyPr");
  const fit = kid(bodyPr, "normAutofit");
  return {
    anchor: bodyPr?.getAttribute("anchor") || null,                  // t | ctr | b
    scale:  fit?.getAttribute("fontScale") ? Number(fit.getAttribute("fontScale")) / 100000 : 1
  };
}

const plainText = (txBody) => paragraphsOf(txBody).map((p) => p.text).join("\n");

// ---------------------------------------------------------------------------
// Shapes → blocks
// ---------------------------------------------------------------------------

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
                      bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

// The picture in a blipFill, as an image block (null for EMF/WMF and
// friends, which browsers can't show).
async function imageBlock(blipFill, shape, ctx) {
  const id = kid(blipFill, "blip")?.getAttributeNS(NS_R, "embed");
  const target = id && ctx.rels.get(id)?.target;
  const type = target && IMAGE_TYPES[target.split(".").pop().toLowerCase()];
  if (!type) return null;
  const data = await ctx.zip.read(target);
  const nv = kid(shape, "nvPicPr") || kid(shape, "nvSpPr");
  return data ? { kind: "image", blob: new Blob([data], { type }), alt: path(nv, "cNvPr")?.getAttribute("descr") || "" } : null;
}

// Shapes of a tree (slide or group) → [{ block, pos, order }]
async function collect(tree, ctx) {
  const found = [];
  let order = 0;

  for (let el of tree.children) {
    // Newer features come wrapped in mc:AlternateContent; use what's inside.
    if (el.localName === "AlternateContent") el = (kid(el, "Choice") || kid(el, "Fallback"))?.firstElementChild;
    if (!el) continue;

    const ph = placeholderOf(el);
    if (ph && SKIP_TYPES.has(ph.type)) continue;
    const pos = offsetOf(el) ?? (ph ? inheritedOffset(ph, ctx.layout, ctx.master) : null);
    const add = (block) => {
      if (block.box === undefined) block.box = pos && pos.w && pos.h ? pos : null;
      block.z = ctx.z++;   // file order = drawing order (later is on top)
      found.push({ block, pos: block.box ?? pos, order: order++, isTitle: block.kind === "title" });
    };

    // Lines, arrows and outlined/filled shapes: drawn under the text.
    const drawShape = () => {
      const d = shapeSvg(el, { theme: ctx.theme });
      if (d) add({ kind: "shape", blob: new Blob([d.svg], { type: "image/svg+xml" }), box: d.box });
    };

    switch (el.localName) {
      case "cxnSp":
        drawShape();
        break;
      case "sp": {
        if (!ph) drawShape();
        // A shape filled with a picture (picture placeholders, image fills).
        const fill = path(el, "spPr", "blipFill");
        if (fill) {
          const image = await imageBlock(fill, el, ctx);
          if (image) add(image);
        }
        const body = kid(el, "txBody");
        if (!body) break;
        const layout = bodyLayout(body);
        if (ph && TITLE_TYPES.has(ph.type)) {
          const paras = paragraphsOf(body);
          const text = paras.map((q) => q.text).join("\n");
          if (text.trim()) add({ kind: "title", text, paras, ...layout, size: ph.type === "ctrTitle" ? 44 : 36, center: ph.type === "ctrTitle", anchor: layout.anchor || (ph.type === "ctrTitle" ? "b" : "ctr") });
        } else if (ph?.type === "subTitle") {
          const paras = paragraphsOf(body);
          const text = paras.map((q) => q.text).join("\n");
          if (text.trim()) add({ kind: "subtitle", text, paras, ...layout, size: 24, center: true });
        } else {
          const paras = paragraphsOf(body, { bulleted: !!ph && ["obj", "body"].includes(ph.type) });
          if (paras.length) add({ kind: "text", paras, ...layout, size: ph ? 24 : 18 });
        }
        break;
      }
      case "pic": {
        const image = await imageBlock(kid(el, "blipFill"), el, ctx);
        if (image) add(image);
        break;
      }
      case "graphicFrame": {
        const tbl = path(el, "graphic", "graphicData", "tbl");
        if (!tbl) break;  // charts and SmartArt aren't read
        const rows = kids(tbl, "tr").map((tr) => kids(tr, "tc")
          .filter((tc) => !tc.getAttribute("hMerge") && !tc.getAttribute("vMerge"))
          .map((tc) => ({
            text:    plainText(kid(tc, "txBody")),
            colSpan: Number(tc.getAttribute("gridSpan") || 1),
            rowSpan: Number(tc.getAttribute("rowSpan") || 1)
          })));
        const header = path(tbl, "tblPr")?.getAttribute("firstRow") === "1";
        if (rows.some((r) => r.some((c) => c.text.trim()))) add({ kind: "table", rows, header });
        break;
      }
      case "grpSp": {
        // A group's parts stay together, in their own reading order. Their
        // positions are in the group's own coordinates: map them onto the slide.
        const xfrm = path(el, "grpSpPr", "xfrm");
        const num = (e, a) => Number(kid(xfrm, e)?.getAttribute(a) || 0);
        const [ox, oy, ow, oh] = [num("off", "x"), num("off", "y"), num("ext", "cx"), num("ext", "cy")];
        const [cx, cy, cw, ch] = [num("chOff", "x"), num("chOff", "y"), num("chExt", "cx") || ow, num("chExt", "cy") || oh];
        const sx = cw ? ow / cw : 1, sy = ch ? oh / ch : 1;
        (await collectSorted(el, ctx)).forEach((part) => {
          const b = part.block;
          if (b.box) b.box = { x: ox + (b.box.x - cx) * sx, y: oy + (b.box.y - cy) * sy, w: b.box.w * sx, h: b.box.h * sy };
          add(b);
        });
        break;
      }
    }
  }
  return found;
}

// Titles first, then top to bottom, left to right. Things with no known
// position stay right after whatever came before them in the file.
function byReadingOrder(a, b) {
  if (a.isTitle !== b.isTitle) return a.isTitle ? -1 : 1;
  return a.sortY - b.sortY || a.sortX - b.sortX || a.order - b.order;
}

function withSortKeys(items) {
  let lastY = 0, lastX = 0;
  return items.map((it) => {
    if (it.pos) { lastY = it.pos.y; lastX = it.pos.x; }
    return { ...it, sortY: it.pos?.y ?? lastY, sortX: it.pos?.x ?? lastX };
  });
}

// A slide's or group's shapes, in reading order.
const collectSorted = async (tree, ctx) => withSortKeys(await collect(tree, ctx)).sort(byReadingOrder);

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export async function readPptx(buffer) {
  const zip = openZip(buffer);

  const presPart = "ppt/presentation.xml";
  const pres = await readXml(zip, presPart);
  if (!pres) throw new Error("this isn't a PowerPoint (.pptx) file");
  const presRels = await readRels(zip, presPart);

  const layouts = new Map();  // layout part → { layout, master } placeholder lists
  async function layoutInfo(layoutPart) {
    if (!layoutPart) return { layout: [], master: [], theme: new Map() };
    if (!layouts.has(layoutPart)) {
      const masterPart = relOfType(await readRels(zip, layoutPart), "/slideMaster");
      const layoutRoot = await readXml(zip, layoutPart);
      const masterRoot = masterPart ? await readXml(zip, masterPart) : null;
      const themePart = masterPart && relOfType(await readRels(zip, masterPart), "/theme");
      layouts.set(layoutPart, {
        theme: themeColours(themePart ? await readXml(zip, themePart) : null),
        layout: placeholderList(layoutRoot),
        master: masterRoot ? placeholderList(masterRoot) : [],
        background: slideBackground(layoutRoot) ?? (masterRoot && slideBackground(masterRoot))
      });
    }
    return layouts.get(layoutPart);
  }

  const slides = [];
  for (const sldId of kids(kid(pres, "sldIdLst"), "sldId")) {
    const part = presRels.get(sldId.getAttributeNS(NS_R, "id"))?.target;
    const root = part && await readXml(zip, part);
    if (!root) continue;

    const rels = await readRels(zip, part);
    const ctx  = { zip, rels, z: 0, ...(await layoutInfo(relOfType(rels, "/slideLayout"))) };
    const blocks = (await collectSorted(path(root, "cSld", "spTree"), ctx)).map((it) => it.block);

    let notes = [];
    const notesPart = relOfType(rels, "/notesSlide");
    const notesRoot = notesPart && await readXml(zip, notesPart);
    if (notesRoot) {
      kids(path(notesRoot, "cSld", "spTree"), "sp")
        .filter((sp) => placeholderOf(sp)?.type === "body")
        .forEach((sp) => { notes = notes.concat(paragraphsOf(kid(sp, "txBody"))); });
    }

    slides.push({
      number: slides.length + 1,
      title:  blocks.find((b) => b.kind === "title")?.text.replace(/\s+/g, " ").trim() ?? "",
      hidden: root.getAttribute("show") === "0",
      background: slideBackground(root) ?? ctx.background ?? null,
      blocks,
      notes
    });
  }

  if (!slides.length) throw new Error("no slides found in this file");
  const sz = kid(pres, "sldSz");
  return { slides, width: Number(sz?.getAttribute("cx")) || 12192000, height: Number(sz?.getAttribute("cy")) || 6858000 };
}
