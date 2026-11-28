// QNotes — talking to an AI service.
//
// All of it happens here, in the service worker, for three reasons: the key
// never touches a web page, the extension's host permissions let it reach any
// service, and every page can ask for the same job with one message.
//
// Settings (chrome.storage.local):
//   lnAiOn        false = the AI is off everywhere (default off until a key works)
//   lnAiProvider  "groq" (default) | "gemini" | "anthropic" | "openrouter"
//                 | "server" (your Render server keeps the key) | "custom"
//   lnAiModel     model name, per provider: { providerId: name }
//   lnAiBase      own address, for "custom"
//   lnAiKeys      { providerId: key }   ← never synced, never exported, never reported
//   lnAiState     { lastOkAt, lastError, provider, model }  (for the status line)
//
// Messages:
//   AI_TEST  {provider?, key?, model?, base?}  → { ok, ms, model, reply?, reason? }
//   AI_RUN   {task, text, extra?}              → { ok, text?, reason?, note? }
//            a "…Doc" task may leave text out and send {scope, page} instead:
//            the open document's own words are read from storage.session
//   AI_READY  (no arguments)                   → { ok, on, provider, model, hasKey, offline }
//            offline: true = no AI set up, the offline helpers answer
//            (bg_ai_offline.js; lnAiOffline, default on)
//   AI_SAVE_NOTE {courseName, topicName, text, category} → { ok, id?, reason? }

import '../shared/ai-providers.js';
import { insertHighlight } from './bg_storage.js';
import { validateHighlight } from './bg_validators.js';
import { notifySidePanel } from './bg_sidepanel.js';
import { offlineJob } from './bg_ai_offline.js';
import { getLazyNotes } from './bg_storage.js';

const AI = globalThis.LazyAIProviders;
const TIMEOUT_MS = 60 * 1000;   // free services are slow when they're busy

// ─── the jobs ────────────────────────────────────────────────────────────────
// Each job is a short, strict instruction. They all say "return only the
// result", because a note is pasted straight into the user's notes — a
// "Sure, here you go!" line would end up in their notes too.

const SYSTEM = "You help a student keep study notes. Answer with the result only — no greeting, no explanation of what you did, no markdown code fences. Keep the student's own wording wherever it is already fine. Never invent facts that are not in what you were given.";

