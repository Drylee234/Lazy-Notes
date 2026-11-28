// Q-notes — makes the How-to-use tour's pictures (tour/*.png) and the
// marker positions (tour/positions.js) from the real extension, so the tour
// never drifts from what's on screen. Run it after changing the UI:
//   node tools/make-tour-shots.js
// Needs Playwright with Chromium (require('playwright') must work). Uses
// tour/sample-lecture.pdf and a made-up web page; seeds sample notes into a
// throwaway browser profile (your own notes are never touched).
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "tour");
globalThis.LN_TOUR_SLIDES = null;
require(path.join(OUT, "slides.js"));
const SLIDES = globalThis.LN_TOUR_SLIDES;
const C = "BME213 (Physiology)", T = "Cell membrane";

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>Cell membrane - Wikipedia-ish</title>
<body style="font:17px/1.6 Georgia,serif;max-width:760px;margin:40px 60px;color:#222">
<h1>Cell membrane</h1><p>The <b>cell membrane</b> (also known as the plasma membrane) is a biological membrane that separates and protects the interior of a cell from the outside environment.</p>
<h2>Function</h2><p>The cell membrane controls the movement of substances in and out of a cell. It is selectively permeable to ions and organic molecules.</p>
<p>Membrane proteins include integral proteins, which go through the membrane, and peripheral proteins, which sit on its surface.</p></body>`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith("/lecture.pdf")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(fs.readFileSync(path.join(OUT, "sample-lecture.pdf")));
      } else { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE_HTML); }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const t0 = Date.parse("2026-11-26T10:00:00Z");
const ts = (i) => new Date(t0 + i * 60000).toISOString();
const H = (text, category, i, extra = {}) => ({ text, category, annotation: null, context: null, sourceUrl: "x", sourceTitle: "PIO 201 lecture.pdf", timestamp: ts(i), ...extra });
const SEED = {
  lnTourOnReload: false,
  highlighterActive: true,
  activeCourse: C, activeTopic: T,
  lazynotes: { courses: { [C]: { created: ts(0), topics: { [T]: { created: ts(0),
    highlights: {
      h1: H("TRANSPORT THROUGH THE CELL MEMBRANE", "header", 1),
      h2: H("Introduction", "sub topic", 2),
      h3: H("The cell membrane is a lipid bilayer with proteins floating in it.", "generic", 3),
      h4: H("It is selectively permeable.", "generic", 4),
      h5: H("Diffusion", "sub topic", 6),
      h6: H("Diffusion means random molecular movement of substances.", "generic", 7),
      h7: H("Simple diffusion: no carrier protein needed.", "generic", 8, { indent: 1 }),
      h8: H("Facilitated diffusion: needs a carrier protein.", "generic", 9, { indent: 1 }),
      h9: H("Active transport", "sub topic", 11),
      h10: H("Moves substances against a concentration gradient, using ATP.", "generic", 12),
    },
    notes: {
      n1: { text: "two kinds: passive (diffusion) and active\nexam: know the Na/K pump numbers", timestamp: ts(5), edited: null },
      n2: { text: "3 Na+ out, 2 K+ in", timestamp: ts(13), edited: null },
    } } } } } },
};

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ln-tour-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium", headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${REPO}`, `--load-extension=${REPO}`],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const ext = (p) => `chrome-extension://${sw.url().split("/")[2]}/${p}`;
  await sw.evaluate(async (d) => { await chrome.storage.local.clear(); await chrome.storage.local.set(d); }, SEED);
  for (const pg of ctx.pages()) if (pg.url().includes("tour.html")) await pg.close();
  const positions = {};

  // Where each marker goes: the element's box, as % of the picture.
  async function measure(page, slide, clip) {
    const W = clip ? clip.width : page.viewportSize().width, Hh = clip ? clip.height : page.viewportSize().height;
    const ox = clip ? clip.x : 0, oy = clip ? clip.y : 0;
    const panelFrame = page.frames().find((f) => f.url().includes("sidepanel.html"));
    const panelBox = await page.evaluate(() => {
      const f = document.querySelector("#ln-embed iframe") || document.querySelector("#lazy-notes-page-panel")?.shadowRoot?.querySelector("iframe");
      const r = f?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null;
    });
    const out = [];
    for (const s of slide.spots || []) {
      const scope = s.frame === "panel" ? panelFrame : page;
      let r = scope && await scope.evaluate((sel) => {
        let el = null;
        for (const one of sel.split(/\s*,\s*/)) { el = document.querySelector(one); if (el && el.getClientRects().length) break; }
        if (el?.id === "lazy-notes-page-panel") el = el.shadowRoot.querySelector(".wrap");
        const b = el?.getBoundingClientRect();
        return b && b.width ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      }, s.sel).catch(() => null);
      if (r && s.frame === "panel" && panelBox) { r.x += panelBox.x; r.y += panelBox.y; }
      if (!r) { console.warn(`  ! ${slide.id}: no "${s.sel}"`); out.push(null); continue; }
      const pct = (v, of) => Math.round((v / of) * 1000) / 10;
      out.push({ x: pct(r.x - ox, W), y: pct(r.y - oy, Hh), w: pct(r.w, W), h: pct(r.h, Hh) });
    }
    positions[slide.id] = out;
  }
  async function shoot(page, id, clip) {
    const slide = SLIDES.find((s) => s.id === id);
    await measure(page, slide, clip);
    await page.screenshot({ path: path.join(OUT, `${id}.png`), clip });
    console.log(`  ✓ ${id}`);
  }

  // ── PDF reader, save pop-up, panel, study, quick note ──
  const p = await ctx.newPage();
  await p.goto(ext(`pdfreader.html?url=${encodeURIComponent(base + "/lecture.pdf")}`));
  await p.waitForTimeout(2500);
  // "Where do these notes go?": the only course, its only topic, Enter.
  await p.focus("#ln-place select"); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(200);
  await p.keyboard.press("Enter"); await p.waitForTimeout(800);
  await p.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.resolve(); });
  await p.mouse.move(400, 500);
  await p.waitForTimeout(400);
  await shoot(p, "reader");

  const spans = await p.$$eval(".textLayer span", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const line = spans.find((s) => s.t.startsWith("It separates"));
  await p.mouse.move(line.x + 2, line.y + line.h / 2); await p.mouse.down();
  await p.mouse.move(line.x + line.w - 3, line.y + line.h / 2, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(700);
  // Close up: the pop-up and the selected line.
  const around = async (sel, extra) => {
    const r = await p.evaluate((q) => { const b = [...document.querySelectorAll(q)].find((x) => x.getClientRects().length)?.getBoundingClientRect(); return b && { x: b.x, y: b.y, r: b.right, b: b.bottom }; }, sel);
    const x0 = Math.max(0, Math.min(r.x, extra?.x ?? r.x) - 50), y0 = Math.max(0, Math.min(r.y, extra?.y ?? r.y) - 40);
    const x1 = Math.min(1280, Math.max(r.r, extra?.r ?? r.r) + 50), y1 = Math.min(800, Math.max(r.b, extra?.b ?? r.b) + 40);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  };
  await shoot(p, "popup", await around(".lazy-notes-popup", { x: line.x, y: line.y, r: line.x + line.w, b: line.y + line.h }));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.mouse.click(300, 760); await p.waitForTimeout(200);

  // The panel, solid (mouse over it).
  const box = await p.evaluate(() => { const r = document.getElementById("ln-embed").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.move(box.x + box.w / 2, box.y + 200); await p.waitForTimeout(500);
  const pclip = { x: Math.max(0, box.x - 40), y: 0, width: Math.min(1280 - Math.max(0, box.x - 40), box.w + 60), height: Math.min(800, box.y + box.h + 20) };
  await shoot(p, "panel", pclip);

  // Study: hover a nested note's left edge so ⋮⋮ ⇤ ⇥ show.
  const pf = p.frames().find((f) => f.url().includes("sidepanel.html"));
  const nb = await pf.evaluate(() => { const el = document.querySelector('.note[data-id="h7"]'); el?.scrollIntoView({ block: "center" }); const r = el?.getBoundingClientRect(); return r && { x: r.x, y: r.y }; });
  const fb = await p.evaluate(() => { const r = document.querySelector("#ln-embed iframe").getBoundingClientRect(); return { x: r.x, y: r.y }; });
  if (nb) { await p.mouse.move(fb.x + nb.x + 10, fb.y + nb.y + 8); await p.waitForTimeout(400); }
  await shoot(p, "study", pclip);

  await p.mouse.click(300, 760); await p.waitForTimeout(200);
  await p.keyboard.press("Control+Shift+Period"); await p.waitForTimeout(600);
  await p.keyboard.type("ask the lecturer about co-transport");
  await shoot(p, "quick", await around(".lnq-box"));
  await p.keyboard.press("Escape");

  // ── A web page with the docked panel ──
  const w = await ctx.newPage();
  await w.goto(base + "/page.html"); await w.waitForTimeout(1200);
  const [tab] = await sw.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1/*" }); if (t) await chrome.tabs.sendMessage(t.id, { type: "LN_PAGE_PANEL", action: "open" }); });
  void tab;
  await w.waitForTimeout(1500);
  await shoot(w, "web");

  // ── All notes (a topic page): edge tools + a typed note being edited ──
  const a = await ctx.newPage();
  await a.goto(ext(`display.html?course=${encodeURIComponent(C)}&topic=${encodeURIComponent(T)}`));
  await a.waitForTimeout(900);
  await a.click('.note[data-id="n1"] .note-text'); await a.waitForTimeout(300);
  const hb = await a.locator('.note[data-id="h10"]').boundingBox();
  await a.mouse.move(hb.x + 8, hb.y + hb.height / 2); await a.waitForTimeout(400);
  const app = await a.locator("#app").boundingBox();
  await shoot(a, "allnotes", { x: Math.round(app.x), y: Math.round(app.y), width: Math.round(app.width), height: Math.min(800 - Math.round(app.y), Math.round(app.height)) });
  await a.keyboard.press("Escape");

  // ── Settings (with one line changed, so ↺ shows) ──
  await sw.evaluate(async () => chrome.storage.local.set({ lnPopupSide: "below" }));
  await a.reload(); await a.waitForTimeout(700);
  await a.click("#open-settings"); await a.waitForTimeout(400);
  await a.evaluate(() => document.querySelector(".set-more:not(.set-old)").open = false);
  const dlg = await a.locator(".settings-dialog").boundingBox();
  await shoot(a, "settings", { x: Math.round(dlg.x), y: Math.round(dlg.y), width: Math.round(dlg.width), height: Math.min(800 - Math.round(dlg.y), Math.round(dlg.height)) });

  fs.writeFileSync(path.join(OUT, "positions.js"),
    "// Made by tools/make-tour-shots.js: where each tour marker sits (% of its picture).\nglobalThis.LN_TOUR_POS = " + JSON.stringify(positions, null, 1) + ";\n");
  await ctx.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("done");
})();
