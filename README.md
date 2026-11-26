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
| `shared/` | Used everywhere: colours and Light/Dark (`theme.*`), helpers (`utils.js`), spell check (`spell.js`). |
| `lib/` | Third-party code: PDF.js, nspell and the English dictionary. |
| `icons/` | Extension icons and logo. |
| `docs/` | Notes for continuing work (handoff file). |
| `server/` | Optional sync server + read-only mobile site (see `server/README.md`). |

## Server

`server/` is an optional sync server: the extension sends it a copy of your
notes, and it shows them read-only on your phone. Run it locally with
`LAZYNOTES_KEY=… python server/app.py` (port 8787) or deploy it free on Render
with `render.yaml`. See `server/README.md`.