const TASKS = {
  // A raw highlight off a PDF → a clean, readable note.
  tidy: {
    maxTokens: 1200,
    prompt: (text) =>
      `Rewrite this highlighted text as one clean study note. Fix broken lines, hyphens split across lines and obvious scanning errors. Do not shorten the meaning, do not add anything, do not explain. Return the note only.\n\n---\n${text}`
  },

  // Notes of a topic → a summary note.
  summarise: {
    maxTokens: 1500,
    prompt: (text) =>
      `Here are a student's notes on one topic. Write a short summary of them: 3 to 6 lines, each a single point, no numbering, no heading. Only use what is in the notes.\n\n---\n${text}`
  },

  // A term → a definition note.
  define: {
    maxTokens: 400,
    prompt: (text, extra) =>
      `Define this term as it is used in ${extra || "a university course"}, in one or two plain sentences a student can revise from. Return the definition only, without repeating the term.\n\n---\n${text}`
  },

  // A highlight the user didn't follow → plain words.
  explain: {
    maxTokens: 800,
    prompt: (text) =>
      `Explain this in plain words a first-year student would follow, in at most 4 short lines. Do not add facts beyond what is here.\n\n---\n${text}`
  },

  // Notes → questions to test yourself with.
  quiz: {
    maxTokens: 1500,
    prompt: (text, extra) =>
      `Write ${extra || 5} short test-yourself questions from these notes, one per line, numbered. Each must be answerable from the notes. No answers.\n\n---\n${text}`
  },

  // Ask your own question about a part of the document. `extra` is the
  // question. The words are the only source it is allowed to use.
  ask: {
    maxTokens: 1200,
    prompt: (text, extra) =>
      `Answer this question about the passage below, for a student revising. Use the passage where it helps and add what you know freely, like a helpful classmate. Keep it under 6 lines.\n\nQuestion: ${extra || "What does this mean?"}\n\n--- passage ---\n${text}`
  },

  // Your own question about the open document (or the page you're on).
  // Same rules as "ask"; the Doc ending makes handleAiRun read the document.
  askDoc: {
    maxTokens: 1500,
    prompt: (text, extra) =>
      `Answer this question about the lecture document below, for a student revising. Use the document where it helps (say which page when the pages are marked) and add what you know freely, like a helpful classmate. Keep it under 10 lines.\n\nQuestion: ${extra || "What is this document about?"}\n\n--- document ---\n${text}`
  },

  // The document itself, not the notes taken from it: the notes are an
  // abridged version, so summarising them would summarise a summary.
  summariseDoc: {
    maxTokens: 2000,
    prompt: (text, extra) =>
      `Summarise this part of a lecture document for a student${extra ? ` (${extra})` : ""}. Give the main points as single lines, no numbering, no heading, at most 10 lines. Use only what is here.\n\n---\n${text}`
  },

  quizDoc: {
    maxTokens: 2000,
    prompt: (text, extra) =>
      `Write ${extra || 5} test-yourself questions a lecturer might ask from this document, one per line, numbered. Each must be answerable from the document. No answers.\n\n---\n${text}`
  },

  // Which course (and topic) does a newly opened document belong to?
  // `extra` is JSON: [{course, topics:[…], documents:[…]}].
  suggestPlace: {
    maxTokens: 40,
    prompt: (text, extra) =>
      `A student just opened a document. Which of their courses does it belong to, and which topic in that course? Use the document's title and the documents already filed in each course. Answer exactly as: Course | Topic — using the names below exactly. If no topic fits, answer: Course | none. If no course fits, answer: none.\n\nCourses:\n${extra}\n\nDocument:\n${text}`
  },

  // Which of our note types does this highlight look like?
  suggestType: {
    maxTokens: 20,
    prompt: (text) =>
      `Which single label fits this text best? Answer with one word from this list and nothing else: header, subtopic, definition, formula, listpoint, important, summary, listhead, plain.\n\n---\n${text}`
  }
};

// ─── settings ────────────────────────────────────────────────────────────────

async function config(override = {}) {
  const s = await chrome.storage.local.get([
    "lnAiProvider", "lnAiModel", "lnAiBase", "lnAiKeys", "lnAiOn", "lnSyncUrl", "lnSyncKey"
  ]);
  const provider = String(override.provider || s.lnAiProvider || AI.DEFAULT);
  const p = AI.get(provider);
  const models = s.lnAiModel || {};

  // "My QNotes server": the AI key lives on Render, not in Chrome. The
  // extension just talks to its own server with the sync key it already has.
  if (p.needsServer) {
    return {
      on: s.lnAiOn === true,
      provider,
      key: String(s.lnSyncKey || "").trim(),
      model: "on your server",
      base: String(s.lnSyncUrl || "").trim().replace(/\/+$/, "")
    };
  }

  return {
    on: s.lnAiOn === true,
    provider,
    key: String(override.key ?? (s.lnAiKeys || {})[provider] ?? "").trim(),
    model: String(override.model || models[provider] || p.defaultModel || "").trim(),
    base: String(override.base || s.lnAiBase || p.base || "").trim()
  };
}

async function setState(patch) {
  const { lnAiState } = await chrome.storage.local.get("lnAiState");
  const state = { ...(lnAiState || {}), ...patch };
  await chrome.storage.local.set({ lnAiState: state });
  return state;
}

// ─── the one call ────────────────────────────────────────────────────────────

