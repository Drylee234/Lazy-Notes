# Lazy Notes — instructions for Claude

## Git: push to main
The owner's standing instruction: **after testing a change (in Chromium/Playwright), push it to `main`**, and also to the session's working branch. This is explicit, durable permission. No need to ask first, and no pull request unless asked.
- Untested or unfinished work (WIP) goes to the working branch only, never to `main`.
- If `main` has moved on, merge it in (no force-push), re-test, then push.

## Context
Full project context, style rules and history are in `docs/handoff-lazy-notes.md`. Read it before starting work.
