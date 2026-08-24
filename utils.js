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
