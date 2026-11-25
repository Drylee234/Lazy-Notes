// Lazy Notes — "Highlight this PDF" prompt
// Chrome's built-in PDF viewer doesn't let extensions into the PDF itself,
// but content scripts still run in the page that holds it. When that page is
// a PDF, show a small button over the viewer that reopens the PDF in the
// Lazy Notes reader, where selecting text saves notes as on any website.
//
// Shows on every PDF opened in a tab (also local files, if "Allow access to
// file URLs" is on). Clicking it or × removes it until the PDF is opened again.

(() => {
  // Detect by content type, not URL: plenty of PDF links don't end in .pdf
  // (arXiv, many course sites).
  if (document.contentType !== "application/pdf") return;

  const host = document.createElement("div");
  host.id = "lazy-notes-pdf-prompt";
  const root = host.attachShadow({ mode: "open" });

  // Same dark look as the in-page save popup (content.js). The logo is
  // icons/logo.svg inlined: a page can only load extension files listed as
  // web_accessible_resources.
  root.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        top: 68px;     /* just under the viewer's 56px toolbar */
        right: 24px;   /* clear of its scrollbar */
        z-index: 2147483647;
      }

      .toast {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        background: #1e1e24;
        color: #f0f0f0;
        border: 1px solid #33333d;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: enter 180ms ease-out;
      }

      .toast.leaving {
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity 150ms ease-in, transform 150ms ease-in;
      }

      button {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        border-radius: 7px;
        cursor: pointer;
      }

      button:hover { background: #2a2a32; }
      button:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }

      .open {
        gap: 10px;
        padding: 6px 10px 6px 7px;
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        white-space: nowrap;
      }

      .logo {
        display: block;
        flex: none;
        width: 22px;
        height: 22px;
      }

      .close {
        justify-content: center;
        width: 30px;
        height: 30px;
        color: #a0a0b0;
      }

      .close:hover { color: #ffffff; }

      @keyframes enter {
        from { opacity: 0; transform: translateY(-4px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .toast { animation: none; }
        .toast.leaving { transition: none; }
      }
    </style>

    <aside class="toast" aria-label="Lazy Notes">
      <button class="open" type="button"
              title="Open in the Lazy Notes reader, where selecting text saves it as a note">
        <svg class="logo" viewBox="0 0 128 128" aria-hidden="true">
          <rect width="128" height="128" rx="28" fill="#4f46e5"/>
          <rect x="26" y="30" width="76" height="11" rx="5.5" fill="#ffffff" opacity="0.92"/>
          <rect x="20" y="52" width="88" height="25" rx="7" fill="#fde047" transform="rotate(-3 64 64.5)"/>
          <rect x="26" y="59" width="64" height="11" rx="5.5" fill="#312e81"/>
          <rect x="26" y="88" width="46" height="11" rx="5.5" fill="#ffffff" opacity="0.92"/>
        </svg>
        <span>Highlight this PDF</span>
      </button>
      <button class="close" type="button" title="Dismiss" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
      </button>
    </aside>
  `;

  const toast = root.querySelector(".toast");

  function dismiss() {
    toast.classList.add("leaving");
    setTimeout(() => host.remove(), 160);
  }

  root.querySelector(".open").addEventListener("click", () => {
    dismiss();
    // The background swaps this tab over to the reader. location.href, not
    // the sender URL Chrome reports: that one misses a #page=N added after
    // the PDF opened.
    try {
      chrome.runtime.sendMessage({ type: "OPEN_PDF_IN_READER", url: location.href }).catch(() => {});
    } catch (_) {
      // The extension was reloaded or updated after this page opened, so this
      // copy can't reach it any more. Reloading the page brings a fresh one.
    }
  });

  root.querySelector(".close").addEventListener("click", dismiss);
  toast.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismiss();
  });

  (document.body || document.documentElement).appendChild(host);
})();
