# S0 — Programme Controls and Baseline

Status: **complete with an accepted backup-scope limitation**
Baseline commit: `f4313d8c801f2b2d1bbf7ac0ee0c06a362ca497f`
Captured: 2026-09-12

In plain language: S0 freezes a trustworthy picture of Atlas before its internals change. It does not redesign the product.

## Deliverables

- [Current-state inventory](current-state-inventory.md)
- [Baseline smoke tests](baseline-smoke-tests.md)
- [Supported scope](supported-scope.md)
- [Feature-flag registry](feature-flags.json)
- [Risk register](risk-register.md)
- [Backup and restore record](backup-restore-rehearsal.md)
- [Decision log](../decisions/README.md)
- [Machine-readable journey fixtures](../../../evals/datasets/development/current-system/journeys.json)

Run the deterministic repository checks with:

```powershell
npm run test:s0
npm run lint
npm run build
```

## Gate result

| Gate | Result | Meaning |
|---|---|---|
| Current behavior documented | Pass | The critical journeys have named steps and expected outcomes. |
| Deterministic baseline cases | Pass | Fixtures and structural tests are checked into the repository. |
| Repository schema reproducible | Fail | Migrations for foundational tables and the `papers` bucket are missing. S1 must fix this before a clean deployment is possible. |
| Live deployment inventoried | Pass with defects | Link, region, tables, generated types, migrations, functions, secret names, RLS state/policy names and storage settings/policies are captured. Legacy DDL/grants remain non-reproducible. |
| Restorable pre-schema backup | Pass with accepted limitation | The `public` application schema was backed up and restored locally with exact table counts and structural checks. Auth identities and Storage file bodies are excluded by explicit low-risk acceptance. |

S1 may now prepare reviewed, additive migrations with regression tests. Repeat the scripted logical backup immediately before any production schema mutation. The repository remains non-reproducible from migrations alone, so S1 must close that separate gate before claiming clean-environment deployability.

## Verification result

| Check | Result |
|---|---|
| `node --test tests/s0-controls.test.mjs` | Pass — 3/3 |
| Vite production build | Pass — existing bundle-size warning (`~1.15 MB` main chunk) |
| ESLint | Baseline fail — pre-existing `input is not defined` at `EnginePage.jsx:371`, plus 14 warnings |
| `git diff --check` | Pass |

The lint defect is logged for S1. S0 does not change live product behavior merely to make the baseline green.
