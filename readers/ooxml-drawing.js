// Q-notes — Office drawings (lines, connectors with arrowheads, shapes,
// text boxes, groups, drawing canvases) as SVG, for the Word and slides
// readers.
//
// A diagram in Word is often not one picture but a group of shapes: straight
// lines and connectors with arrowheads, rectangles/ellipses, text boxes for
// the labels, and maybe pictures. docx-parse.js used to keep only the first
// picture in a drawing, so the lines and arrows vanished. This draws the
// whole thing. The slides reader uses shapeSvg() for single shapes: its
// text boxes are already laid out as text, but lines and arrows weren't drawn.
//
// drawingSvg(graphicData, { width, height, picture, theme }) → SVG text, or null
//   graphicData  the a:graphicData of a w:drawing
//   width/height the drawing's size on the page (EMU, from wp:extent)
//   picture(rId) → data URL of an embedded picture (or null)
//   theme        Map of scheme colour name → "RRGGBB"
//
// Not a full DrawingML renderer: preset shapes beyond the common ones are
// drawn as their box, gradients use their first colour, effects are ignored.

const EMU_PER_PX = 9525;

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid  = (el, name) => (el ? [...el.children].find((c) => c.localName === name) ?? null : null);
const num  = (el, attr, dflt = 0) => { const v = el?.getAttribute(attr); return v == null || v === "" ? dflt : Number(v); };
const esc  = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r2   = (n) => Math.round(n * 100) / 100;

// ── Colours ────────────────────────────────────────────────────────────────

const PRESET = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
                 yellow: "FFFF00", gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3",
                 orange: "FFA500", purple: "800080", navy: "000080", cyan: "00FFFF", magenta: "FF00FF" };
const SCHEME_ALIAS = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
const DEFAULT_THEME = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4",
                        accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5",
                        accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };

// A colour element (srgbClr, schemeClr, …) → "#rrggbb", with lumMod/lumOff,
// shade and tint applied. `phClr` (a style's placeholder) takes `ph`.
function colour(el, theme, ph) {
  if (!el) return null;
  let hex = null;
  const n = el.localName;
  if (n === "srgbClr") hex = el.getAttribute("val");
  else if (n === "sysClr") hex = el.getAttribute("lastClr") || (el.getAttribute("val") === "window" ? "FFFFFF" : "000000");
  else if (n === "prstClr") hex = PRESET[el.getAttribute("val")] || "000000";
  else if (n === "scrgbClr") hex = ["r", "g", "b"].map((k) => Math.round(Math.min(1, num(el, k) / 100000) * 255).toString(16).padStart(2, "0")).join("");
  else if (n === "schemeClr") {
    const v = el.getAttribute("val");
    if (v === "phClr") return ph || null;
    const key = SCHEME_ALIAS[v] || v;
    hex = theme?.get(key) || DEFAULT_THEME[key] || "000000";
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  for (const m of el.children) {
    const v = num(m, "val") / 100000;
    if (m.localName === "lumMod" || m.localName === "lumOff") {
      let [h, s, l] = toHsl(r, g, b);
      l = m.localName === "lumMod" ? l * v : l + v;
      [r, g, b] = fromHsl(h, s, Math.max(0, Math.min(1, l)));
    } else if (m.localName === "shade") { r *= v; g *= v; b *= v; }
    else if (m.localName === "tint") { r = 1 - (1 - r) * v; g = 1 - (1 - g) * v; b = 1 - (1 - b) * v; }
  }
  return "#" + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("");
}

function toHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h, s, l) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// The first colour inside a fill/line element (solidFill, gradFill's first stop).
function fillColour(el, theme, ph) {
  if (!el) return undefined;
  if (el.localName === "noFill") return null;
  if (el.localName === "solidFill") return colour(el.firstElementChild, theme, ph);
  if (el.localName === "gradFill") return colour(el.getElementsByTagNameNS("*", "gs")[0]?.firstElementChild, theme, ph);
  return undefined;
}
const FILLS = ["noFill", "solidFill", "gradFill", "pattFill", "blipFill"];
const firstFill = (el) => (el ? [...el.children].find((c) => FILLS.includes(c.localName)) : null);

// ── Geometry ───────────────────────────────────────────────────────────────

const xfrmOf = (spPr) => {
  const x = kid(spPr, "xfrm");
  const off = kid(x, "off"), ext = kid(x, "ext");
  return {
    x: num(off, "x"), y: num(off, "y"), w: num(ext, "cx"), h: num(ext, "cy"),
    rot: num(x, "rot") / 60000, flipH: x?.getAttribute("flipH") === "1", flipV: x?.getAttribute("flipV") === "1",
    chX: num(kid(x, "chOff"), "x"), chY: num(kid(x, "chOff"), "y"),
    chW: num(kid(x, "chExt"), "cx"), chH: num(kid(x, "chExt"), "cy"), has: !!x
  };
};

