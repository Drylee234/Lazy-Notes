# Lazy-Notes
to convert raw highlights into notes

## Folders

| Folder | What's in it |
|---|---|
| *(top level)* | `manifest.json` and the extension's pages: `sidepanel.html`, `pdfreader.html`, `pptxreader.html`, `courses.html`, `topics.html`, `display.html`. They stay here so links saved in notes keep working. |
| `background/` | The service worker (`background.js`) and its parts (`bg_*.js`): storage, highlights, courses, menus, messages, PDF/.pptx opening. |
| `content/` | Scripts that run on web pages: the highlighter and save pop-up (`content.js`), the "Highlight this PDF" prompt (`pdf-prompt.js`). |
| `readers/` | The PDF reader, the slides reader (`pptx-parse.js` reads the file) and recent-documents tracking (`docs-recent.js`). |
| `sidepanel/` | The side panel: Home and Study tabs, dropdowns, the formatted note box (`rich-box.js`). |
| `notes/` | All notes pages, note rendering, the highlight editor and export. |
| `shared/` | Used everywhere: colours and Light/Dark (`theme.*`), helpers (`utils.js`), spell check (`spell.js`). |
| `lib/` | Third-party code: PDF.js, nspell and the English dictionary. |
| `icons/` | Extension icons and logo. |
| `docs/` | Notes for continuing work (handoff file). |
| `server/` | An old optional Flask backend; the extension doesn't use it. |
