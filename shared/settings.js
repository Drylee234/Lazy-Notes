// Lazy Notes — the settings, built into any container (side panel ⚙ menu,
// All notes Settings dialog). Reads and writes chrome.storage.local and
// follows changes made elsewhere, so both places always agree:
//   lnTheme            "auto" | "light" | "dark"        (applied by theme.js)
//   lnPopupSide        "above" | "below" | "left" | "right" | "split"
//   lnAutocorrectLevel 0 Off · 1 Mild · 2 Strong · 3 Toxic   (old lnAutocorrect === false → 0)
//   lnDocAutoSelect    false = opening a document doesn't switch course/topic
//   pptxAutoOpen       false = .pptx downloads aren't opened in Lazy Notes
// Needs shared/settings.css.

globalThis.LazySettings = (() => {
  const LEVELS = ["Off", "Mild", "Strong", "Toxic"];

  const MARKUP = `
    <div class="set-label">Look</div>
    <div class="seg" data-key="lnTheme" data-default="auto" role="radiogroup" aria-label="Look">
      <button type="button" data-value="auto" role="radio">Auto</button>
      <button type="button" data-value="light" role="radio">Light</button>
      <button type="button" data-value="dark" role="radio">Dark</button>
    </div>
    <div class="set-label">Save pop-up appears</div>
    <div class="seg seg--wrap" data-key="lnPopupSide" data-default="above" role="radiogroup" aria-label="Save pop-up position">
      <button type="button" data-value="above" role="radio">Above</button>
      <button type="button" data-value="below" role="radio">Below</button>
      <button type="button" data-value="left" role="radio">Left</button>
      <button type="button" data-value="right" role="radio">Right</button>
      <button type="button" data-value="split" role="radio" title="Text on one side of the mouse, type and Save on the other">Split</button>
    </div>
    <label class="set-range">
      <span class="set-range-head"><span>Autocorrect</span><b class="set-level-name">Mild</b></span>
      <input type="range" class="set-level" min="0" max="3" step="1" value="1" aria-label="Autocorrect strength" />
      <span class="set-range-ticks"><span>Off</span><span>Mild</span><span>Strong</span><span>Toxic</span></span>
    </label>
    <label class="set-check"><input type="checkbox" data-key="lnDocAutoSelect" /> Opening a document switches to the course &amp; topic it saved to last</label>
    <label class="set-check"><input type="checkbox" data-key="pptxAutoOpen" /> Open PowerPoint (.pptx) downloads in Lazy Notes</label>`;

  function build(container) {
    const root = document.createElement("div");
    root.className = "ln-settings";
    root.innerHTML = MARKUP;
    container.appendChild(root);

    const segs   = [...root.querySelectorAll(".seg")];
    const checks = [...root.querySelectorAll("input[type=checkbox][data-key]")];
    const level  = root.querySelector(".set-level");
    const levelName = root.querySelector(".set-level-name");

    const markSeg = (seg, v) => seg.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.value === (v || seg.dataset.default))));
    const showLevel = () => { levelName.textContent = LEVELS[level.value]; };

    function load() {
      chrome.storage.local.get(
        ["lnTheme", "lnPopupSide", "lnAutocorrect", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen"],
        (r) => {
          segs.forEach((seg) => markSeg(seg, r[seg.dataset.key]));
          checks.forEach((c) => { c.checked = r[c.dataset.key] !== false; });
          level.value = String(typeof r.lnAutocorrectLevel === "number" ? r.lnAutocorrectLevel : r.lnAutocorrect === false ? 0 : 1);
          showLevel();
        });
    }

    segs.forEach((seg) => seg.addEventListener("click", (e) => {
      const v = e.target.closest("button")?.dataset.value;
      if (!v) return;
      markSeg(seg, v);
      chrome.storage.local.set({ [seg.dataset.key]: v });
    }));
    checks.forEach((c) => c.addEventListener("change", () => chrome.storage.local.set({ [c.dataset.key]: c.checked })));
    level.addEventListener("input", () => { showLevel(); chrome.storage.local.set({ lnAutocorrectLevel: Number(level.value) }); });

    const KEYS = ["lnTheme", "lnPopupSide", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen"];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && KEYS.some((k) => k in changes)) load();
    });
    load();
    return root;
  }

  return { build };
})();