// A preset shape's outline as SVG path data in a w × h box (null: open line).
function presetPath(prst, w, h, adj) {
  const a = (i, d) => (adj[i] ?? d) / 100000;
  switch (prst) {
    case "line": case "straightConnector1":
      return { d: `M0 0L${w} ${h}`, open: true };
    case "bentConnector2":
      return { d: `M0 0L${w} 0L${w} ${h}`, open: true };
    case "bentConnector3": { const x = w * a(0, 50000); return { d: `M0 0L${x} 0L${x} ${h}L${w} ${h}`, open: true }; }
    case "bentConnector4": { const x = w * a(0, 50000), y = h * a(1, 50000); return { d: `M0 0L${x} 0L${x} ${y}L${w} ${y}L${w} ${h}`, open: true }; }
    case "curvedConnector3": { const x = w * a(0, 50000); return { d: `M0 0C${x} 0 ${x} ${h} ${w} ${h}`, open: true }; }
    case "ellipse": case "flowChartConnector":
      return { d: `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z` };
    case "roundRect": case "flowChartAlternateProcess": {
      const r = Math.min(w, h) * a(0, 16667);
      return { d: `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z` };
    }
    case "triangle": { const x = w * a(0, 50000); return { d: `M${x} 0L${w} ${h}L0 ${h}Z` }; }
    case "rtTriangle": return { d: `M0 0L${w} ${h}L0 ${h}Z` };
    case "diamond": case "flowChartDecision": return { d: `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z` };
    case "parallelogram": case "flowChartInputOutput": { const x = Math.min(w, h) * a(0, 25000); return { d: `M${x} 0L${w} 0L${w - x} ${h}L0 ${h}Z` }; }
    case "rightArrow": {
      const t = h * a(0, 50000), hd = Math.min(w, Math.min(w, h) * a(1, 50000)), y0 = (h - t) / 2;
      return { d: `M0 ${y0}H${w - hd}V0L${w} ${h / 2}L${w - hd} ${h}V${y0 + t}H0Z` };
    }
    case "leftArrow": {
      const t = h * a(0, 50000), hd = Math.min(w, Math.min(w, h) * a(1, 50000)), y0 = (h - t) / 2;
      return { d: `M${w} ${y0}H${hd}V0L0 ${h / 2}L${hd} ${h}V${y0 + t}H${w}Z` };
    }
    default:
      return { d: `M0 0H${w}V${h}H0Z` };
  }
}

// a:custGeom → SVG path data scaled into the w × h box.
function customPath(custGeom, w, h) {
  let d = "", open = true;
  for (const p of kids(kid(custGeom, "pathLst"), "path")) {
    const pw = num(p, "w") || w || 1, ph = num(p, "h") || h || 1;
    const sx = w / pw, sy = h / ph;
    const pt = (el) => `${r2(num(el, "x") * sx)} ${r2(num(el, "y") * sy)}`;
    let cur = [0, 0];
    for (const c of p.children) {
      const pts = kids(c, "pt");
      if (c.localName === "moveTo") { d += `M${pt(pts[0])}`; cur = [num(pts[0], "x") * sx, num(pts[0], "y") * sy]; }
      else if (c.localName === "lnTo") { d += `L${pt(pts[0])}`; cur = [num(pts[0], "x") * sx, num(pts[0], "y") * sy]; }
      else if (c.localName === "cubicBezTo" && pts.length === 3) { d += `C${pts.map(pt).join(" ")}`; cur = [num(pts[2], "x") * sx, num(pts[2], "y") * sy]; }
      else if (c.localName === "quadBezTo" && pts.length === 2) { d += `Q${pts.map(pt).join(" ")}`; cur = [num(pts[1], "x") * sx, num(pts[1], "y") * sy]; }
      else if (c.localName === "arcTo") {
        // Ellipse arc from the current point: radii, start angle, sweep (60000ths of a degree).
        const wr = num(c, "wR") * sx, hr = num(c, "hR") * sy;
        const st = num(c, "stAng") / 60000 * Math.PI / 180, sw = num(c, "swAng") / 60000 * Math.PI / 180;
        const cx = cur[0] - wr * Math.cos(st), cy = cur[1] - hr * Math.sin(st);
        const ex = cx + wr * Math.cos(st + sw), ey = cy + hr * Math.sin(st + sw);
        d += `A${r2(wr)} ${r2(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r2(ex)} ${r2(ey)}`;
        cur = [ex, ey];
      } else if (c.localName === "close") { d += "Z"; open = false; }
    }
  }
  return d ? { d, open } : null;
}

