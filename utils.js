// Lazy Notes — Shared sort/filter helpers.
// Used by both sidepanel.js and viewer.js — do not duplicate this logic
// elsewhere.

// highlights: array of { id, text, category, timestamp, ... }
// by: "chronological" | "category" | "date"
function sortHighlights(highlights, by) {
  const list = [...highlights];

  if (by === "chronological") {
    return list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  if (by === "category") {
    return list.sort((a, b) => {
      if (a.category === b.category) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      return a.category.localeCompare(b.category);
    });
  }

  if (by === "date") {
    return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  return list;
}

// topics: array of { name, created, highlightCount, ... }
// by: "chronological" | "name" | "highlights"
function sortTopics(topics, by) {
  const list = [...topics];

  if (by === "chronological") {
    return list.sort((a, b) => new Date(a.created) - new Date(b.created));
  }

  if (by === "name") {
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (by === "highlights") {
    return list.sort((a, b) => (b.highlightCount ?? 0) - (a.highlightCount ?? 0));
  }

  return list;
}

// A typed note's text as blocks: lines starting with ">" are quotes, the
// rest is the note's own words. Consecutive lines of the same kind stay
// together. "a\n> b\n> c\nd" -> [{quote:false,text:"a"}, {quote:true,
// text:"b\nc"}, {quote:false,text:"d"}]. Used to show and export notes.
function typedNoteBlocks(text) {
  const blocks = [];
  String(text ?? "").split("\n").forEach((line) => {
    const quote = /^>/.test(line);
    const content = quote ? line.replace(/^>\s?/, "") : line;
    const last = blocks[blocks.length - 1];
    if (last && last.quote === quote) last.text += "\n" + content;
    else blocks.push({ quote, text: content });
  });
  return blocks
    .map((b) => ({ quote: b.quote, text: b.text.replace(/^(\s*\n)+/, "").replace(/\s+$/, "") }))
    .filter((b) => b.text.trim() !== "");
}
