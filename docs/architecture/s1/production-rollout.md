# S1 Production Rollout

Status: **complete — deployment, authenticated two-account browser journey, and production-isolated security probe passed**

This is a short coordinated cutover because the new browser code, database functions, and Edge Functions depend on one another. All current accounts are owner-controlled test accounts, but the sequence remains fail-closed.

## Preflight

1. Confirm `main` contains the reviewed S1 commit and the working tree contains only the intentionally untracked `.env.local` change.
2. Run `.\scripts\s0-backup-restore-rehearsal.ps1` to create a fresh backup immediately before deployment.
3. Run `node --test tests/s0-controls.test.mjs tests/s1-security-controls.test.mjs`, lint, and build.
4. Run `supabase db push --linked --include-all --dry-run` and confirm exactly these versions:
   - `202605200000_create_foundational_schema.sql`
   - `202609130001_add_transactional_simulator_quotas.sql`
   - `202609130002_add_session_current_question.sql`
   - `202609130003_add_paper_extraction_state.sql`

For the model-allowance follow-up, repeat the same preflight and confirm the dry run contains only:

- `202609130004_add_model_call_allowances.sql`

## Coordinated deployment

1. Announce a short maintenance window; do not upload, generate, or mark during it.
2. Apply migrations with `supabase db push --linked --include-all`.
3. Deploy `atlas-chat`, `atlas-extract`, and `atlas-variant` with JWT verification enabled.
4. Push the S1 commit to `main` and wait for the Vercel production deployment to become healthy.
5. End the maintenance window only after the smoke checks pass.

## Immediate smoke checks

- Sign in with test User A; confirm Home and Papers load.
- Resume an existing tutor session; confirm its saved layer and transcript load.
- Send one tutor turn; refresh and confirm both messages persist.
- Upload one small backed-up test paper; confirm extraction reaches `completed` once.
- Generate one allowed exam; confirm a second free-tier claim is rejected.
- Start, answer, submit, and mark the exam; confirm a duplicate marking claim is rejected.
- With User B, attempt to access User A’s known session ID and paper path; both must be denied.
- Confirm function logs contain structured codes and no credentials or document bodies.
- Confirm a normal tutor turn, generated variant, and paper extraction each create and settle one server-owned model allowance.
- Confirm an over-limit non-simulator request returns structured code `MODEL_ALLOWANCE_EXHAUSTED` without contacting the model provider.

### Recorded rollout checks — 2026-09-13

- Backup and isolated restore rehearsal: pass (`20260913-155340`).
- Database migration list and remote lint: pass.
- Database security structure and all four transactional functions: present.
- Edge Functions: active with JWT verification; unauthenticated requests return HTTP 401.
- GitHub CI for `1ed4796`: pass.
- Vercel production endpoint: HTTP 200 with a fresh deployment timestamp.
- The signed-in User A/User B journey checks above are still required. Browser control was unavailable during the rollout, so no authenticated result is inferred from the infrastructure checks.
- Model-allowance follow-up backup and restore: pass (`20260913-191718`).
- Follow-up dry run contained only `202609130004_add_model_call_allowances.sql`; migration apply and remote database lint passed.
- JWT-protected deployments are active: `atlas-chat` v11, `atlas-extract` v6 and `atlas-variant` v3; each rejects unauthenticated requests with HTTP 401.
- Authenticated browser journey completed at commit `d0683be` on 2026-09-13:
  - User A Home and Papers loaded, an existing Foundation session restored its durable transcript, and the same transcript survived a full reload.
  - A backed-up MAT1110 tutorial sheet completed extraction and appeared as a paper-scoped resource with two topics and nine extracted sub-topics.
  - An expired local refresh token failed explicitly; after re-authentication, retry reused the existing pending paper record and completed without a duplicate upload.
  - User B signed in as a visibly distinct tenant with its own usage, empty session history, and its own paper library.
  - User B could not see User A's tutorial sheet and direct navigation to User A's known session ID returned the structured ownership denial: `This session does not belong to the current student.`
  - Browser diagnostics contained no application errors or exposed credentials/document bodies; only known React Router v7 future-flag warnings were present.
- Docker and a second Supabase project are unavailable, and this project contains only owner-controlled test accounts and backed-up papers. Direct storage-prefix mutation, cross-tenant CRUD, function-attribution and allowance-exhaustion checks therefore run as a production-isolated probe using only newly created UUID-namespaced fixtures. The harness must refuse an unconfirmed project ref, stop denied paths before Claude, clean up in all outcomes, and verify that no probe rows or objects remain.
- The production-isolated probe passed 11/11 checks on 2026-09-14. It removed its object and two temporary Auth users and verified zero remaining probe rows. Sanitized evidence: [`evidence/20260914T094544Z-production-isolation-probe.json`](evidence/20260914T094544Z-production-isolation-probe.json).

## Forward-fix and recovery

- Prefer an additive forward-fix migration for SQL defects; never edit an applied migration.
- If an Edge Function fails, redeploy the prior function version while leaving the additive columns in place.
- If the browser release fails, roll Vercel back to the prior deployment, then temporarily restore only the compatibility policies required by that version through a reviewed forward-fix migration.
- Use the fresh S0 archive only for disaster recovery, not as the routine rollback mechanism.
