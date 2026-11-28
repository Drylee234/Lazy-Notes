// QNotes — offline helpers: what we can do without an AI.
//
// When the AI isn't set up, or can't be reached (no internet, server asleep),
// these stand in for the AI jobs, working only from your own text: the open
// document and your notes. They never invent anything, and every answer says
// it came from the offline helper, not an AI.
//
//   tidy          join lines broken by the PDF ("mitochon- drion")
//   define        find the sentence that defines the term, in the document
//                 or your notes ("Osmosis is …", "…, also known as …")
//   summarise(Doc) the sentences that carry the most of the text's key words
//   quiz(Doc)     questions from definitions ("What is osmosis?") and lists,
//                 else fill-in-the-blank on a key word
//   ask(Doc)      the sentences that best match your question, with their page
//   explain       can't be done without an AI: says so
//
// Settings: lnAiOffline (default on) — Settings › AI help.

const STOP = new Set(("a an the and or but if then than so of to in on at by for from with without into onto over under " +
  "is are was were be been being am do does did done has have had having it its this that these those there here " +
  "as not no nor can could may might must shall should will would which who whom whose what when where why how " +
  "all any both each few more most other some such only own same too very just also about above below between " +
  "through during before after again further once i you he she we they them their our your his her my me us " +
  "one two three use used uses using called known e.g i.e etc").split(" "));

const words = (s) => (String(s).toLowerCase().match(/[a-z][a-z'-]+/g) || []).map((w) => w.replace(/'s$/, ""));
// A rough stem, so "channels" finds "channel" and "gated" finds "gate".
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "").replace(/(e)$/, "");
const keyWords = (s) => words(s).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