// ── Arrowheads ─────────────────────────────────────────────────────────────

const ARROW_SIZE = { sm: 4, med: 6, lg: 9 };   // in line widths, close to how Word draws them

function markerFor(end, stroke, defs) {
  const type = end?.getAttribute("type");
  if (!type || type === "none") return null;
  const w = ARROW_SIZE[end.getAttribute("w")] || 6, len = ARROW_SIZE[end.getAttribute("len")] || 6;
  const id = `m-${type}-${w}-${len}-${stroke.slice(1)}`;
  if (!defs.has(id)) {
    // Drawn pointing along +x with its tip at the line's end; sized in stroke widths.
    let shape;
    if (type === "oval") shape = `<ellipse cx="${len / 2}" cy="${w / 2}" rx="${len / 2}" ry="${w / 2}" fill="${stroke}"/>`;
    else if (type === "diamond") shape = `<path d="M0 ${w / 2}L${len / 2} 0L${len} ${w / 2}L${len / 2} ${w}Z" fill="${stroke}"/>`;
    else if (type === "arrow") shape = `<path d="M0 0L${len} ${w / 2}L0 ${w}" fill="none" stroke="${stroke}" stroke-width="1"/>`;
    else if (type === "stealth") shape = `<path d="M0 0L${len} ${w / 2}L0 ${w}L${len / 3} ${w / 2}Z" fill="${stroke}"/>`;
    else shape = `<path d="M0 0L${len} ${w / 2}L0 ${w}Z" fill="${stroke}"/>`;   // triangle
    const refX = type === "oval" || type === "diamond" ? len / 2 : len * 0.9;
    defs.set(id, `<marker id="${id}" viewBox="0 0 ${len} ${w}" refX="${refX}" refY="${w / 2}" markerWidth="${len}" markerHeight="${w}" markerUnits="strokeWidth" orient="auto-start-reverse" overflow="visible">${shape}</marker>`);
  }
  return id;
}

// ── Text boxes ─────────────────────────────────────────────────────────────

