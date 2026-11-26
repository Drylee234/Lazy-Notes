// Lazy Notes — the AI services we can talk to, and how.
//
// One table, so adding a new service is one entry here and nothing else.
// Loaded two ways, so it must work as both: a plain <script> on a page (for
// the settings dropdown) and an `import` in the service worker (which does
// the actual talking). It only assigns to globalThis, so both are fine.
//
// Nothing here holds a key. Keys live in chrome.storage.local under
// lnAiKeys = { providerId: key } and never leave the browser except in the
// request to that service — they are never synced to your server, never in
// a backup you share, never in a problem report.

globalThis.LazyAIProviders = (() => {
  "use strict";

  // Three request shapes cover every service worth having:
  //   "openai"    — POST /chat/completions, { messages } → choices[0].message.content
  //   "gemini"    — POST …:generateContent, { contents }  → candidates[0].content.parts
  //   "anthropic" — POST /v1/messages,      { messages } → content[0].text

  const PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      shape: "gemini",
      base: "https://generativelanguage.googleapis.com/v1beta",
      keyUrl: "https://aistudio.google.com/apikey",
      keyHint: "Free key from Google AI Studio — no card needed.",
      free: "Free, but small: about 5 requests a minute and ~20 a day on Flash (Google cut this in late 2025). Fine for a few notes at a time.",
      models: [
        ["gemini-2.5-flash", "2.5 Flash — fast, free tier"],
        ["gemini-2.5-flash-lite", "2.5 Flash-Lite — fastest, roomier limits"],
        ["gemini-2.5-pro", "2.5 Pro — best, tiniest free limit"]
      ],
      defaultModel: "gemini-2.5-flash"
    },

    groq: {
      label: "Groq",
      shape: "openai",
      base: "https://api.groq.com/openai/v1",
      keyUrl: "https://console.groq.com/keys",
      keyHint: "A Groq API key — free from the Groq console, no card needed. This is the one to start with.",
      free: "Picked for you: the most generous free one — roughly 30 requests a minute and 1,000 a day, and very fast. Open models, so not quite Gemini or Claude quality.",
      models: [
        ["openai/gpt-oss-120b", "GPT-OSS 120B — best here"],
        ["openai/gpt-oss-20b", "GPT-OSS 20B — quicker"],
        ["llama-3.3-70b-versatile", "Llama 3.3 70B"]
      ],
      defaultModel: "openai/gpt-oss-120b"
    },

    anthropic: {
      label: "Claude (Anthropic)",
      shape: "anthropic",
      base: "https://api.anthropic.com/v1",
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyHint: "A console key (starts sk-ant-). Your Claude Pro plan does NOT include this — the API is billed separately.",
      free: "Not free: pay per word. Best quality for turning highlights into notes. Haiku is the cheap one if you're watching the bill.",
      models: [
        ["claude-opus-5-5", "Opus 5.5 — best ($4 / $20 per million words-ish)"],
        ["claude-sonnet-5-5", "Sonnet 5.5 — middle ($2 / $10)"],
        ["claude-haiku-5-5", "Haiku 5.5 — cheapest ($0.10 / $0.50)"]
      ],
      defaultModel: "claude-opus-5-5"
    },

    openrouter: {
      label: "OpenRouter",
      shape: "openai",
      base: "https://openrouter.ai/api/v1",
      keyUrl: "https://openrouter.ai/keys",
      keyHint: "One key, many models. Models ending in :free cost nothing.",
      free: "Free models give about 20 requests a minute and 50 a day. Some free models' owners may train on what you send — don't use them for private notes.",
      models: [
        ["deepseek/deepseek-chat-v3.1:free", "DeepSeek V3.1 (free)"],
        ["meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B (free)"],
        ["google/gemini-2.5-flash", "Gemini 2.5 Flash (paid, no daily cap)"]
      ],
      defaultModel: "deepseek/deepseek-chat-v3.1:free"
    },

    server: {
      label: "My Lazy Notes server",
      shape: "relay",
      base: "",                     // uses your sync address
      needsServer: true,
      keyUrl: "",
      keyHint: "No key goes in Chrome at all: your Render server keeps it and does the asking.",
      free: "Uses the sync server you already set up. Put the AI key on Render as AI_KEY (and AI_PROVIDER, AI_MODEL) — see server/README.md. One key for every device, changed on Render without touching the extension.",
      models: [],
      defaultModel: ""
    },

    custom: {
      label: "Other / my own",
      shape: "openai",
      base: "",                       // the user types it
      needsBase: true,
      keyUrl: "",
      keyHint: "Any service that speaks the OpenAI shape: Mistral, Cerebras, Together, DeepSeek, or Ollama / LM Studio on your own computer.",
      free: "Depends on the service. For Ollama on this computer, address http://localhost:11434/v1 and any key.",
      models: [],
      defaultModel: ""
    }
  };

  const ORDER = ["groq", "gemini", "anthropic", "openrouter", "server", "custom"];

  function get(id) {
    return PROVIDERS[id] || PROVIDERS.groq;
  }

  // Build the request: { url, headers, body }. One place, so a fix to a
  // service's quirks is a fix everywhere.
  function buildRequest(id, { base, key, model, system, prompt, maxTokens = 2000 }) {
    const p = get(id);
    const root = String(base || p.base || "").trim().replace(/\/+$/, "");
    const name = String(model || p.defaultModel || "").trim();

    if (p.shape === "gemini") {
      return {
        url: `${root}/models/${encodeURIComponent(name)}:generateContent`,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 }
        }
      };
    }

    // Our own server: it holds the AI key and does the shape conversion.
    // The job itself is still built here, so there is one set of prompts.
    if (p.shape === "relay") {
      return {
        url: `${root}/api/ai`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: { system: system || "", prompt, max_tokens: maxTokens }
      };
    }

    if (p.shape === "anthropic") {
      return {
        url: `${root}/messages`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          // Without this the API refuses a request made from a browser.
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: {
          model: name,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }]
        }
      };
    }

    // OpenAI shape (Groq, OpenRouter, Mistral, Ollama, …)
    return {
      url: `${root}/chat/completions`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: {
        model: name,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt }
        ]
      }
    };
  }

  // Pull the words out of whatever came back.
  function readReply(id, data) {
    const p = get(id);
    if (p.shape === "relay") return String(data?.text || "").trim();
    if (p.shape === "gemini") {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts.map((x) => x?.text || "").join("").trim();
    }
    // Our own server: it holds the AI key and does the shape conversion.
    // The job itself is still built here, so there is one set of prompts.
    if (p.shape === "relay") {
      return {
        url: `${root}/api/ai`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: { system: system || "", prompt, max_tokens: maxTokens }
      };
    }

    if (p.shape === "anthropic") {
      return (data?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("").trim();
    }
    return String(data?.choices?.[0]?.message?.content || "").trim();
  }

  // Turn a service's error into something a student can act on.
  function readError(id, status, data) {
    const raw = String(
      data?.error?.message || data?.error?.type || data?.message || ""
    ).slice(0, 300);
    if (get(id).shape === "relay") {
      if (status === 401 || status === 403) return "Your server refused the sync key — check Settings › Sync.";
      if (status === 503) return raw || "Your server has no AI key yet. Put AI_KEY on Render.";
      if (status === 502) return raw || "Your server couldn't reach the AI service.";
    }
    if (status === 401 || status === 403) return `The key was refused — check you pasted all of it.${raw ? ` (${raw})` : ""}`;
    if (status === 404) return `That model name isn't there. Pick another model.${raw ? ` (${raw})` : ""}`;
    if (status === 429) return "You've used up this service's free allowance for now. Try later, or use another service.";
    if (status === 400 && /credit|balance|quota/i.test(raw)) return `The account has no credit left. (${raw})`;
    if (status >= 500) return "The service is having trouble. Try again in a minute.";
    return raw || `The service said no (${status}).`;
  }

  // ── for pages: ask the service worker to do the job ──
  // (In the service worker itself these are never called; it does the work.)
  const message = (msg, ifDead) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply || ifDead);
      });
    } catch (_) { resolve(ifDead); }
  });

  // { on, hasKey, provider, model } — so a page can hide its AI buttons.
  const ready = () => message({ type: "AI_READY" }, { ok: false, on: false, hasKey: false });

  // { ok, text } | { ok: false, reason }
  const ask = (task, text, extra) =>
    message({ type: "AI_RUN", task, text, extra }, { ok: false, reason: "Lazy Notes didn't answer. Reload the page." });

  return { PROVIDERS, ORDER, DEFAULT: "groq", get, buildRequest, readReply, readError, ready, ask };
})();
