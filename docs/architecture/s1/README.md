# S1 — Reproducible Database, Security and Prototype Stabilization

Status: **in progress; database/security slice verified locally, not applied to production**

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

## Production rule

See the [coordinated production rollout](production-rollout.md) for the exact cutover and smoke sequence.

Do not run the migration merely because the local replay passes. Before deployment:

1. Repeat the S0 backup/rehearsal.
2. Review the SQL diff and function authentication changes.
3. Run static tests, lint and build.
4. Apply the older baseline migration deliberately with the Supabase CLI’s include-all behavior.
5. Run authenticated two-account smoke tests immediately after deployment.

## Remaining S1 work

- Make non-simulator token allowance decisions fully server-owned.
- Add authenticated function-level regression tests against a non-production Supabase environment.
- Deploy the reviewed hotfix slice and execute the complete current-journey smoke suite.