function textBox(txbx, box, bodyPr, scale) {
  const content = kid(txbx, "txbxContent");
  if (!content) return "";
  const lIns = num(bodyPr, "lIns", 91440) / scale, tIns = num(bodyPr, "tIns", 45720) / scale, rIns = num(bodyPr, "rIns", 91440) / scale;
  const innerW = Math.max(1, box.w - lIns - rIns);
  let y = box.y + tIns, out = "";
  for (const p of content.getElementsByTagNameNS("*", "p")) {
    const jc = p.getElementsByTagNameNS("*", "jc")[0]?.getAttribute("w:val");
    const anchor = jc === "center" ? "middle" : jc === "right" || jc === "end" ? "end" : "start";
    const x = anchor === "middle" ? box.x + lIns + innerW / 2 : anchor === "end" ? box.x + box.w - rIns : box.x + lIns;
    const runs = [];
    let size = 11;
    for (const r of p.getElementsByTagNameNS("*", "r")) {
      const rPr = kid(r, "rPr");
      const sz = kid(rPr, "sz")?.getAttribute("w:val");
      if (sz) size = Number(sz) / 2;
      const text = [...r.children].map((t) => (t.localName === "t" ? t.textContent : t.localName === "tab" ? " " : "")).join("");
      if (!text) continue;
      const tog = (n) => { const e = kid(rPr, n); return !!e && !/^(0|false)$/.test(e.getAttribute("w:val") || ""); };
      const fontEl = kid(rPr, "rFonts");
      const colEl = kid(rPr, "color")?.getAttribute("w:val");
      runs.push({ text, size, b: tog("b"), i: tog("i"),
                  font: fontEl?.getAttribute("w:ascii") || fontEl?.getAttribute("w:hAnsi") || null,
                  color: colEl && colEl !== "auto" ? `#${colEl}` : null,
                  sub: kid(rPr, "vertAlign")?.getAttribute("w:val") });
    }
    const lineH = size * 1.2 * 12700 / scale;   // points → EMU (text keeps its size when a group is resized)
    y += lineH;
    if (!runs.length) continue;
    const spans = runs.map((r) => {
      const attrs = [`font-size="${r2(r.size * (r.sub ? 0.65 : 1))}"`];
      if (r.b) attrs.push(`font-weight="bold"`);
      if (r.i) attrs.push(`font-style="italic"`);
      if (r.font) attrs.push(`font-family="${esc(r.font)}, serif"`);
      if (r.color) attrs.push(`fill="${esc(r.color)}"`);
      if (r.sub === "subscript") attrs.push(`baseline-shift="sub"`);
      if (r.sub === "superscript") attrs.push(`baseline-shift="super"`);
      return `<tspan ${attrs.join(" ")}>${esc(r.text)}</tspan>`;
    }).join("");
    // Sized in points and scaled up: browsers cap font sizes, and EMU-sized
    // text (12pt = 152400) would be clamped to a speck.
    out += `<text transform="translate(${r2(x)} ${r2(y - lineH * 0.25)}) scale(${r2(12700 / scale)})" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
  }
  return out;
}

// ── Shapes ─────────────────────────────────────────────────────────────────

// Transform for a shape's rotation/flip about its own centre.
function turn(b) {
  const parts = [];
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (b.rot) parts.push(`rotate(${r2(b.rot)} ${r2(cx)} ${r2(cy)})`);
  if (b.flipH || b.flipV) parts.push(`translate(${r2(cx)} ${r2(cy)}) scale(${b.flipH ? -1 : 1} ${b.flipV ? -1 : 1}) translate(${r2(-cx)} ${r2(-cy)})`);
  return parts.length ? ` transform="${parts.join(" ")}"` : "";
}

function shape(sp, ctx, scale) {
  const spPr = kid(sp, "spPr");
  const b = xfrmOf(spPr);
  const style = kid(sp, "style");
  const styleClr = (ref) => colour(kid(style, ref)?.firstElementChild, ctx.theme);
  let out = "";

  // Geometry
  const geom = kid(spPr, "prstGeom");
  const adj = kids(kid(geom, "avLst"), "gd").map((g) => Number((g.getAttribute("fmla") || "").replace(/^val\s+/, "")));
  const prst = geom?.getAttribute("prst") || (kid(spPr, "custGeom") ? null : "rect");
  const outline = prst ? presetPath(prst, b.w, b.h, adj) : customPath(kid(spPr, "custGeom"), b.w, b.h);

  // Fill and line: explicit first, then the shape style's references.
  let fill = fillColour(firstFill(spPr), ctx.theme);
  if (fill === undefined) fill = num(kid(style, "fillRef"), "idx") > 0 ? styleClr("fillRef") : null;
  const ln = kid(spPr, "ln");
  let stroke = fillColour(firstFill(ln), ctx.theme);
  if (stroke === undefined) stroke = style ? (num(kid(style, "lnRef"), "idx") > 0 ? styleClr("lnRef") : null)
                                           : (outline?.open ? "#000000" : null);
  const lineW = Math.max(3175, num(ln, "w", 9525));
  const dash = kid(ln, "prstDash")?.getAttribute("val");

  if (outline && (fill || stroke)) {
    const attrs = [`d="${outline.d}"`, `fill="${outline.open || !fill ? "none" : fill}"`];
    if (stroke) {
      attrs.push(`stroke="${stroke}"`, `stroke-width="${r2(lineW / scale)}"`, `stroke-linejoin="round"`);
      if (dash && dash !== "solid") attrs.push(`stroke-dasharray="${/^(sys)?[Dd]ot$/.test(dash) ? `${r2(lineW / scale)} ${r2(lineW * 2 / scale)}` : `${r2(lineW * 4 / scale)} ${r2(lineW * 3 / scale)}`}"`);
      if (outline.open) {
        const head = markerFor(kid(ln, "headEnd"), stroke, ctx.defs);
        const tail = markerFor(kid(ln, "tailEnd"), stroke, ctx.defs);
        if (head) attrs.push(`marker-start="url(#${head})"`);
        if (tail) attrs.push(`marker-end="url(#${tail})"`);
      }
    }
    out += `<path transform="translate(${b.x} ${b.y})" ${attrs.join(" ")}/>`;
  }
  const shapeOut = out ? `<g${turn(b)}>${out}</g>` : "";

  // Text box contents: turned with the shape, but never mirrored.
  const txbx = kid(sp, "txbx");
  const text = txbx ? textBox(txbx, b, kid(sp, "bodyPr"), scale) : "";
  const textOut = text ? `<g${b.rot ? ` transform="rotate(${r2(b.rot)} ${r2(b.x + b.w / 2)} ${r2(b.y + b.h / 2)})"` : ""}>${text}</g>` : "";
  if (text) ctx.drawn++;
  if (shapeOut) ctx.drawn++;
  return shapeOut + textOut;
}

function picture(pic, ctx) {
  const blip = pic.getElementsByTagNameNS("*", "blip")[0];
  const url = blip && ctx.picture(blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"));
  if (!url) return "";
  const b = xfrmOf(kid(pic, "spPr"));
  ctx.drawn++;
  return `<g${turn(b)}><image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none" href="${esc(url)}"/></g>`;
}

// Children of a group or canvas, in the coordinate space they're written in.
function children(parent, ctx, scale) {
  let out = "";
  for (const c of parent.children) {
    const n = c.localName;
    if (n === "wsp" || n === "sp" || n === "cxnSp") out += shape(c, ctx, scale);
    else if (n === "pic") out += picture(c, ctx);
    else if (n === "grpSp" || n === "wgp") out += group(c, ctx, scale);
    else if (n === "AlternateContent") {
      const inner = kid(c, "Choice") || kid(c, "Fallback");
      if (inner) out += children(inner, ctx, scale);
    }
  }
  return out;
}

// A group: its children are written in a child space (chOff/chExt) mapped
// onto the group's own box (off/ext).
function group(g, ctx, scale) {
  const b = xfrmOf(kid(g, "grpSpPr"));
  if (!b.has) return children(g, ctx, scale);
  const sx = b.chW ? b.w / b.chW : 1, sy = b.chH ? b.h / b.chH : 1;
  const inner = children(g, ctx, scale * Math.sqrt(Math.abs(sx * sy)) || scale);
  if (!inner) return "";
  const t = `translate(${b.x} ${b.y}) scale(${sx} ${sy}) translate(${-b.chX} ${-b.chY})`;
  return `<g${turn(b)}><g transform="${t}">${inner}</g></g>`;
}

// ── Entry point ────────────────────────────────────────────────────────────

export function drawingSvg(graphicData, { width, height, picture: pictureUrl, theme }) {
  const root = [...(graphicData?.children || [])].find((c) => ["wgp", "wpc", "grpSp"].includes(c.localName));
  if (!root || !width || !height) return null;
  const ctx = { theme, picture: pictureUrl, defs: new Map(), drawn: 0 };
  let body;
  if (root.localName === "wpc") {
    // A drawing canvas: children are placed in the canvas's own box.
    const bg = fillColour(firstFill(kid(root, "bg")), theme);
    body = (bg ? `<rect width="${width}" height="${height}" fill="${bg}"/>` : "") + children(root, ctx, 1);
  } else {
    // A group: its box fills the drawing.
    const b = xfrmOf(kid(root, "grpSpPr"));
    const cw = b.chW || b.w || width, ch = b.chH || b.h || height;
    const sx = width / cw, sy = height / ch;
    const inner = children(root, ctx, Math.sqrt(sx * sy) || 1);
    body = `<g transform="scale(${sx} ${sy}) translate(${-(b.chW ? b.chX : b.x)} ${-(b.chH ? b.chY : b.y)})">${inner}</g>`;
  }
  if (!ctx.drawn) return null;
  const px = (emu) => Math.max(1, Math.round(emu / EMU_PER_PX));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px(width)}" height="${px(height)}" viewBox="0 0 ${width} ${height}" font-family="Calibri, Carlito, sans-serif">` +
         `<defs>${[...ctx.defs.values()].join("")}</defs>${body}</svg>`;
}

