// Lazy Notes — recent documents and where each one saves its notes.
// Loaded by both readers (pdfreader.html, pptxreader.html).
//
// chrome.storage.local.lnDocs = { [key]: { key, name, kind, page, pages,
//   openedAt, course, topic } }, key = reader page + ?url=/?local= (no #),
// e.g. "/pdfreader.html?url=…". The side panel reads it for "Continue
// reading" and for "Saving to …" while a document is open.
//
// Each document remembers the course › topic that was active while it was
// open. Reopening it switches back to them, unless the user turned off
// "Switch to a document's course & topic" (lnDocAutoSelect === false).

globalThis.LazyDocs = (() => {
  const MAX = 30;
  let key = null;
  let pageTimer = null;

  const keyNow = () => location.pathname + location.search;

  async function update(fn) {
    const { lnDocs = {} } = await chrome.storage.local.get("lnDocs");
    fn(lnDocs);
    const keys = Object.keys(lnDocs).sort((a, b) => (lnDocs[b].openedAt || 0) - (lnDocs[a].openedAt || 0));
    keys.slice(MAX).forEach((k) => delete lnDocs[k]);
    await chrome.storage.local.set({ lnDocs });
  }

  // A document finished loading: { kind: "pdf" | "pptx", name, pages, page }
  async function opened({ kind, name, pages, page }) {
    key = keyNow();
    const { lnDocs = {}, lnDocAutoSelect, activeCourse, activeTopic, lazynotes } =
      await chrome.storage.local.get(["lnDocs", "lnDocAutoSelect", "activeCourse", "activeTopic", "lazynotes"]);
    const prev = lnDocs[key];
    const exists = (c, t) => !!lazynotes?.courses?.[c]?.topics?.[t];

    let course = activeCourse ?? null, topic = activeTopic ?? null;
    if (prev?.course && exists(prev.course, prev.topic) && lnDocAutoSelect !== false) {
      course = prev.course; topic = prev.topic;
      if (course !== activeCourse || topic !== activeTopic) {
        await chrome.storage.local.set({ activeCourse: course, activeTopic: topic });
      }
    } else if (prev?.course && lnDocAutoSelect === false) {
      course = prev.course; topic = prev.topic;   // keep what it had; just not switched
    }

    await update((docs) => {
      docs[key] = { ...prev, key, kind, name, pages, page: page ?? prev?.page ?? 1,
                    openedAt: Date.now(), course, topic };
    });
  }

  function page(n) {
    if (!key) return;
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => update((docs) => { if (docs[key]) docs[key].page = n; }), 800);
  }

  // The course/topic changed while this document is the one being read:
  // that's now where it saves.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !key || document.visibilityState !== "visible") return;
    if (!changes.activeCourse && !changes.activeTopic) return;
    chrome.storage.local.get(["activeCourse", "activeTopic"], ({ activeCourse, activeTopic }) => {
      update((docs) => {
        if (docs[key]) Object.assign(docs[key], { course: activeCourse ?? null, topic: activeTopic ?? null });
      });
    });
  });

  return { opened, page };
})();
