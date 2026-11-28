// Q-notes — zoom in the slides and Word readers: trackpad pinch (Chrome
// sends it as Ctrl+wheel), Ctrl/⌘ + / − / 0. Only the pages zoom; the
// toolbar, the Notes panel and pop-ups stay their normal size (Chrome's own
// page zoom would blow those up too). Remembered per reader.
// The pages use it through the --ln-z CSS variable (see pptxreader.css,
// docxreader.css). The PDF reader has its own (it re-renders the pages).

(() => {
  const viewer = document.getElementById("viewer");
  if (!viewer) return;
  const KEY = `ln-zoom-${location.pathname.replace(/\W+/g, "")}`;
  const MIN = 0.5, MAX = 3;
  let z = 1;
  try { z = Number(localStorage.getItem(KEY)) || 1; } catch (_) {}

  const bubble = document.createElement("div");
  bubble.className = "ln-zoom-bubble";
  bubble.hidden = true;
  document.body.appendChild(bubble);
  let bubbleT = null;

  function set(next, at) {
    next = Math.min(MAX, Math.max(MIN, Math.round(next * 100) / 100));
    if (Math.abs(next - 1) < 0.03) next = 1;     // snap to 100%
    if (next === z) return;
    // Keep the spot under the mouse (or the top of the screen) where it is.
    const y = at?.y ?? 0;
    const docY = scrollY + y;
    const ratio = next / z;
    z = next;
    viewer.style.setProperty("--ln-z", String(z));
    scrollTo({ top: docY * ratio - y });
    try { localStorage.setItem(KEY, String(z)); } catch (_) {}
    bubble.textContent = `${Math.round(z * 100)}%`;
    bubble.hidden = false;
    clearTimeout(bubbleT);
    bubbleT = setTimeout(() => { bubble.hidden = true; }, 900);
  }
  viewer.style.setProperty("--ln-z", String(z));

  // Pinch (and Ctrl+mouse wheel).
  addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    set(z * Math.exp(-e.deltaY * 0.01), { y: e.clientY });
  }, { passive: false });

  addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") { e.preventDefault(); set(z * 1.15); }
    else if (e.key === "-") { e.preventDefault(); set(z / 1.15); }
    else if (e.key === "0") { e.preventDefault(); set(1); }
  }, true);
})();