// word/theme/theme1.xml → Map of scheme colour name → "RRGGBB".
export function themeColours(themeRoot) {
  const map = new Map();
  const scheme = themeRoot?.getElementsByTagNameNS("*", "clrScheme")[0];
  for (const c of scheme?.children || []) {
    const v = c.firstElementChild;
    const hex = v?.localName === "srgbClr" ? v.getAttribute("val") : v?.localName === "sysClr" ? v.getAttribute("lastClr") : null;
    if (hex) map.set(c.localName, hex);
  }
  return map;
}

// One shape on its own (a slide's line, connector, arrow or box), for the
// slides reader: { svg, box } with box the area it covers in EMU — the
// shape's own box grown a little so line ends and arrowheads aren't cut.
// null when the shape draws nothing (no outline, no fill).
export function shapeSvg(sp, { theme }) {
  const b = xfrmOf(kid(sp, "spPr"));
  if (!b.has) return null;
  const ctx = { theme, picture: () => null, defs: new Map(), drawn: 0 };
  const body = shape(sp, ctx, 1);
  if (!ctx.drawn) return null;
  const lineW = Math.max(3175, num(kid(kid(sp, "spPr"), "ln"), "w", 9525));
  const pad = lineW * 8;
  const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="none" overflow="visible">` +
              `<defs>${[...ctx.defs.values()].join("")}</defs>${body}</svg>`;
  return { svg, box };
}
