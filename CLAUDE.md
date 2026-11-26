# Lazy Notes — instructions for Claude

## Git: push to main
The owner's standing instruction: **after testing a change (in Chromium/Playwright), push it to `main`**, and also to the session's working branch. This is explicit, durable permission. No need to ask first, and no pull request unless asked.
- Untested or unfinished work (WIP) goes to the working branch only, never to `main`.
- If `main` has moved on, merge it in (no force-push), re-test, then push.

## Context
Full project context, style rules and history are in `docs/handoff-lazy-notes.md`. Read it before starting work.

## Usage notes
`docs/usage-notes.md` records how the owner really uses the extension (from their notes, screenshots, recordings), the slips seen, whose they were, and what changed because of them. Read it before changing behaviour that looks odd, and **add an entry** whenever the owner shares real notes or reports a slip.
