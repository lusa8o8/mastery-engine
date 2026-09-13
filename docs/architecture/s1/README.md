# S1 — Reproducible Database, Security and Prototype Stabilization

Status: **production infrastructure deployed; authenticated journey smoke pass pending**

In plain language: this stage makes today’s Atlas safer and repeatable before its larger architecture changes. It is not the new tutoring design.

## Completed in the first slice

- Added an additive foundation migration for the six legacy tables missing from migration history.
- Added a private `papers` bucket definition with a 20 MB limit and PDF/JPEG/PNG/WebP allow-list.
- Replaced broad Storage access with authenticated-user folder policies.
- Enabled RLS for `messages` and constrained messages/attempts through session ownership.
- Limited token-log mutation while preserving the current prototype’s own-user inserts.
- Required verified JWTs for all three model functions.
- Stopped trusting caller-provided user IDs, paper URLs and media types for service-role work.
- Removed the unused direct-browser Anthropic client/key path.
- Restored tutor transcripts and the saved learning layer on resume, and fixed the undefined message-persistence variable.
- Moved exam-generation and marking quota claims into serialized database functions.
- Required Sonnet exam calls to consume an owned simulation claim once, and removed direct client creation of simulations.
- Persisted the exact active tutor question on each session and constrained the prompt to that source question.
- Added retry-safe paper extraction states and an atomic question-replacement transaction.
- Removed the unnecessary upload-time signed URL and added orphan-file cleanup when metadata insertion fails.
- Added deterministic S1 security controls and CI.
- Added an atomic 30-day model-token reservation boundary for tutoring, variants and paper extraction.
- Moved route selection and output-token caps into the Edge Functions; callers can no longer raise a model output allowance.
- Added expiring claims and provider-usage settlement so concurrent calls cannot race the same allowance and abandoned pre-call reservations recover safely.

## Local database evidence

The full migration history was replayed into an empty PostgreSQL 17.11 database with minimal local stand-ins for Supabase Auth and Storage.

| Check | Result |
|---|---|
| Public tables | Pass — 10 |
| Foreign keys | Pass — 16, including durable session-to-question linkage |
| RLS-enabled public tables | Pass — 10 |
| Public policies | Pass — 18 after removing direct simulation/token-log inserts |
| Storage policies | Pass — 4 |
| `papers` bucket limit | Pass — 20 MB |
| User A reads User B messages/files | Denied — only one own synthetic row visible |
| User A inserts into User B session/folder | Denied — no forbidden rows persisted |
| User A inserts into own session/folder | Pass |
| Rehearsal server | Stopped; data retained outside Git |
| First free-tier generation claim | Pass |
| Second claim inside the same window | Rejected with `SIMULATOR_GENERATION_LIMIT` |
| Direct authenticated simulation insert | Denied |
| First eligible marking claim | Pass |
| Duplicate marking claim | Rejected |
| Extraction completion replay | Pass — second run replaced the first question; one row remained |
| Client token-log insert privilege | Denied |
| Linked Supabase migration dry run | Pass — exactly four S1 migrations, in the intended order |
| Model-allowance migration replay | Pass — additive migration executed in the isolated PostgreSQL rehearsal |
| 30-day allowance boundary | Pass — first reservation accepted, over-limit reservation denied, settled usage released unused capacity |

## Production rule

See the [coordinated production rollout](production-rollout.md) for the exact cutover and smoke sequence.

Do not run the migration merely because the local replay passes. Before deployment:

1. Repeat the S0 backup/rehearsal.
2. Review the SQL diff and function authentication changes.
3. Run static tests, lint and build.
4. Apply the older baseline migration deliberately with the Supabase CLI’s include-all behavior.
5. Run authenticated two-account smoke tests immediately after deployment.

## Production deployment evidence — 2026-09-13

- Fresh pre-deployment backup and isolated restore rehearsal: pass (`20260913-155340`).
- Four reviewed migrations applied to project `jipewywqflgandjcqbjl` in the documented order.
- Remote database lint: pass, with no schema errors.
- Production structure: 10 public tables, 16 foreign keys, 10 RLS-enabled public tables, 18 public policies and 4 Storage policies.
- Durable session-question linkage and all four paper extraction-state columns: present.
- Transactional functions `claim_exam_generation`, `claim_exam_marking`, `claim_paper_extraction` and `complete_paper_extraction`: present.
- `atlas-chat` v10, `atlas-extract` v5 and `atlas-variant` v2: active with JWT verification enabled.
- Unauthenticated calls to all three functions: denied with HTTP 401.
- Frontend commit `1ed4796` pushed to `main`; GitHub CI passed and the Vercel production domain returned HTTP 200 from a fresh deployment.
- Authenticated two-account journey checks remain open because the browser-control connection was unavailable during rollout. Infrastructure checks must not be treated as a substitute for those product checks.
- Model-allowance follow-up backup and isolated restore rehearsal: pass (`20260913-191718`).
- Additive migration `202609130004_add_model_call_allowances.sql` applied; remote database lint reports no schema errors.
- `atlas-chat` v11, `atlas-extract` v6 and `atlas-variant` v3 are active with JWT verification; unauthenticated requests to each return HTTP 401.

## Remaining S1 work

- Add authenticated function-level regression tests against a non-production Supabase environment.
- Execute and record the authenticated two-account current-journey smoke suite.
