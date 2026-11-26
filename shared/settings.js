// Lazy Notes — the settings, built into any container (side panel ⚙ menu,
// All notes Settings dialog). Reads and writes chrome.storage.local and
// follows changes made elsewhere, so both places always agree:
//   lnTheme            "auto" | "light" | "dark"        (applied by theme.js)
//   lnPopupSide        "above" | "below" | "left" | "right" | "split"
//   lnAutocorrectLevel 0 Off · 1 Mild · 2 Strong · 3 Toxic   (old lnAutocorrect === false → 0)
//   lnDocAutoSelect    false = opening a document doesn't switch course/topic
//   pptxAutoOpen       false = .pptx downloads aren't opened in Lazy Notes
//   More options: lnPanelMode "tab" | "docked"; lnQuickDblClick, lnQuickSelButtons,
//   lnQuickMenu, lnQuickFloat (ways to open the readers' pop-up note box);
//   lnDocCaret (keyboard cursor in PDFs). false = off.
// Needs shared/settings.css.

globalThis.LazySettings = (() => {
  const LEVELS = ["Off", "Mild", "Strong", "Toxic"];
  // "More options": on unless switched off (lnPanelMode: "tab" | "docked").
  const MORE_KEYS = ["lnPanelMode", "lnQuickDblClick", "lnQuickSelButtons", "lnQuickMenu", "lnQuickFloat", "lnDocCaret", "lnDocWordsOn", "lnTypingHints", "lnListHeadType"];

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
    <label class="set-check"><input type="checkbox" data-key="pptxAutoOpen" /> Open PowerPoint (.pptx) downloads in Lazy Notes</label>
    <details class="set-sync set-more">
      <summary class="set-label set-sync-head">More options</summary>
      <div class="set-label set-sub">Notes panel in the readers</div>
      <div class="seg" data-key="lnPanelMode" data-default="tab" role="radiogroup" aria-label="Notes panel in the readers">
        <button type="button" data-value="tab" role="radio" title="Hidden behind a tab on the right edge; slides out over the page">Edge tab</button>
        <button type="button" data-value="docked" role="radio" title="Always beside the document">Docked</button>
      </div>
      <div class="set-label set-sub">Pop-up note box opens with</div>
      <label class="set-check"><input type="checkbox" data-key="lnQuickDblClick" /> Double-click blank space</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickSelButtons" /> ✎ Note / ❝ Quote buttons in the save pop-up</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickMenu" /> Right-click → Quick note here</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickFloat" /> Floating ✎ button above the Notes tab</label>
      <div class="set-label set-sub">Saving</div>
      <label class="set-check"><input type="checkbox" data-key="lnListHeadType" /> List head type (8) when saving</label>
      <div class="set-label set-sub">Typing</div>
      <label class="set-check"><input type="checkbox" data-key="lnDocWordsOn" /> Words from the document you're reading count as spelled right</label>
      <label class="set-check"><input type="checkbox" data-key="lnTypingHints" /> Typing hints: finish a word from the document or your notes (→ accepts)</label>
      <div class="set-label set-sub">Documents</div>
      <label class="set-check"><input type="checkbox" data-key="lnDocCaret" /> Keyboard cursor in PDFs (click text, then arrows move it, Shift+arrows select)</label>
    </details>
    <div class="set-label set-backup-label">Backup</div>
    <div class="set-backup">
      <button type="button" class="set-btn set-export">Download backup</button>
      <button type="button" class="set-btn set-import">Restore…</button>
      <input type="file" class="set-file" accept=".json,application/json" hidden />
    </div>
    <div class="set-restore" hidden>
      <div class="set-restore-what"></div>
      <div class="set-backup">
        <button type="button" class="set-btn set-merge" title="Keep everything you have and add what's in the backup">Add to my notes</button>
        <button type="button" class="set-btn set-replace danger" title="Delete what's here and use the backup instead">Replace all</button>
        <button type="button" class="set-btn set-cancel">Cancel</button>
      </div>
    </div>
    <div class="set-backup-status"></div>
    <details class="set-sync">
      <summary class="set-label set-sync-head">Sync to your server <span class="set-sync-dot"></span></summary>
      <label class="set-field"><span>Server address</span>
        <input type="url" class="set-sync-url" placeholder="https://your-server.onrender.com" spellcheck="false" /></label>
      <label class="set-field"><span>Sync key</span>
        <span class="set-key-row">
          <input type="password" class="set-sync-key" placeholder="same as LAZYNOTES_KEY" spellcheck="false" autocomplete="off" />
          <button type="button" class="set-btn set-key-show" title="Show / hide">👁</button>
        </span></label>
      <div class="set-backup">
        <button type="button" class="set-btn set-key-gen" title="Make a new random key">Generate key</button>
        <button type="button" class="set-btn set-sync-now">Sync now</button>
      </div>
      <div class="set-sync-hint" hidden>Put this same key on your server as <b>LAZYNOTES_KEY</b>.</div>
      <div class="set-sync-status"></div>
      <div class="set-sync-phone" hidden>Open on phone: <span class="set-sync-link"></span></div>
    </details>`;

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
        ["lnTheme", "lnPopupSide", "lnAutocorrect", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen", ...MORE_KEYS],
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

    // ── Backup: everything (notes, courses, recent documents, settings) in
    //    one .json file; restoring either adds to what's here or replaces it.
    //    PDF/slides/Word files opened from this computer aren't included
    //    (they can be large); notes taken from them are.
    const status = root.querySelector(".set-backup-status");
    const restoreBox = root.querySelector(".set-restore");
    const fileInput = root.querySelector(".set-file");
    let pending = null;
    const say = (t, bad = false) => { status.textContent = t; status.classList.toggle("bad", bad); };
    const showLast = () => chrome.storage.local.get("lnLastBackup", ({ lnLastBackup }) => {
      if (!status.classList.contains("bad")) status.textContent = lnLastBackup
        ? `Last backup: ${new Date(lnLastBackup).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
        : "No backup yet: your notes only live in this Chrome.";
    });
    const count = (data) => {
      let topics = 0, notes = 0;
      Object.values(data?.lazynotes?.courses || {}).forEach((c) => Object.values(c.topics || {}).forEach((t) => {
        topics++; notes += Object.keys(t.highlights || {}).length + Object.keys(t.notes || {}).length;
      }));
      return { courses: Object.keys(data?.lazynotes?.courses || {}).length, topics, notes };
    };

    root.querySelector(".set-export").addEventListener("click", async () => {
      const all = await chrome.storage.local.get(null);
      delete all.lastDrag;
      const file = { app: "lazy-notes", version: 1, exportedAt: new Date().toISOString(), data: all };
      const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lazy-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await chrome.storage.local.set({ lnLastBackup: Date.now() });
      const n = count(all);
      say(`Saved: ${n.courses} courses, ${n.topics} topics, ${n.notes} notes.`);
    });

    root.querySelector(".set-import").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        if (parsed?.app !== "lazy-notes" || !parsed.data?.lazynotes) throw new Error("not a Lazy Notes backup");
        pending = parsed.data;
        const n = count(pending);
        root.querySelector(".set-restore-what").textContent =
          `${f.name}: ${n.courses} courses, ${n.topics} topics, ${n.notes} notes (from ${new Date(parsed.exportedAt).toLocaleDateString()}).`;
        restoreBox.hidden = false;
        say("");
      } catch (err) {
        say(`Couldn't read that file (${err.message}).`, true);
      }
    });
    root.querySelector(".set-cancel").addEventListener("click", () => { pending = null; restoreBox.hidden = true; showLast(); });

    // Add: courses, topics and notes from the backup join yours; a note
    // that's in both (same id) keeps your current version.
    root.querySelector(".set-merge").addEventListener("click", async () => {
      if (!pending) return;
      const { lazynotes = { courses: {} }, lnDocs = {} } = await chrome.storage.local.get(["lazynotes", "lnDocs"]);
      const mine = lazynotes.courses || (lazynotes.courses = {});
      let added = 0;
      Object.entries(pending.lazynotes.courses || {}).forEach(([cName, c]) => {
        const mc = mine[cName] || (mine[cName] = { ...c, topics: {} });
        mc.topics = mc.topics || {};
        Object.entries(c.topics || {}).forEach(([tName, t]) => {
          const mt = mc.topics[tName] || (mc.topics[tName] = { ...t, highlights: {}, notes: {} });
          for (const kind of ["highlights", "notes"]) {
            mt[kind] = mt[kind] || {};
            Object.entries(t[kind] || {}).forEach(([id, n]) => { if (!mt[kind][id]) { mt[kind][id] = n; added++; } });
          }
        });
      });
      await chrome.storage.local.set({ lazynotes, lnDocs: { ...(pending.lnDocs || {}), ...lnDocs } });
      pending = null;
      restoreBox.hidden = true;
      say(`Restored: ${added} notes added.`);
    });

    // Replace: exactly the backup (settings included). Asks twice.
    root.querySelector(".set-replace").addEventListener("click", async (e) => {
      if (!pending) return;
      const btn = e.currentTarget;
      if (!btn.classList.contains("armed")) {
        btn.classList.add("armed");
        btn.textContent = "Replace everything?";
        setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Replace all"; }, 4000);
        return;
      }
      await chrome.storage.local.clear();
      await chrome.storage.local.set(pending);
      pending = null;
      restoreBox.hidden = true;
      say("Replaced with the backup.");
    });
    showLast();

    // ── Sync to your server (background/bg_sync.js does the work) ──
    const syncUrl = root.querySelector(".set-sync-url");
    const syncKey = root.querySelector(".set-sync-key");
    const syncStatus = root.querySelector(".set-sync-status");
    const syncDot = root.querySelector(".set-sync-dot");
    const phone = root.querySelector(".set-sync-phone");
    const ago = (ms) => {
      const s = Math.round((Date.now() - ms) / 1000);
      return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString();
    };
    function showSync() {
      chrome.storage.local.get(["lnSyncUrl", "lnSyncKey", "lnSyncState"], ({ lnSyncUrl = "", lnSyncKey = "", lnSyncState: st = {} }) => {
        if (document.activeElement !== syncUrl) syncUrl.value = lnSyncUrl;
        if (document.activeElement !== syncKey) syncKey.value = lnSyncKey;
        const url = lnSyncUrl.trim().replace(/\/+$/, "");
        phone.hidden = !url;
        root.querySelector(".set-sync-link").textContent = url;
        let text = "", tone = "";
        if (!url || !lnSyncKey) { text = "Not set up."; tone = ""; }
        else if (st.lastError && /key|too big/i.test(st.lastError)) { text = st.lastError; tone = "bad"; }
        else if (st.lastError && st.pending) { text = `Waiting for the server… ${st.lastError.replace(/^.*— /, "")}`; tone = "wait"; }
        else if (st.pending) { text = "Changes waiting to sync…"; tone = "wait"; }
        else if (st.lastOkAt) { text = `Synced ${ago(st.lastOkAt)}`; tone = "ok"; }
        else { text = "Not synced yet."; tone = "wait"; }
        syncStatus.textContent = text;
        syncStatus.dataset.tone = tone;
        syncDot.dataset.tone = tone;
      });
    }
    const saveField = (input, key, clean) => input.addEventListener("change", () =>
      chrome.storage.local.set({ [key]: clean(input.value) }));
    saveField(syncUrl, "lnSyncUrl", (v) => v.trim().replace(/\/+$/, ""));
    saveField(syncKey, "lnSyncKey", (v) => v.trim());
    root.querySelector(".set-key-show").addEventListener("click", () => {
      syncKey.type = syncKey.type === "password" ? "text" : "password";
    });
    root.querySelector(".set-key-gen").addEventListener("click", () => {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      syncKey.value = [...bytes].map((b) => abc[b % abc.length]).join("");
      syncKey.type = "text";
      chrome.storage.local.set({ lnSyncKey: syncKey.value });
      root.querySelector(".set-sync-hint").hidden = false;
    });
    root.querySelector(".set-sync-now").addEventListener("click", async () => {
      await chrome.storage.local.set({ lnSyncUrl: syncUrl.value.trim().replace(/\/+$/, ""), lnSyncKey: syncKey.value.trim() });
      syncStatus.textContent = "Syncing… (a sleeping server can take a minute)";
      syncStatus.dataset.tone = "wait";
      chrome.runtime.sendMessage({ type: "SYNC_NOW" }, () => { void chrome.runtime.lastError; showSync(); });
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "local" && (c.lnSyncState || c.lnSyncUrl || c.lnSyncKey)) showSync();
    });
    showSync();

    const KEYS = ["lnTheme", "lnPopupSide", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen", ...MORE_KEYS];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && KEYS.some((k) => k in changes)) load();
    });
    load();
    return root;
  }

  return { build };
})();
