---
title: GUI Verification
status: standing instruction
applies_to: any change that touches rendered UI — `site/` (HTML, partials, classic JS/CSS) or the React apps under `apps/304dle/` and `apps/play/`. See [`.claude/directory.md`](directory.md) for the layered layout.
---

# GUI Verification

Tests prove the code runs. They don't prove the UI looks right. Before reporting any UI-touching task as done, **open the affected surface in a browser and look at the thing you changed.** That's the bar. Everything below scales the rigor to the change.

## Scale verification to the change

**Tiny fix** (typo, color tweak, single-property CSS change, copy edit):
- Open the page, confirm the specific thing the user reported is now correct. Done.
- Skip the full mobile+desktop+interaction ritual unless the fix *is* a responsive issue.

**Moderate change** (new component variant, layout shift, behavior tweak on an existing element):
- Open it, confirm the change matches the request.
- Check the one viewport that matters for this change (mobile if it's a phone-played surface; desktop if it's desktop-only chrome). Both only if the change is layout/responsive.
- Interact with it once if it has behavior (click, open, submit).

**New feature or significant UI** (new screen, new modal, new interactive flow):
- Desktop ≥1280px **and** phone ≤390px.
- Exercise the flow end-to-end.
- Glance at adjacent UI for regressions.

## Always

- **Verify against the prompt, not your mental model of it.** "Anchor the dropdown to the pill" means the screenshot shows it anchored to the pill.
- **If you can't open a browser, say so.** Don't claim visual verification when only `tsc`/`vitest` ran. The honest report: *"Tests pass; I couldn't visually verify — please eyeball it before merging."*
- **Tests still run.** `npm run test` / `tsc -b` are orthogonal to visual checks, not replaced by them.

## Report back

One line is enough for small fixes: *"Opened index.html, confirmed the nav pill no longer overflows on mobile width."* Save the full checklist for changes that earned it.
