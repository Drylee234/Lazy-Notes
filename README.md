# Lazy-Notes
to convert raw highlights into notes

## Folders

| Folder | What's in it |
|---|---|
| *(top level)* | `manifest.json` and the extension's pages: `sidepanel.html`, `pdfreader.html`, `pptxreader.html`, `courses.html`, `topics.html`, `display.html`. They stay here so links saved in notes keep working. |
| `background/` | The service worker (`background.js`) and its parts (`bg_*.js`): storage, highlights, courses, menus, messages, PDF/.pptx opening. |
| `content/` | Scripts that run on web pages: the highlighter and save pop-up (`content.js`), the "Highlight this PDF" prompt (`pdf-prompt.js`). |
| `readers/` | The PDF, slides and Word readers, recent-documents tracking (`docs-recent.js`), the Notes panel inside them (`embedded-panel.*`: edge tab, docked, pop-out window), the pop-up note box (`quick-note.*`), zoom for slides/Word (`pinch-zoom.js`) and the open document's words for spell check (`doc-words.js`). |
| `sidepanel/` | The side panel: Home and Study tabs, dropdowns, the formatted note box (`rich-box.js`). |
| `notes/` | All notes pages, note rendering, the highlight editor and export. |
| `shared/` | Used everywhere: colours and Light/Dark (`theme.*`), helpers (`utils.js`), spell check (`spell.js`), the AI services table (`ai-providers.js`). |
| `lib/` | Third-party code: PDF.js, nspell and the English dictionary. |
| `icons/` | Extension icons and logo. |
| `tour/` + `tour.html` | The How-to-use tour (slides, screenshots, marker positions, a sample lecture PDF). Opens after each reload/update. |
| `tools/` | `make-tour-shots.js`: remakes the tour's pictures from the real extension (`node tools/make-tour-shots.js`, needs Playwright). |
| `docs/` | Notes for continuing work (handoff file, usage notes). |
| `server/` | Optional sync server + read-only mobile site (see `server/README.md`). |

## AI help

Lazy Notes can ask an AI service to tidy a highlight, explain it, or write a
definition. It is **off until you set it up**: Settings › AI, paste a
**Groq API key** (free, no card — get one at
<https://console.groq.com/keys>), press Test connection. Other services are
in the list and more will be added, but Groq is the one to start with.

| Service | Free? |
|---|---|
| **Groq** (picked for you) | Free, ~30 requests a minute and ~1,000 a day. Open models. |
| Google Gemini | Free, but now only about 20 requests a day on Flash. |
| Claude (Anthropic) | Not free — a console key, billed per word. A Claude Pro plan does **not** include API access. |
| OpenRouter | Free models (~50 a day); some of their owners may train on what you send. |
| **My Lazy Notes server** | No key in Chrome at all: your Render server keeps it. See `server/README.md`. |
| Other / my own | Anything OpenAI-shaped: Mistral, Cerebras, or Ollama on your own computer. |

**Where the key lives — your choice.** Either in this Chrome (never synced to
your server, never in a backup file, never in a problem report), or not in
Chrome at all: pick **My Lazy Notes server** and put the key on Render as
`AI_KEY`. Either way the talking happens in the service worker
(`background/bg_ai.js`), so a key never touches a web page.

Where the buttons are: **✨ Tidy** in the save pop-up (or Alt+T), and
**✨ Tidy · 💡 Explain · 📖 Define** in the note editor. Nothing saves by
itself — the AI fills a box you can edit, and a second press undoes it.

## Server

`server/` is an optional sync server: the extension sends it a copy of your
notes, and it shows them read-only on your phone. Run it locally with
`LAZYNOTES_KEY=… python server/app.py` (port 8787) or deploy it free on Render
with `render.yaml`. See `server/README.md`.
