# _archive/

**Retired code. Do not extend.**

Everything here was load-bearing at some point and is preserved as a written-out reference. Nothing under this directory is imported by the live site or the Node toolchain. The leading underscore is a convention — it sorts last in directory listings and signals "look but don't touch".

## What's in here

### `game304/`

The Python rules engine that powered the (now-removed) Firebase functions and (now-exiled) FastAPI multiplayer backend. Retired on 2026-05-01 in favour of the TypeScript engine at [`../engine/`](../engine/), which is now authoritative.

Why kept: the Python was a clean, well-tested reference implementation. Parity tests during the TS port pulled fixtures from it; if a future caps-engine question arises, this is a readable second opinion. **Do not add features here — fix bugs in `engine/` and let this rot.**

### `tools/`

- `engine_parity_fixtures.py` — one-shot bootstrap that emitted JSON fixtures pinning TS engine behaviour to the Python engine's. Its output (now committed in `engine/__tests__/parity-fixtures/`) is the regression baseline; the script itself has done its job.
- `state_walker.py` — invariant fuzz harness for the retired Python play state machine. Replaced by the curator pipeline in `tools/curator/` for puzzle quality concerns.

### `tests/`

- `test_rule_edges.py` — exhaustive rule-edge tests against the Python engine. The equivalent regressions for the TS engine live in `engine/__tests__/`.
- `test_invariant_fuzz.py` — fuzz tests using `state_walker.py`. Same retirement reason.

## Reviving something

If a chunk in here needs to come back to life:

1. Lift it out of `_archive/` properly (`git mv`) — don't symlink, don't dual-maintain.
2. Update `.claude/directory.md` to reflect the new home.
3. If it's Python, decide explicitly whether it lives in `multiplayer/` (exiled, alongside the backend) or somewhere new.

If a chunk in here is truly dead — no reference value, no parity claim — delete it.
