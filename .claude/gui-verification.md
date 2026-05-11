---
title: GUI Verification Checklist
status: standing instruction
applies_to: any change that touches rendered UI (HTML/CSS/JS in /, /css, /js, /partials, or anything under frontend/src that produces visible output)
---

# GUI Verification

Type checks and unit/smoke tests verify that the code is *correct*. They do not verify that the *feature* is correct. A change can pass `vitest run` and `tsc -b` and still ship the wrong layout, the wrong copy, an unresponsive button, or a desktop-only design that breaks on a phone.

When a task involves visible UI, tests alone are not enough. Visual verification is required before the work is reported as complete.

## What "verify" means here

For every UI-touching change, do **all** of the following:

1. **Run the existing smoke tests first.** `cd frontend && npm run test` for the React surface, plus any relevant `tsc -b`/`eslint` checks. These remain mandatory — visual verification is *additional*, not a replacement.
2. **Bring the change up in a real browser.** Start the dev server (`cd frontend && npm run dev` for the React app, or open the static HTML directly when working on `index.html` / `rules.html` / `caps-formalism.html` / etc.). Do not assume a change "looks right" from the diff.
3. **Screenshot the affected surface.** Capture the visual element you changed and confirm it matches what the user actually asked for. Compare the screenshot against the prompt — not against your own internal model of what the prompt meant. If the prompt said "anchor the dropdown to the pill", the screenshot must show the dropdown anchored to the pill.
4. **Interact with it.** Hover, click, open, close, type, submit — exercise the new behavior end-to-end. A button that renders is not a button that works.
5. **Check both desktop and mobile.** Use the browser's responsive/device toolbar. At minimum: one desktop width (≥1280px) and one phone width (≤390px, e.g. iPhone 13 mini). The 304 surfaces are played on phones — a change that only works at desktop widths is not done.
6. **Check for regressions in adjacent UI.** Visually scan the screens immediately around the change (the same page, the menu the change lives in, the modal it's launched from). Diffs are local; layout breakage is not.

## When the environment won't allow it

If you genuinely cannot bring up the UI (no browser available in this environment, no screenshot tool, sandboxed shell), **say so explicitly**. Do not claim the change is verified when only the type checker has run. The honest report is:

> "Tests pass and types compile, but I was unable to visually verify the change in a browser. Please confirm the layout on desktop and on a phone width before merging."

Silent omission of visual verification is worse than admitting it didn't happen.

## What to report back

After visual verification, the end-of-task summary should mention:
- which widths/devices were checked,
- what was screenshotted,
- whether interaction matched the requested behavior,
- any visual regressions noticed in adjacent areas (even if out of scope to fix).

A passing test suite is necessary but not sufficient. The bar for UI work is: **tests green, browser opened, screenshot taken, interacted with, mobile checked.**
