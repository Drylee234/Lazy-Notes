// Q-notes — reads a Word document (.docx) for the document reader.
// Headings, paragraphs with light formatting (bold, italic, underline),
// bulleted and numbered lists with their levels, links (as text), tables,
// pictures, and page breaks. Not a renderer: fonts, colours, columns,
// headers/footers and free-floating text boxes are left out. Diagrams drawn
// with Word shapes (lines, arrows, text-box labels, grouped pictures) come
// out as one SVG picture (ooxml-drawing.js). The point is text that can
// be selected and saved as notes.
//
// A .docx is a ZIP of XML parts (Office Open XML), read with the browser's
// own DecompressionStream (same reader as pptx-parse.js).
//
// readDocx(arrayBuffer) → { pages: [{ number, blocks }] }
//   blocks: { kind: "heading", level 0-6, runs }   (0 = the document's Title)
//         | { kind: "para", runs, list: { level, marker, ordered } | null, align }
//         | { kind: "table", rows: [[{ paras: [runs], colSpan }]] }
//         | { kind: "image", blob, alt }
//   runs: [{ text, b, i, u }]   ("\n" text = line break)
// Pages follow the document's own page breaks: explicit ones, section
// breaks, and the breaks Word recorded when it last laid the file out.

import { drawingSvg, themeColours } from "./ooxml-drawing.js";

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ---------------------------------------------------------------------------
// ZIP (no encryption or ZIP64 — .docx files don't use them)
// ---------------------------------------------------------------------------

function openZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);
  const utf8  = new TextDecoder();

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("this isn't a .docx file");

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
// XML helpers
// ---------------------------------------------------------------------------

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid  = (el, name) => (el ? [...el.children].find((c) => c.localName === name) ?? null : null);
const path = (el, ...names) => names.reduce((node, name) => kid(node, name), el);
const val  = (el) => el?.getAttribute("w:val") ?? el?.getAttributeNS?.("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "val") ?? null;
// A w:b / w:i style toggle: present = on, unless val is "0"/"false"/"none".
const on   = (el) => !!el && !/^(0|false|none)$/i.test(val(el) ?? "");

async function readXml(zip, name) {
  const text = await zip.readText(name);
  if (text == null) return null;
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc.documentElement;
}

async function readRels(zip, part) {
  const i = part.lastIndexOf("/");
  const root = await readXml(zip, `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`);
  const rels = new Map();
  kids(root, "Relationship").forEach((r) => {
    if (r.getAttribute("TargetMode") === "External") return;
    const target = r.getAttribute("Target") || "";
    rels.set(r.getAttribute("Id"), target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^\.\//, "")}`);
  });
  return rels;
}

// ---------------------------------------------------------------------------
// Styles: which paragraph styles are headings (and bold/italic in a style)
// ---------------------------------------------------------------------------

async function readStyles(zip) {
  const root = await readXml(zip, "word/styles.xml");
  const styles = new Map();   // styleId → { heading, b, i, basedOn }
  kids(root, "style").forEach((s) => {
    const id = s.getAttribute("w:styleId");
    if (!id) return;
    const name = (val(kid(s, "name")) || id).toLowerCase();
    let heading = null;
    const m = name.match(/^heading\s*(\d)$/);
    if (m) heading = Number(m[1]);
    else if (name === "title") heading = 0;
    else if (name === "subtitle") heading = 2;
    const outline = val(path(s, "pPr", "outlineLvl"));
    if (heading == null && outline != null && Number(outline) < 6) heading = Number(outline) + 1;
    const rPr = kid(s, "rPr");
    // List styles ("List Bullet", "List Number") carry their numbering.
    const numPr = path(s, "pPr", "numPr");
    const num = numPr && val(kid(numPr, "numId")) ? { numId: val(kid(numPr, "numId")), ilvl: Number(val(kid(numPr, "ilvl")) || 0) } : null;
    styles.set(id, { heading, num, b: on(kid(rPr, "b")), i: on(kid(rPr, "i")), basedOn: val(kid(s, "basedOn")) });
  });
  const resolve = (id, seen = new Set()) => {
    const s = styles.get(id);
    if (!s || seen.has(id)) return s ?? null;
    seen.add(id);
    const base = s.basedOn ? resolve(s.basedOn, seen) : null;
    return { heading: s.heading ?? base?.heading ?? null, num: s.num ?? base?.num ?? null, b: s.b || !!base?.b, i: s.i || !!base?.i };
  };
  return (id) => (id ? resolve(id) : null);
}

// ---------------------------------------------------------------------------
// Numbering: numId + level → "•" / "1." / "a)" …
// ---------------------------------------------------------------------------

async function readNumbering(zip) {
  const root = await readXml(zip, "word/numbering.xml");
  const abstract = new Map();   // abstractNumId → Map(level → { fmt, text, start })
  kids(root, "abstractNum").forEach((a) => {
    const levels = new Map();
    kids(a, "lvl").forEach((l) => {
      levels.set(Number(l.getAttribute("w:ilvl")), {
        fmt:   val(kid(l, "numFmt")) || "bullet",
        text:  val(kid(l, "lvlText")) ?? "",
        start: Number(val(kid(l, "start")) || 1)
      });
    });
    abstract.set(a.getAttribute("w:abstractNumId"), levels);
  });
  const nums = new Map();       // numId → abstract levels
  kids(root, "num").forEach((n) => nums.set(n.getAttribute("w:numId"), abstract.get(val(kid(n, "abstractNumId")))));

  const counters = new Map();   // numId → [count per level]
  return (numId, level) => {
    const levels = nums.get(numId);
    if (!levels) return null;
    const def = levels.get(level) || { fmt: "bullet", text: "•", start: 1 };
    if (def.fmt === "bullet" || def.fmt === "none") {
      const ch = def.fmt === "none" ? "" : (/^[\w\s]*$/.test(def.text) || /[-]/.test(def.text) ? ["•", "◦", "▪"][level % 3] : def.text);
      return { marker: ch, ordered: false };
    }
    const c = counters.get(numId) || [];
    c[level] = (c[level] ?? (def.start - 1)) + 1;
    c.length = level + 1;       // deeper levels start over
    counters.set(numId, c);
    // lvlText like "%1." or "%1.%2)": fill each %n with that level's number.
    const label = def.text.replace(/%(\d)/g, (_, k) => {
      const lv = Number(k) - 1;
      const d = levels.get(lv) || def;
      return formatNumber(c[lv] ?? d.start, lv === level ? def.fmt : d.fmt);
    }) || `${formatNumber(c[level], def.fmt)}.`;
    return { marker: label, ordered: true };
  };
}

function formatNumber(n, fmt) {
  if (fmt === "lowerLetter") return String.fromCharCode(96 + ((n - 1) % 26) + 1);
  if (fmt === "upperLetter") return String.fromCharCode(64 + ((n - 1) % 26) + 1);
  if (fmt === "lowerRoman") return toRoman(n);
  if (fmt === "upperRoman") return toRoman(n).toUpperCase();
  return String(n);
}

function toRoman(n) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
                 [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, digits] of table) while (n >= value) { out += digits; n -= value; }
  return out;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
                      bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

export async function readDocx(buffer) {
  const zip = openZip(buffer);
  const body = path(await readXml(zip, "word/document.xml"), "body");
  if (!body) throw new Error("this isn't a Word (.docx) file");
  const rels = await readRels(zip, "word/document.xml");
  const styleOf = await readStyles(zip);
  const numberOf = await readNumbering(zip);

  const pages = [{ number: 1, blocks: [] }];
  const cur = () => pages[pages.length - 1].blocks;
  const newPage = () => {
    if (!cur().length) return;            // never an empty page
    pages.push({ number: pages.length + 1, blocks: [] });
  };

  const theme = themeColours(await readXml(zip, "word/theme/theme1.xml"));

  async function dataUrl(rId) {
    const target = rId && rels.get(rId);
    const type = target && IMAGE_TYPES[target.split(".").pop().toLowerCase()];
    if (!type) return null;
    const data = await zip.read(target);
    if (!data) return null;
    let bin = "";
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  }

  async function image(el) {
    const alt = el.getElementsByTagNameNS("*", "docPr")[0]?.getAttribute("descr") || "";

    // A group or drawing canvas (shapes, lines, arrows, text boxes, pictures):
    // drawn as a whole, not just its first picture.
    const graphicData = el.getElementsByTagNameNS("*", "graphicData")[0];
    if (graphicData && [...graphicData.children].some((c) => ["wgp", "wpc", "grpSp"].includes(c.localName))) {
      const extent = el.getElementsByTagNameNS("*", "extent")[0];
      const urls = new Map();
      for (const b of graphicData.getElementsByTagNameNS("*", "blip")) {
        const id = b.getAttributeNS(NS_R, "embed");
        if (id && !urls.has(id)) urls.set(id, await dataUrl(id));
      }
      const svg = drawingSvg(graphicData, {
        width: Number(extent?.getAttribute("cx")) || 0, height: Number(extent?.getAttribute("cy")) || 0,
        picture: (id) => urls.get(id) || null, theme
      });
      if (svg) return { kind: "image", blob: new Blob([svg], { type: "image/svg+xml" }), alt };
    }

    const blip = el.getElementsByTagNameNS("*", "blip")[0];
    // Older (VML) pictures: <v:imagedata r:id="…">.
    const id = blip?.getAttributeNS(NS_R, "embed") || el.getElementsByTagNameNS("*", "imagedata")[0]?.getAttributeNS(NS_R, "id");
    const target = id && rels.get(id);
    const type = target && IMAGE_TYPES[target.split(".").pop().toLowerCase()];
    if (!type) return null;                // EMF/WMF and friends: browsers can't show them
    const data = await zip.read(target);
    return data ? { kind: "image", blob: new Blob([data], { type }), alt } : null;
  }

  // A paragraph's runs; pictures in it come out as separate blocks, and page
  // breaks inside it are reported so the caller can start a page there.
  async function paragraphRuns(p, base) {
    const runs = [], images = [];
    let breakBefore = false, breakAfter = false;
    const walk = async (parent) => {
      for (const c of parent.children) {
        const name = c.localName;
        if (name === "r") {
          const rPr = kid(c, "rPr");
          const style = {
            b: rPr && kid(rPr, "b") ? on(kid(rPr, "b")) : base.b,
            i: rPr && kid(rPr, "i") ? on(kid(rPr, "i")) : base.i,
            u: !!rPr && on(kid(rPr, "u"))
          };
          for (const t of c.children) {
            const n = t.localName;
            if (n === "t") { if (t.textContent) runs.push({ text: t.textContent, ...style }); }
            else if (n === "tab") runs.push({ text: "\t", ...style });
            else if (n === "br") {
              if (t.getAttribute("w:type") === "page") { if (runs.length) breakAfter = true; else breakBefore = true; }
              else runs.push({ text: "\n" });
            } else if (n === "lastRenderedPageBreak") {
              // Where Word last started a new page. Mid-paragraph: the
              // paragraph stays whole on the earlier page.
              if (!runs.some((r) => r.text.trim())) breakBefore = true;
            }
            else if (n === "drawing" || n === "pict") { const img = await image(t); if (img) images.push(img); }
            else if (n === "AlternateContent") {
              // Newer drawings (shape groups, canvases) come wrapped; the
              // Choice is the DrawingML version, the Fallback older VML.
              for (const alt of [kid(t, "Choice"), kid(t, "Fallback")]) {
                const d = alt && [...alt.children].find((x) => x.localName === "drawing" || x.localName === "pict");
                const img = d && await image(d);
                if (img) { images.push(img); break; }
              }
            }
          }
        } else if (name === "hyperlink" || name === "smartTag" || name === "ins" || name === "fldSimple" || name === "sdtContent") {
          await walk(c);
        } else if (name === "sdt") {
          await walk(kid(c, "sdtContent") || c);
        }
      }
    };
    await walk(p);
    return { runs, images, breakBefore, breakAfter };
  }

  async function paragraph(p, { inTable = false } = {}) {
    const pPr = kid(p, "pPr");
    const style = styleOf(val(kid(pPr, "pStyle"))) || {};
    const outline = val(kid(pPr, "outlineLvl"));
    const heading = style.heading ?? (outline != null && Number(outline) < 6 ? Number(outline) + 1 : null);
    const { runs, images, breakBefore, breakAfter } = await paragraphRuns(p, { b: !!style.b && !heading, i: !!style.i });
    if (on(kid(pPr, "pageBreakBefore"))) return { block: null, runs, images, heading, breakBefore: true, breakAfter, pPr };

    let list = null;
    const numPr = kid(pPr, "numPr");
    const numId = val(kid(numPr, "numId")) ?? style.num?.numId ?? null;
    if (numId && numId !== "0") {
      const own = val(kid(numPr, "ilvl"));
      const level = own != null ? Number(own) : (style.num?.ilvl ?? 0);
      const n = numberOf(numId, level);
      if (n) list = { level: Math.min(level, 8), marker: n.marker, ordered: n.ordered };
    }
    const jc = val(kid(pPr, "jc"));
    const align = jc === "center" ? "center" : (jc === "right" || jc === "end") ? "right" : (jc === "both" || jc === "distribute") ? "justify" : null;
    return { runs, images, heading, list, align, breakBefore, breakAfter, pPr, inTable };
  }

  async function table(tbl) {
    const rows = [];
    for (const tr of kids(tbl, "tr")) {
      const row = [];
      for (const tc of kids(tr, "tc")) {
        const tcPr = kid(tc, "tcPr");
        if (val(kid(tcPr, "vMerge")) === null && kid(tcPr, "vMerge")) continue;   // continuation of a merged cell
        const paras = [];
        for (const p of kids(tc, "p")) {
          const r = await paragraph(p, { inTable: true });
          if (r.runs.some((x) => x.text.trim())) paras.push(r.runs);
        }
        row.push({ paras, colSpan: Number(val(kid(tcPr, "gridSpan")) || 1) });
      }
      if (row.length) rows.push(row);
    }
    return rows.some((r) => r.some((c) => c.paras.length)) ? { kind: "table", rows } : null;
  }

  for (const el of body.children) {
    if (el.localName === "p") {
      const r = await paragraph(el);
      if (r.breakBefore) newPage();
      const hasText = r.runs.some((x) => x.text.trim());
      if (hasText) {
        cur().push(r.heading != null
          ? { kind: "heading", level: Math.min(6, Math.max(0, r.heading)), runs: r.runs }
          : { kind: "para", runs: r.runs, list: r.list, align: r.align });
      }
      r.images.forEach((img) => cur().push(img));
      if (r.breakAfter || kid(r.pPr, "sectPr")) newPage();   // page / section break
    } else if (el.localName === "tbl") {
      const t = await table(el);
      if (t) cur().push(t);
    } else if (el.localName === "sdt") {
      for (const p of kids(kid(el, "sdtContent"), "p")) {
        const r = await paragraph(p);
        if (r.runs.some((x) => x.text.trim())) cur().push({ kind: "para", runs: r.runs, list: r.list, align: r.align });
      }
    }
  }

  const kept = pages.filter((pg) => pg.blocks.length);
  if (!kept.length) throw new Error("this document has no text");
  kept.forEach((pg, i) => { pg.number = i + 1; });
  return { pages: kept };
}