export function joinBroken(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const out = [];
  lines.forEach((raw) => {
    if (!raw.trim()) { if (out.length && out[out.length - 1] !== "") out.push(""); return; }
    const l = raw.trim();
    const prev = out[out.length - 1];
    const startsPoint = /^\s*(?:[-*•▪◦·‣]|\(?\d{1,2}[.)]|[a-z][.)])\s+/.test(raw);
    if (prev && !startsPoint && !/[.!?:;]["')\]]?$/.test(prev)) {
      out[out.length - 1] = /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(l) ? prev.slice(0, -1) + l : `${prev} ${l}`;
    } else out.push(l);
  });
  return out.join("\n").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

// Sentences (or lines, for notes and lists), each with the page it's on.
function sentences(text) {
  const out = [];
  let page = null;
  String(text || "").split("\n").forEach((line) => {
    const m = line.match(/^\[Page (\d+)\]$/);
    if (m) { page = Number(m[1]); return; }
    const l = line.trim();
    if (!l) return;
    l.split(/(?<=[.!?])\s+(?=[A-Z(])/).forEach((s) => { if (s.trim().length > 2) out.push({ s: s.trim(), page }); });
  });
  return out;
}

const DEFINES = /\b(is|are|refers? to|means?|is defined as|is called|are called|also known as)\b/i;

function summarise(text, max) {
  const all = sentences(text);
  if (all.length <= max) return all.map((x) => x.s);
  const freq = new Map();
  all.forEach((x) => new Set(keyWords(x.s)).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1)));
  const scored = all.map((x, i) => {
    const k = keyWords(x.s);
    let score = k.reduce((t, w) => t + (freq.get(w) || 0), 0) / Math.sqrt(k.length + 1);
    if (DEFINES.test(x.s)) score *= 1.3;
    if (x.s.length < 25) score *= 0.6;
    return { ...x, i, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.s);
}

function quiz(text, n) {
  const all = sentences(text);
  const qs = [];
  const seen = new Set();
  // "Osmosis is the diffusion of …" → What is osmosis?
  for (const { s } of all) {
    // A short subject (≤ 5 words), and not "are gated" / "is used" (that
    // describes, it doesn't define).
    const m = s.match(/^((?:[\w()'-]+\s+){0,4}[\w()'-]+)\s+(is|are|refers to|means)\s+(?!\w+ed\b)(.{10,})/);
    if (m && /^[A-Z]/.test(m[1]) && !seen.has(m[1].toLowerCase())) {
      seen.add(m[1].toLowerCase());
      const subj = /^[A-Z][a-z]/.test(m[1]) ? m[1][0].toLowerCase() + m[1].slice(1) : m[1];
      qs.push(m[2] === "are" ? `What are ${subj}?` : m[2] === "is" ? `What is ${subj}?` : `What does “${m[1]}” mean?`);
    }
    if (qs.length >= n) return qs;
  }
  // "… through various methods:" followed by points → Name the …
  for (const { s } of all) {
    if (/:$/.test(s) && s.length > 12) qs.push(`${s.replace(/:$/, "")}: name them.`);
    if (qs.length >= n) return qs;
  }
  // Fill in the blank on the sentence's rarest long word.
  const freq = new Map();
  all.forEach((x) => keyWords(x.s).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1)));
  for (const { s } of all) {
    if (s.length < 40 || qs.some((q) => q.includes(s.slice(0, 20)))) continue;
    const cand = (s.match(/\b[a-zA-Z][a-z]{5,}\b/g) || []).filter((w) => !STOP.has(w.toLowerCase()));
    if (!cand.length) continue;
    const pick = cand.sort((a, b) => (freq.get(stem(b.toLowerCase())) || 0) - (freq.get(stem(a.toLowerCase())) || 0))[0];
    qs.push(`Fill in the blank: ${s.replace(new RegExp(`\\b${pick}\\b`), "_____")}`);
    if (qs.length >= n) break;
  }
  return qs;
}

function best(text, query, max) {
  const q = new Set(keyWords(query));
  if (!q.size) return [];
  return sentences(text)
    .map((x, i) => {
      const k = keyWords(x.s);
      const hits = k.filter((w) => q.has(w)).length;
      return { ...x, i, score: hits / Math.sqrt(k.length + 1) + (DEFINES.test(x.s) ? 0.05 : 0), hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// corpus: the text to search for define (the open document + your notes).
export function offlineJob(task, text, extra, corpus = "") {
  const t = String(text || "");
  const n = Math.max(1, Math.min(10, Number(extra) || 5));
  switch (task) {
    case "tidy":
      return { ok: true, text: joinBroken(t) };
    case "summarise":
    case "summariseDoc": {
      const lines = summarise(t, task === "summarise" ? 5 : 8);
      return lines.length ? { ok: true, text: lines.join("\n") } : { ok: false, reason: "There's too little text to summarise." };
    }
    case "quiz":
    case "quizDoc": {
      const qs = quiz(t, n);
      return qs.length ? { ok: true, text: qs.map((q, i) => `${i + 1}. ${q}`).join("\n") } : { ok: false, reason: "Couldn't find anything to ask about in that text." };
    }
    case "ask":
    case "askDoc": {
      const hits = best(t, extra || "", 3);
      if (!hits.length) return { ok: true, text: "Nothing in the text matches those words. (The offline helper only finds sentences; it can't reason like the AI.)" };
      return { ok: true, text: hits.map((h) => (h.page ? `p.${h.page}: ${h.s}` : h.s)).join("\n") };
    }
    case "define": {
      const term = t.trim();
      const tk = keyWords(term);
      if (!tk.length) return { ok: false, reason: "Nothing to define." };
      const found = sentences(corpus).filter((x) => {
        const low = x.s.toLowerCase();
        return low.includes(term.toLowerCase()) && DEFINES.test(x.s);
      });
      const pick = found.sort((a, b) => a.s.toLowerCase().indexOf(term.toLowerCase()) - b.s.toLowerCase().indexOf(term.toLowerCase()))[0];
      return pick ? { ok: true, text: pick.s }
        : { ok: false, reason: `No definition of “${term}” in the open document or your notes. The AI can define it when you're online.` };
    }
    case "explain":
      return { ok: false, reason: "Explaining needs the AI, and it can't be reached right now. Summarise and Quiz me work offline." };
    default:
      return { ok: false, reason: "This needs the AI, and it can't be reached right now." };
  }
}
