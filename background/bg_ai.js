// Lazy Notes — talking to an AI service.
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
//   AI_RUN   {task, text, extra?}              → { ok, text?, reason? }
//   AI_READY  (no arguments)                   → { ok, on, provider, model, hasKey }
//   AI_SAVE_NOTE {courseName, topicName, text, category} → { ok, id?, reason? }

import '../shared/ai-providers.js';
import { insertHighlight } from './bg_storage.js';
import { validateHighlight } from './bg_validators.js';
import { notifySidePanel } from './bg_sidepanel.js';

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

  // "My Lazy Notes server": the AI key lives on Render, not in Chrome. The
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
    ? "Your server's address isn't set — fill in Settings › Sync first."
    : "No service address — type one in Settings › AI." };
  if (!cfg.key) return { ok: false, reason: viaServer
    ? "Your sync key isn't set — fill in Settings › Sync first."
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
    const data = await res.json().catch(() => ({}));

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
    const reason = err?.name === "AbortError"
      ? "The service took too long (over a minute) and was given up on."
      : "Couldn't reach the service — check the address and your connection.";
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
  const out = await ask(cfg, {
    system: "",
    prompt: "Reply with exactly: ready",
    maxTokens: 16
  });
  return out.ok
    ? { ok: true, ms: out.ms, model: cfg.model, provider: cfg.provider, reply: out.text.slice(0, 40) }
    : out;
}

export async function handleAiRun(message) {
  const job = TASKS[message?.task];
  if (!job) return { ok: false, reason: `There's no AI job called "${message?.task}".` };

  const text = String(message.text || "").trim();
  if (!text) return { ok: false, reason: "Nothing was sent to work on." };
  if (text.length > 60000) return { ok: false, reason: "That's too much text at once. Pick fewer notes." };

  const cfg = await config();
  if (!cfg.on) return { ok: false, reason: "The AI is switched off. Turn it on in Settings › AI." };

  return ask(cfg, {
    system: SYSTEM,
    prompt: job.prompt(text, message.extra),
    maxTokens: job.maxTokens
  });
}

// So a page can grey out its AI buttons without doing a request.
export async function handleAiReady() {
  const cfg = await config();
  return { ok: true, on: cfg.on, provider: cfg.provider, model: cfg.model, hasKey: !!cfg.key };
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
