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
//   lnDocSnap (a press just beside a word still starts the highlight). false = off.
// Needs shared/settings.css.

globalThis.LazySettings = (() => {
  const LEVELS = ["Off", "Mild", "Strong", "Toxic"];
  // "More options": on unless switched off (lnPanelMode: "tab" | "docked").
  const MORE_KEYS = ["lnPanelMode", "lnQuickDblClick", "lnQuickSelButtons", "lnQuickMenu", "lnQuickFloat", "lnDocCaret", "lnDocSnap", "lnDocWordsOn", "lnTypingHints", "lnPunctFix", "lnListHeadType", "lnDropPageNums", "lnDupWarn", "lnHeadSplit", "lnGroupIndent", "lnSendReports", "lnBoldItalic", "lnPlainInBoxes", "lnDropPlain", "lnAiOn", "lnAskPlace"];

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
      <div class="set-label set-sub">New documents</div>
      <label class="set-check"><input type="checkbox" data-key="lnAskPlace" /> Ask which course &amp; topic a new document's notes go to (suggests one)</label>
      <div class="set-label set-sub">Notes panel in the readers</div>
      <div class="seg" data-key="lnPanelMode" data-default="float" role="radiogroup" aria-label="Notes panel in the readers">
        <button type="button" data-value="float" role="radio" title="A box over the page: drag it anywhere, fold it to its title bar">Floating</button>
        <button type="button" data-value="tab" role="radio" title="Hidden behind a tab on the right edge; slides out over the page">Edge tab</button>
        <button type="button" data-value="docked" role="radio" title="Always beside the document">Docked</button>
      </div>
      <div class="set-label set-sub">Pop-up note box opens with</div>
      <label class="set-check"><input type="checkbox" data-key="lnQuickDblClick" /> Double-click blank space</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickSelButtons" /> ✎ Note / ❝ Quote buttons in the save pop-up</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickMenu" /> Right-click → Quick note here</label>
      <label class="set-check"><input type="checkbox" data-key="lnQuickFloat" /> Floating ✎ button above the Notes tab</label>
      <div class="set-label set-sub">Notes</div>
      <label class="set-check"><input type="checkbox" data-key="lnGroupIndent" /> Indent notes under sub topics</label>
      <label class="set-check"><input type="checkbox" data-key="lnBoldItalic" data-off /> B / I buttons in the note box (Ctrl+B / Ctrl+I always work)</label>
      <label class="set-check"><input type="checkbox" data-key="lnPlainInBoxes" data-off /> Plain as a choice in note boxes (else typing is saved as Note; Plain stays for page words)</label>
      <label class="set-check"><input type="checkbox" data-key="lnDropPlain" data-off /> Text dragged into a note box goes in as normal text (not a quote, no question)</label>
      <div class="set-label set-sub">Saving</div>
      <label class="set-check"><input type="checkbox" data-key="lnListHeadType" /> List head type (8) when saving</label>
      <label class="set-check"><input type="checkbox" data-key="lnDropPageNums" /> Leave out lone page numbers picked up from PDFs</label>
      <label class="set-check"><input type="checkbox" data-key="lnDupWarn" /> Warn when the words are already saved in the topic</label>
      <label class="set-check"><input type="checkbox" data-key="lnHeadSplit" /> Offer to split “Heading: words…” into a heading + Definition</label>
      <div class="set-label set-sub">Typing</div>
      <label class="set-check"><input type="checkbox" data-key="lnDocWordsOn" /> Words from the document you're reading count as spelled right</label>
      <label class="set-check"><input type="checkbox" data-key="lnTypingHints" /> Typing hints: finish a word from the document or your notes (→ accepts)</label>
      <label class="set-check"><input type="checkbox" data-key="lnPunctFix" /> Fix stray punctuation as you type (“word ,next” → “word, next”, “(1791)discovered”, “produc[tion”)</label>
      <div class="set-label set-sub">Old notes</div>
      <div class="set-tidy">
        <span class="set-tidy-status">Old PDF highlights get their broken lines joined, like new ones.</span>
        <span class="set-backup">
          <button type="button" class="set-btn set-tidy-run" title="Join broken lines in old highlights (lists stay lists)">Tidy now</button>
          <button type="button" class="set-btn set-tidy-undo" title="Put every tidied highlight back as it was">Undo tidy</button>
        </span>
      </div>
      <div class="set-label set-sub">Documents</div>
      <label class="set-check"><input type="checkbox" data-key="lnDocCaret" /> Keyboard cursor in PDFs (click text, then arrows move it, Shift+arrows select)</label>
      <label class="set-check"><input type="checkbox" data-key="lnDocSnap" /> Start highlighting even if you press a little beside the words (PDFs)</label>
    </details>
    <details class="set-sync set-ai">
      <summary class="set-label set-sync-head">AI help <span class="set-ai-dot"></span></summary>
      <div class="set-ai-intro">Lazy Notes can ask an AI to tidy a highlight, explain it, or write a definition. It needs a <b>Groq API key</b> &mdash; free, no card, about 1,000 questions a day. Other services are in the list too. Nothing is sent anywhere until you paste a key and switch it on.</div>
      <label class="set-field"><span>Service</span>
        <select class="set-ai-provider"></select></label>
      <div class="set-ai-about"></div>
      <div class="set-ai-server" hidden></div>
      <label class="set-field set-ai-base-row" hidden><span>Address</span>
        <input type="url" class="set-ai-base" placeholder="http://localhost:11434/v1" spellcheck="false" /></label>
      <label class="set-field"><span>Key</span>
        <span class="set-key-row">
          <input type="password" class="set-ai-key" placeholder="paste your Groq API key" spellcheck="false" autocomplete="off" />
          <button type="button" class="set-btn set-ai-key-show" title="Show / hide">&#128065;</button>
        </span></label>
      <div class="set-ai-getkey"></div>
      <label class="set-field"><span>Model</span>
        <input type="text" class="set-ai-model" list="set-ai-models" spellcheck="false" />
        <datalist id="set-ai-models"></datalist></label>
      <div class="set-backup">
        <button type="button" class="set-btn set-ai-test">Test connection</button>
      </div>
      <div class="set-ai-status"></div>
      <label class="set-check"><input type="checkbox" data-key="lnAiOn" data-off /> <b>Use AI help</b> (off until a test passes)</label>
      <div class="set-ai-note">Your key is kept in this Chrome only: it is never synced to your server, never put in a backup file, and never in a problem report.</div>
    </details>
    <div class="set-label set-backup-label">Problems</div>
    <label class="set-check"><input type="checkbox" data-key="lnSendReports" /> Send usage &amp; error reports with sync (never your notes or key)</label>
    <div class="set-backup set-report-row">
      <button type="button" class="set-btn set-report-copy" title="Copy a report of recent errors and what was used, to paste to whoever helps you">Copy problem report</button>
      <span class="set-report-status"></span>
    </div>
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
          // data-off: off unless switched on; the rest are on unless switched off.
          checks.forEach((c) => { c.checked = "off" in c.dataset ? r[c.dataset.key] === true : r[c.dataset.key] !== false; });
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
      delete all.lnAiKeys;   // keys belong to you and this Chrome only
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
        else if (st.waking) { text = "Waking your server… free ones take about a minute."; tone = "wait"; }
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

    // ── Problem report (background/bg_diag.js) ──
    const reportStatus = root.querySelector(".set-report-status");
    root.querySelector(".set-report-copy").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "DIAG_REPORT" }, async (report) => {
        void chrome.runtime.lastError;
        if (!report || report.error) { reportStatus.textContent = "Couldn't make the report."; return; }
        try {
          await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
          reportStatus.textContent = `Copied (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}). Paste it in the chat.`;
        } catch (_) { reportStatus.textContent = "Couldn't copy: click inside the panel first, then try again."; }
      });
    });

    // ── Old notes: joined lines (background/bg_tidy.js) ──
    const tidyStatus = root.querySelector(".set-tidy-status");
    const showTidy = () => chrome.storage.local.get("lnTidyLog", ({ lnTidyLog: t }) => {
      if (!t) return;
      tidyStatus.textContent = t.undone != null
        ? `Put back ${t.undone} highlight${t.undone === 1 ? "" : "s"} as they were.`
        : `Joined broken lines in ${t.count} old highlight${t.count === 1 ? "" : "s"} (${new Date(t.at).toLocaleDateString()}).`;
    });
    const tidy = (undo) => chrome.runtime.sendMessage({ type: "TIDY_NOTES", undo }, (r) => {
      void chrome.runtime.lastError;
      if (r?.ok && !undo && !r.count) tidyStatus.textContent = "Nothing to tidy: old highlights are already joined.";
      else showTidy();
    });
    root.querySelector(".set-tidy-run").addEventListener("click", () => tidy(false));
    root.querySelector(".set-tidy-undo").addEventListener("click", () => tidy(true));
    chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.lnTidyLog) showTidy(); });
    showTidy();

    // ── AI help (background/bg_ai.js does the talking) ──
    const AIP = globalThis.LazyAIProviders;
    if (AIP) {
      const pick    = root.querySelector(".set-ai-provider");
      const about   = root.querySelector(".set-ai-about");
      const getKey  = root.querySelector(".set-ai-getkey");
      const keyBox  = root.querySelector(".set-ai-key");
      const serverNote = root.querySelector(".set-ai-server");
      const keyRow  = keyBox.closest(".set-field");
      const modelRow = () => modelBox.closest(".set-field");
      const baseRow = root.querySelector(".set-ai-base-row");
      const baseBox = root.querySelector(".set-ai-base");
      const modelBox = root.querySelector(".set-ai-model");
      const models  = root.querySelector("#set-ai-models");
      const aiStatus = root.querySelector(".set-ai-status");
      const aiDot   = root.querySelector(".set-ai-dot");
      const onBox   = root.querySelector('input[data-key="lnAiOn"]');

      AIP.ORDER.forEach((id) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = AIP.PROVIDERS[id].label;
        pick.appendChild(o);
      });

      let aiToldAt = 0;   // a Test result stays put for a few seconds
      const aiSay = (text, tone = "", sticky = false) => {
        aiStatus.textContent = text;
        aiStatus.dataset.tone = tone;
        aiDot.dataset.tone = tone;
        if (sticky) aiToldAt = Date.now();
      };

      function showAi() {
        chrome.storage.local.get(["lnAiProvider", "lnAiModel", "lnAiBase", "lnAiKeys", "lnAiState", "lnAiOn", "lnSyncUrl", "lnSyncKey"], (r) => {
          const id = r.lnAiProvider || AIP.DEFAULT;
          const p = AIP.get(id);
          pick.value = id;
          about.textContent = p.free;
          baseRow.hidden = !p.needsBase;
          // The server route needs nothing typed here: it borrows the sync
          // address and key, and the AI key stays on Render.
          keyRow.hidden = !!p.needsServer;
          modelRow().hidden = !!p.needsServer;
          serverNote.hidden = !p.needsServer;
          if (p.needsServer) {
            const url = (r.lnSyncUrl || "").trim();
            serverNote.textContent = url
              ? `Will ask ${url} — set AI_KEY, AI_PROVIDER and AI_MODEL on Render first.`
              : "Set your server up under Sync below first, then come back.";
          }
          if (document.activeElement !== baseBox) baseBox.value = r.lnAiBase || p.base || "";
          if (document.activeElement !== keyBox) keyBox.value = (r.lnAiKeys || {})[id] || "";
          if (document.activeElement !== modelBox) modelBox.value = (r.lnAiModel || {})[id] || p.defaultModel || "";
          models.innerHTML = "";
          p.models.forEach(([value, label]) => {
            const o = document.createElement("option");
            o.value = value;
            o.label = label;
            models.appendChild(o);
          });
          keyBox.placeholder = `paste your ${p.label} API key`;
          getKey.textContent = "";
          getKey.append(document.createTextNode(p.keyHint + " "));
          if (p.keyUrl) {
            const a = document.createElement("a");
            a.href = p.keyUrl;
            a.target = "_blank";
            a.rel = "noreferrer";
            a.textContent = "Get a key";
            getKey.appendChild(a);
          }
          const st = r.lnAiState || {};
          if (Date.now() - aiToldAt < 6000) return;   // don't talk over the Test result
          if (p.needsServer && !r.lnSyncKey) aiSay("Set your server up under Sync first.", "");
          else if (!p.needsServer && !keyBox.value) aiSay("No key yet.", "");
          else if (st.lastError) aiSay(st.lastError, "bad");
          else if (st.lastOkAt) aiSay(`Working — last answered ${ago(st.lastOkAt)}${r.lnAiOn ? "" : " (still switched off)"}.`, r.lnAiOn ? "ok" : "wait");
          else aiSay("Not tested yet — press Test connection.", "wait");
        });
      }

      const saveAi = async (patch) => chrome.storage.local.set(patch);
      pick.addEventListener("change", async () => {
        await saveAi({ lnAiProvider: pick.value, lnAiBase: AIP.get(pick.value).base || "" });
        showAi();
      });
      keyBox.addEventListener("change", async () => {
        const { lnAiKeys = {} } = await chrome.storage.local.get("lnAiKeys");
        lnAiKeys[pick.value] = keyBox.value.trim();
        await saveAi({ lnAiKeys });
        showAi();
      });
      modelBox.addEventListener("change", async () => {
        const { lnAiModel = {} } = await chrome.storage.local.get("lnAiModel");
        lnAiModel[pick.value] = modelBox.value.trim();
        await saveAi({ lnAiModel });
      });
      baseBox.addEventListener("change", () => saveAi({ lnAiBase: baseBox.value.trim() }));
      root.querySelector(".set-ai-key-show").addEventListener("click", () => {
        keyBox.type = keyBox.type === "password" ? "text" : "password";
      });

      root.querySelector(".set-ai-test").addEventListener("click", () => {
        aiSay("Asking the service…", "wait", true);
        const viaServer = !!AIP.get(pick.value).needsServer;
        chrome.runtime.sendMessage(viaServer ? { type: "AI_TEST", provider: pick.value } : {
          type: "AI_TEST",
          provider: pick.value,
          key: keyBox.value.trim(),
          model: modelBox.value.trim(),
          base: baseBox.value.trim()
        }, (r) => {
          void chrome.runtime.lastError;
          if (r?.ok) {
            aiSay(`Connected: ${AIP.get(r.provider).label}, ${r.model}, answered in ${(r.ms / 1000).toFixed(1)}s.`, "ok", true);
            if (!onBox.checked) { onBox.checked = true; chrome.storage.local.set({ lnAiOn: true }); }
          } else {
            aiSay(r?.reason || "Couldn't reach the service.", "bad", true);
          }
        });
      });

      chrome.storage.onChanged.addListener((c, area) => {
        if (area === "local" && (c.lnAiState || c.lnAiProvider || c.lnAiKeys || c.lnAiOn || c.lnSyncUrl)) showAi();
      });
      showAi();
    }

    const KEYS = ["lnTheme", "lnPopupSide", "lnAutocorrectLevel", "lnDocAutoSelect", "pptxAutoOpen", ...MORE_KEYS];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && KEYS.some((k) => k in changes)) load();
    });
    load();
    return root;
  }

  return { build };
})();
