# Lazy Notes — instructions for Claude

## Git: push to main
The owner's standing instruction: **after testing a change (in Chromium/Playwright), push it to `main`**, and also to the session's working branch. This is explicit, durable permission. No need to ask first, and no pull request unless asked.
- Untested or unfinished work (WIP) goes to the working branch only, never to `main`.
- If `main` has moved on, merge it in (no force-push), re-test, then push.

## Context
Full project context, style rules and history are in `docs/handoff-lazy-notes.md`. Read it before starting work.

## Roadmap
`docs/roadmap.md`: every change and idea by group (Notes-as-one-note, UX, UI, Reader, All notes, V3 online, Onboarding). Add new ideas there.

## Usage notes
`docs/usage-notes.md` records how the owner really uses the extension (from their notes, screenshots, recordings), the slips seen, whose they were, and what changed because of them. Read it before changing behaviour that looks odd, and **add an entry** whenever the owner shares real notes or reports a slip.

## How the owner phrases decisions ("perhaps …")
The owner starts almost every request with "perhaps". Treat it as "this is my idea, but":
- **If a better way already exists** (an existing feature, shortcut or setting that does it), say so first, briefly, before or alongside building it.
- **If the request would undo something they asked for earlier** (a benefit they gave themselves: a shortcut, a default, a removed annoyance), **alert them** and name what would be lost; prefer a setting/switch over silently reverting (see the "make it togglable" rule in the handoff).

## Show, don't just tell (UX)
For anything UX: when the owner's request is unclear, clarify with images (mockups/screenshots, labelled "Image 1 / Image 2"). Even when it's clear, prefer showing before/after screenshots so they can see what changed.