async function ask(cfg, { system, prompt, maxTokens }) {
  const viaServer = AI.get(cfg.provider).needsServer;
  if (!cfg.base) return { ok: false, reason: viaServer
    ? "Log in first (Settings › Account & sync): the AI comes with your account."
    : "No service address — type one in Settings › AI." };
  if (!cfg.key) return { ok: false, reason: viaServer
    ? "Log in first (Settings › Account & sync): the AI comes with your account."
    : "No key yet — paste one in Settings › AI." };
  if (!cfg.model) return { ok: false, reason: "No model chosen yet — pick one in Settings › AI." };

  const req = AI.buildRequest(cfg.provider, { ...cfg, system, prompt, maxTokens });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctl.signal
    });
    const rawText = await res.text().catch(() => "");
    let data = {};
    try { data = JSON.parse(rawText || "{}"); } catch (_) { data = { message: rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) }; }

    if (!res.ok) {
      const reason = AI.readError(cfg.provider, res.status, data);
      await setState({ lastError: reason, provider: cfg.provider, model: cfg.model });
      return { ok: false, reason, status: res.status };
    }

    const text = AI.readReply(cfg.provider, data);
    if (!text) {
      const reason = "The service answered with nothing. Try again, or a different model.";
      await setState({ lastError: reason });
      return { ok: false, reason };
    }

    await setState({ lastOkAt: Date.now(), lastError: "", provider: cfg.provider, model: cfg.model });
    return { ok: true, text, ms: Date.now() - started, model: cfg.model };
  } catch (err) {
    // Say which address couldn't be reached and why, as far as the browser tells us.
    let host = "";
    try { host = new URL(req.url).host; } catch (_) {}
    const reason = err?.name === "AbortError"
      ? `${host || "The service"} took too long (over a minute) and was given up on.${viaServer ? " The server may have been asleep (it wakes in about a minute): try again." : ""} [TIMEOUT]`
      : !navigator.onLine
        ? "This computer is offline. [OFFLINE]"
        : `Couldn't reach ${host || "the service"}: ${viaServer ? "check your internet; if it keeps happening, the server may be down" : "check your connection, or a firewall / VPN / ad blocker"}. (${err?.message || err}) [UNREACHABLE]`;
    await setState({ lastError: reason });
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─── what the pages ask for ──────────────────────────────────────────────────

// "Is this key any good?" — the smallest possible real request.
export async function handleAiTest(message) {
  const cfg = await config(message || {});
  // Through our server: first ask it how its AI is set up (no AI call), so a
  // missing / mistyped AI_KEY is named exactly. Old servers (404) skip this.
  if (AI.get(cfg.provider).needsServer && cfg.base && cfg.key) {
    const root = cfg.base.replace(/\/+$/, "").replace(/\/api\/ai$/, "");
    try {
      const res = await fetch(`${root}/api/ai/status`, { headers: { Authorization: `Bearer ${cfg.key}` }, signal: AbortSignal.timeout(90000) });
      const st = await res.json().catch(() => null);
      if (st && st.ok === false) {
        const extra = st.code === "NO_AI_KEY" ? "" : st.has_key ? ` (key: ${st.key_length} characters, looks like ${st.key_looks_like}${st.key_had_spaces ? ", had spaces around it — trimmed" : ""}; service ${st.provider}, model ${st.model || "?"})` : "";
        const reason = `${st.reason}${extra} [${st.code}]`;
        await setState({ lastError: reason, provider: cfg.provider });
        return { ok: false, reason, code: st.code };
      }
    } catch (_) { /* unreachable: the real ask below says why */ }
  }
  const out = await ask(cfg, {
    system: "",
    prompt: "Reply with exactly: ready",
    maxTokens: 64
  });
  return out.ok
    ? { ok: true, ms: out.ms, model: cfg.model, provider: cfg.provider, reply: out.text.slice(0, 40) }
    : out;
}

// The document the readers published (readers/doc-words.js publishes
// chrome.storage.session.lnDocPages). A "…Doc" job can leave `text` out and
// name a scope instead, and we fetch it here — one place, so every caller
// gets the same honest message when a document is too big to hold whole.
async function documentText({ scope = "all", page = 1 } = {}) {
  let store = null;
  try {
    ({ lnDocPages: store } = await chrome.storage.session.get("lnDocPages"));
  } catch (_) { /* no session storage on this browser */ }

  const pages = store?.pages || [];
  if (!pages.length) return { ok: false, reason: "No document is open, so there's nothing to read." };

  // Belt and braces: the store outlives the tab, so check a reader really is
  // open before handing its words over. Reading a document you closed an hour
  // ago and calling it "this document" would be worse than refusing.
  try {
    const open = await chrome.tabs.query({
      url: [
        chrome.runtime.getURL("pdfreader.html") + "*",
        chrome.runtime.getURL("pptxreader.html") + "*",
        chrome.runtime.getURL("docxreader.html") + "*"
      ]
    });
    if (!open.length) {
      await chrome.storage.session.remove("lnDocPages").catch?.(() => {});
      return { ok: false, reason: "No document is open. Open one in the reader first." };
    }
  } catch (_) { /* can't check: carry on rather than block the job */ }

  const total = store.totalPages || pages.length;
  let from = 1, to = pages.length, note = "";

  if (scope === "page") {
    const want = Math.max(1, Number(page) || 1);
    if (want > pages.length) {
      note = `Page ${want} isn't in what we could read, so this is pages 1–${pages.length} instead.`;
    } else {
      from = to = want;
    }
  }
  if (store.trimmed && scope !== "page") {
    note = `This document is too big to send all of it, so this is pages ${from}–${to} of ${total}.`;
  }

  const picked = pages.slice(from - 1, to);
  const text = pages.length > 1
    ? picked.map((t, i) => `[Page ${from + i}]\n${t}`).join("\n\n")
    : picked.join("\n\n");

  return { ok: true, text, title: store.title || "", from, to, total, note };
}

export async function handleAiRun(message) {
  const job = TASKS[message?.task];
  if (!job) return { ok: false, reason: `There's no AI job called "${message?.task}".` };

  // A document job with no text of its own reads what the reader published.
  let note = "";
  let text = String(message.text || "").trim();
  if (!text && /Doc$/.test(message.task)) {
    const doc = await documentText({ scope: message.scope, page: message.page });
    if (!doc.ok) return doc;
    text = doc.text;
    note = doc.note;
  }
  if (!text) return { ok: false, reason: "Nothing was sent to work on." };
  const LIMIT = /Doc$/.test(message.task) ? 240000 : 60000;   // ~40k words for a document
  if (text.length > LIMIT) return { ok: false, reason: /Doc$/.test(message.task)
    ? "That document is too long to send in one go. Use This page, or pick a section."
    : "That's too much text at once. Pick fewer notes." };

  const cfg = await config();
  const offlineOn = await offlineHelpers();
  const aiReady = cfg.on && !!cfg.key;
  // No AI set up, or no internet: the offline helpers answer from your own text.
  if (offlineOn && (!aiReady || !navigator.onLine)) {
    return offline(message.task, text, message.extra, note,
      aiReady ? "You're offline, so this is the offline helper (no AI)." : "Offline helper (no AI set up): picked from your own text.");
  }
  if (!cfg.on) return { ok: false, reason: "The AI is switched off. Turn it on in Settings › AI." };

  const out = await ask(cfg, {
    system: SYSTEM,
    prompt: job.prompt(text, message.extra),
    maxTokens: job.maxTokens
  });
  // The AI couldn't be reached (asleep server, no network): fall back.
  if (!out.ok && offlineOn && /\[(UNREACHABLE|OFFLINE|TIMEOUT|SERVER_WAKING)/.test(out.reason || "")) {
    return offline(message.task, text, message.extra, note, "Couldn't reach the AI, so this is the offline helper (no AI).");
  }
  // Say so when we couldn't send the whole document: a summary of half a
  // lecture that claims to be the whole one would be worse than useless.
  return note && out.ok ? { ...out, note } : out;
}

// ── Chat (the AI view's threads, shared/ai-chat.js) ──────────────────────────
// AI_CHAT { question, scope: "doc"|"page"|"notes", page?, text? (notes),
//           history: [{ role: "user"|"ai", text }], title? }
//   → { ok, text, offline?, note? } | { ok: false, reason }
const CHAT_SYSTEM = "You are a friendly, natural study buddy inside a student's note-taking app. Talk like a helpful classmate who knows the subject well: reply to greetings and small talk normally, keep answers short and clear, and use plain text (short dashed or numbered lists are fine; no markdown headings or tables). Use the student's material when it's relevant, and freely add what you know to explain, give examples or fill gaps. Only point out a difference when your knowledge disagrees with their notes.";

export async function handleAiChat(m) {
  const question = String(m?.question || "").trim();
  if (!question) return { ok: false, reason: "Type a question first." };
  let ctx = String(m.text || "").trim(), note = "";
  if (m.scope === "doc" || m.scope === "page") {
    const doc = await documentText({ scope: m.scope === "page" ? "page" : "all", page: m.page });
    if (!doc.ok) return doc;
    ctx = doc.text;
    note = doc.note;
  }
  if (!ctx) return { ok: false, reason: m.scope === "notes" ? "That topic has no notes yet." : "Nothing to read." };
  if (ctx.length > 240000) return { ok: false, reason: "That document is too long to send in one go. Use Page instead." };

  const cfg = await config();
  const offlineOn = await offlineHelpers();
  const aiReady = cfg.on && !!cfg.key;
  const task = m.scope === "notes" ? "ask" : "askDoc";
  if (offlineOn && (!aiReady || !navigator.onLine)) {
    return offline(task, ctx, question, note, aiReady ? "You're offline, so this is the offline helper (no AI)." : "Offline helper (no AI set up): the sentences that match your words.");
  }
  if (!cfg.on) return { ok: false, reason: "The AI is switched off. Turn it on in Settings › AI." };

  const history = (Array.isArray(m.history) ? m.history : []).slice(-8)
    .map((x) => `${x.role === "user" ? "Student" : "You"}: ${String(x.text || "").slice(0, 2000)}`).join("\n\n");
  const prompt = `For reference, what the student is studying${m.title ? ` (${m.title})` : ""}:\n--- material ---\n${ctx}\n--- end of material ---\n\n` +
    (history ? `The conversation so far:\n${history}\n\n` : "") +
    `Student: ${question}\n\nReply to the student's last message naturally. Their material is there to help when it's relevant; you don't have to stick to it.`;
  const out = await ask(cfg, { system: CHAT_SYSTEM, prompt, maxTokens: 1500 });
  if (!out.ok && offlineOn && /\[(UNREACHABLE|OFFLINE|TIMEOUT|SERVER_WAKING)/.test(out.reason || "")) {
    return offline(task, ctx, question, note, "Couldn't reach the AI, so this is the offline helper (no AI).");
  }
  return note && out.ok ? { ...out, note } : out;
}

async function offlineHelpers() {
  const { lnAiOffline } = await chrome.storage.local.get("lnAiOffline");
  return lnAiOffline !== false;
}

// Define searches the open document and the notes of the course you're in.
async function offline(task, text, extra, note, why) {
  let corpus = "";
  if (task === "define") {
    const doc = await documentText({ scope: "all" }).catch(() => null);
    const { activeCourse } = await chrome.storage.local.get("activeCourse");
    const data = await getLazyNotes();
    const course = data.courses?.[activeCourse] || {};
    const notes = Object.values(course.topics || {}).flatMap((t) => [...Object.values(t.highlights || {}), ...Object.values(t.notes || {})])
      .map((n) => n.text || "").join("\n");
    corpus = `${doc?.ok ? doc.text : ""}\n${notes}`;
  }
  const out = offlineJob(task, text, extra, corpus);
  return out.ok ? { ...out, offline: true, note: [note, why].filter(Boolean).join(" ") } : { ...out, offline: true };
}

// So a page can grey out its AI buttons without doing a request. With the
// offline helpers on, there's always something (on: true, offline: true).
export async function handleAiReady() {
  const cfg = await config();
  const aiReady = cfg.on && !!cfg.key;
  const off = !aiReady && await offlineHelpers();
  return { ok: true, on: cfg.on || off, provider: cfg.provider, model: cfg.model, hasKey: !!cfg.key || off, offline: off };
}

// Keep an AI-written answer as a note of its own (📖 Define). It is marked
// fromAi so you can always tell which notes you didn't write, and it replies
// properly so a button never claims it saved something it didn't.
export async function handleAiSaveNote(message) {
  const payload = {
    id: crypto.randomUUID(),
    text: String(message?.text || "").trim(),
    category: String(message?.category || "definition"),
    course: message?.courseName,
    topic: message?.topicName,
    createdAt: Date.now(),
    fromAi: true
  };
  const check = await validateHighlight(payload);
  if (!check.valid) return { ok: false, reason: check.reason };
  await insertHighlight(payload.id, payload, payload.course, payload.topic);
  notifySidePanel();
  return { ok: true, id: payload.id };
}

export const AI_TASK_NAMES = Object.keys(TASKS);
