// QNotes — the How-to-use tour: one slide at a time, numbered markers on
// real screenshots (tour/slides.js says what; tour/positions.js says where).
// Opens by itself each time the extension is reloaded or updated, unless
// switched off (lnTourOnReload; background/background.js opens it).
(() => {
  const SLIDES = globalThis.LN_TOUR_SLIDES || [];
  const POS = globalThis.LN_TOUR_POS || {};
  const $ = (id) => document.getElementById(id);
  const slideEl = $("slide"), dots = $("dots"), prev = $("prev"), next = $("next"), count = $("count");
  let at = Math.max(0, SLIDES.findIndex((s) => s.id === new URLSearchParams(location.search).get("at")));

  SLIDES.forEach((s, i) => {
    const d = document.createElement("button");
    d.type = "button";
    d.title = s.title;
    d.setAttribute("aria-label", s.title);
    d.addEventListener("click", () => go(i));
    dots.appendChild(d);
  });

  function render() {
    const s = SLIDES[at];
    slideEl.replaceChildren();
    const side = document.createElement("div");
    side.className = "tour-side";
    side.innerHTML = `<h1></h1><p class="tour-lead"></p>`;
    side.querySelector("h1").textContent = s.title;
    side.querySelector(".tour-lead").textContent = s.lead || "";
    const spots = s.shot ? (s.spots || []) : [];
    const pos = POS[s.id] || [];

    if (s.shot) {
      const pic = document.createElement("div");
      pic.className = "tour-pic";
      const img = new Image();
      img.src = `tour/${s.shot}.png`;
      img.alt = s.title;
      pic.appendChild(img);
      spots.forEach((sp, i) => {
        const p = pos[i];
        if (!p) return;
        const m = document.createElement("div");
        m.className = "tour-spot";
        m.dataset.i = i;
        Object.assign(m.style, { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` });
        m.innerHTML = `<b>${i + 1}</b>`;
        pic.appendChild(m);
      });
      slideEl.appendChild(pic);
      slideEl.classList.remove("text-only");
    } else slideEl.classList.add("text-only");

    if (spots.length) {
      const ol = document.createElement("ol");
      ol.className = "tour-list";
      spots.forEach((sp, i) => {
        const li = document.createElement("li");
        li.dataset.i = i;
        li.innerHTML = `<b>${i + 1}</b><span>${sp.text}</span>`;
        ol.appendChild(li);
      });
      side.appendChild(ol);
      // Pointing at a line lights its marker (and the other way round).
      const light = (i) => {
        slideEl.querySelector(".tour-pic")?.classList.toggle("focusing", i != null);
        slideEl.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("on", x.dataset.i === String(i)));
      };
      slideEl.addEventListener("mouseover", (e) => { const t = e.target.closest("[data-i]"); light(t ? t.dataset.i : null); });
      slideEl.addEventListener("mouseleave", () => light(null));
    }
    if (s.bullets) {
      const ul = document.createElement("ul");
      ul.className = "tour-bullets";
      ul.innerHTML = s.bullets.map((b) => `<li>${b}</li>`).join("");
      side.appendChild(ul);
    }
    if (s.shortcuts && globalThis.lnHowtoHtml) {
      const k = document.createElement("div");
      k.className = "tour-keys";
      k.innerHTML = lnHowtoHtml();
      side.appendChild(k);
    }
    if (s.tryIt) {
      const a = document.createElement("a");
      a.className = "tour-try";
      a.href = `pdfreader.html?url=${encodeURIComponent(chrome.runtime.getURL("tour/sample-lecture.pdf"))}`;
      a.textContent = "Open the sample lecture PDF";
      side.appendChild(a);
      const p = document.createElement("p");
      p.className = "tour-lead";
      p.style.marginTop = "14px";
      p.innerHTML = "Pick a course and topic when it asks, switch the highlighter on, then select a line and press <b>Enter</b>. Delete the practice topic afterwards in All notes.";
      side.appendChild(p);
    }
    slideEl.appendChild(side);

    [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
    count.textContent = `${at + 1} / ${SLIDES.length}`;
    prev.disabled = at === 0;
    next.textContent = at === SLIDES.length - 1 ? "Done ✓" : "Next →";
    try { sessionStorage.setItem("ln-tour-at", String(at)); } catch (_) {}
  }
  function go(i) { at = Math.max(0, Math.min(SLIDES.length - 1, i)); render(); }
  const close = () => window.close();
  prev.addEventListener("click", () => go(at - 1));
  next.addEventListener("click", () => (at === SLIDES.length - 1 ? close() : go(at + 1)));
  $("close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); go(at + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(at - 1); }
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(SLIDES.length - 1);
    else if (e.key === "Escape") close();
  });

  const again = $("again");
  chrome.storage.local.get("lnTourOnReload", (r) => { again.checked = r?.lnTourOnReload !== false; });
  again.addEventListener("change", () => chrome.storage.local.set({ lnTourOnReload: again.checked }));

  try { const s = Number(sessionStorage.getItem("ln-tour-at")); if (!new URLSearchParams(location.search).get("at") && s > 0) at = Math.min(s, SLIDES.length - 1); } catch (_) {}
  render();
})();
