# Atlas Implementation Roadmap

## 1. Programme Objective

Replace the current browser-orchestrated prototype with a server-owned, resource-grounded learning system that is reproducible, observable, testable, and safe to evolve.

This is not one refactor. It is a sequence of independently releasable system changes governed by contracts and evaluation gates.

The governing rule is:

> Models interpret, teach, assess, or generate. Deterministic code authenticates, authorizes, routes, validates, persists, retries, budgets, and decides whether state may advance.

### Current programme status — 14 September 2026

| Segment | Status | Plain-language meaning |
|---|---|---|
| Pre-S0 | Complete | The target architecture, boundaries, budgets, and delivery rules are documented and the machine-readable manifest validates. |
| S0 | Complete | The original application, risks, deployment, data, and recovery position have been captured and rehearsed. |
| S1 production stabilization | Complete | Rebuildable schema, tenant policies, verified server identity, server-owned quotas/model allowances, durable tutor resume, retry-safe extraction, Google OAuth, CI, and production rollout are in place. |
| S1 authenticated browser gate | Complete | Two distinct test tenants passed the current-journey checks: User A resume/extraction worked and User B could neither see User A's paper nor open User A's session. |
| S1 production-isolated security probe | Complete | Eleven authenticated, anonymous, database, Storage, function, and allowance checks passed against UUID-namespaced fixtures in the current test-only project; both temporary users, the object, and all probe rows were removed and verified absent. |
| S2A common contracts | Complete - frozen v1.0.0 | Extraction, interactive tutoring and exam/remediation scenarios passed the common-envelope review. Ownership, lifecycle, deletion, tenant, OAuth, retry and trace rules are fixed for v1. |
| S4A extraction baseline | In progress | Dataset governance, split checks, planned synthetic cases, and a private PDF candidate registry exist. Reviewed ground truth and an isolated executable held-out set are still required. |
| S3 platform build | In progress; API shell complete, live integration gated | The locked-by-default FastAPI shell now has request IDs, typed errors, health/readiness and injected fixture authentication. JWT, Postgres, jobs, outbox, model gateway and observability remain gated work. |

Recent implementation evidence is maintained in [`s1/README.md`](s1/README.md) and [`s1/production-rollout.md`](s1/production-rollout.md). The successful legacy extraction smoke run establishes current behavior only; it is not evidence that the future OCR/layout pipeline meets S6 quality gates.

## 2. Delivery Principles

1. Preserve the working mobile experience while replacing its internals behind feature flags.
2. Stabilize contracts before parallel implementation begins.
3. Every durable workflow is an explicit state machine.
4. Every retryable write is idempotent.
5. Model output is untrusted until schema and domain validation pass.
6. Models never receive unrestricted database write capabilities.
7. Store original evidence, normalized records, model/version metadata, and validation outcomes separately.
8. Build evaluation datasets before optimizing prompts.
9. Use shadow mode before a new workflow can update learner or library state.
10. Prefer one modular service and one worker deployment before introducing microservices, Redis, event streaming, RAG, or multiple agents.
11. Keep orchestration provider-independent and model adapters thin; use `C:\Users\Lusa\python-agents` as a read-only implementation reference, never as a runtime dependency or an edited library.
12. Distinguish permission to begin fixture-backed implementation from permission to integrate live dependencies and permission to release.

## Pre-S0 — Executable Design Gate

Before S0 begins, the design package must be usable as an implementation control rather than only an architectural narrative.

### Required outcomes

- The domain contracts are divided into independently frozen packs so unrelated future work cannot block the first vertical slice.
- Every dependency is labelled as a **build**, **live-integration**, or **release** dependency.
- Evaluation case capture begins with the current-system baseline, before prompts or model routes change.
- Every workflow declares its sequential steps, safe parallel branches, aggregation rule, failure policy, retry/repair limit, and route-specific budget.
- The Python-agents workflow patterns are adopted as a reference standard while that repository remains read-only and outside Atlas runtime imports.
- `agent-manifest.json` validates and the regenerated `agent-design.html` is reviewed before implementation starts.

### Exit gate

- A work owner can tell exactly what may start, what may connect to live state, and what may ship without interpreting an ambiguous arrow.
- The first required contract packs are identified, while later assessment and network contracts remain non-blocking.
- The design artifacts agree on architecture, budgets, failure semantics, evaluation timing, and rollout order.

## 3. Target Runtime Shape

```text
React web application
        |
        | HTTPS + Supabase JWT
        v
Python API (FastAPI/Pydantic)
        |
        +--> synchronous read/interactive workflows
        |
        +--> Postgres workflow_jobs + outbox_events
                         |
                         v
                 Python worker process
                         |
              +----------+----------+
              |                     |
              v                     v
       deterministic stages     model provider
              |                     |
              +----------+----------+
                         v
            Supabase Postgres + Storage
```

Initial deployment recommendation:

- Supabase: authentication, Postgres, row-level policies, object storage.
- Railway or equivalent: one Python API process and one worker process from the same codebase.
- Postgres-backed jobs/outbox initially; add a separate queue only after measured throughput or latency requires it.
- Vercel: React frontend until a concrete reason to move it appears.

### Authentication decision — Google through Supabase Auth

Supabase Auth remains Atlas's sole user-identity issuer. Google is enabled through Supabase and the frozen S2A principal contract treats it as audit metadata while retaining email/password as a fallback. Do not introduce Firebase Auth merely to obtain Google sign-in: Atlas already derives database, Storage, Edge Function, and future Python API authorization from Supabase JWTs and `auth.uid()`, so a second identity issuer would add token bridging, custom-claim, account-mapping, migration, and RLS paths without improving the student-facing flow.

Implementation and configuration requirements:

- Use the existing Supabase client and `signInWithOAuth({ provider: 'google' })`; the resulting application session remains a Supabase session regardless of whether the student used Google or a password.
- Configure one Google web OAuth client, the Supabase project callback URL, and exact allowlisted local, preview, and production return URLs. Never place the Google client secret in Vite or other browser-visible environment variables.
- Request only `openid`, email, and profile scopes. Atlas does not need Google Drive, Contacts, offline access, or stored Google provider tokens for authentication.
- Preserve a validated relative return path so sign-in can resume the intended Atlas route; reject external/open redirects and fall back to the authenticated landing surface.
- Rely on verified-email automatic identity linking only after collision tests confirm that an existing password account and the same Google email retain one Supabase user ID and all existing resources, sessions, entitlements, and history. Ambiguous or different-email linking requires an authenticated, explicit account-linking flow and is deferred from the first release.
- Put the button and provider enablement behind an authentication feature flag or equivalent kill switch. A Google outage or OAuth error leaves password sign-in available and produces an actionable error without creating a partial application profile.
- Firebase Auth remains deferred. Reconsider it only if a documented future platform requirement cannot be met by Supabase Auth and after a separate identity migration, RLS, Storage, token-validation, account-linking, rollback, and tenant-isolation review.

## 4. Dependency Model

Dependencies have three meanings and must not be collapsed into one project arrow:

| Dependency | Meaning | Default evidence |
|---|---|---|
| Build | Work may begin against frozen contracts and fixtures. | Contract tests and checked fixtures |
| Live integration | The implementation may read or write a live upstream workflow. | Upstream exit gate and integration tests |
| Release | The capability may be enabled for a cohort. | Held-out evals, operational gates, rollback and kill switch |

```text
Pre-S0 executable design gate
 |
 v
S0 Programme controls and baseline
 |
 v
S1 Reproducible database, security and current-system stabilization
 |
 v
S2A common platform contracts
 |
 +--> S2B resource/evidence --> S6 ingestion --> S7 review/taxonomy --> S8 patterns --> S10 exam --> S11
 +--> S2C learning ---------------------------------------------------------------> S9 learning -----> S11
 +--> S2D assessment ---------------------------------------------------------> S10/S11 contracts
 +--> S2E network ------------------------------------------------------------> S12 preparation

S3 platform, S4 evaluation, S5 frontend, migration and rollout run as cross-cutting lanes
after their required contract packs freeze. S13 cutover runs per accepted vertical slice;
it does not wait for S12.
```

The diagram shows product-data ordering. The tables in the delivery waves are authoritative for build, live-integration, and release permission. Several segments can build against frozen fixtures before upstream live integration is available.

Current transition rule: S1 is accepted and S2A is frozen at v1.0.0. S3 fixture-backed platform construction and S4A baseline capture may proceed in parallel. S3 live integration still waits for its authorization, recovery, idempotency, timeout and observability gates; a frozen contract does not pre-approve a new runtime.

### Dependency ledger

| Segment | Build may begin when | Live integration may begin when | Release requires |
|---|---|---|---|
| S3 Platform | S2A frozen | S1 authentication/database gate accepted | S3 crash, authorization, idempotency, timeout and observability gates |
| S4A Baseline | S0 begins | Current journeys are observable | Not user-facing; reviewed dataset governance |
| S4B Harness | S2A plus the measured domain pack | Versioned workflow traces exist | Not user-facing; calibrated graders and reproducible reports |
| S5 Frontend | Required S2 fixtures frozen | Corresponding S3 command accepted | Journey, accessibility and visual parity plus feature flag/rollback |
| S6 Ingestion | S2A/S2B fixtures frozen | S3 jobs/model gateway and storage boundary accepted | S4 extraction gates, review routing, idempotency and source accounting |
| S7 Review/taxonomy | S2B fixtures frozen | S6 draft artifacts accepted | Review audit, normalization evals and downstream invalidation tests |
| S8 Patterns | S2B/S2D normalized fixtures frozen | S7 canonical records accepted | Golden deterministic fixtures, authorization and snapshot provenance |
| S9 Learning | S2B/S2C and tutor eval contracts frozen | S3 persistence plus S6/S7 accepted evidence | Tutor/mastery held-out gates, evidence linkage, resume and mobile parity |
| S10 Exam | S2D and S8 blueprint contract frozen | Accepted S8 snapshot available | Solution/mark-scheme verification, leakage checks and educator evals |
| S11 Marking/remediation | S2C/S2D schemas frozen | Accepted S10 exam and S9 objective contract available | Marking agreement, abstention, totals and evidence-linked handoff gates |
| S12 Contribution | S2E contracts and contribution fixtures frozen | S3/S4 runtime plus S6/S7 quality gates and reviewed policy accepted | Consent, privacy, rights, entitlement, takedown and manual-review gates; S8/S9 only for their integrations |
| S13 Cutover | S2A migration envelope frozen | The individual workflow passes its integration gate | That workflow's held-out/SLO gates, rollback drill, kill switch and approved cohort |

## 5. Work Segments

## S0 — Programme Controls and Baseline

Repository baseline package: [`docs/architecture/s0/README.md`](s0/README.md). Live infrastructure and backup gates remain fail-closed until the confirmed Supabase project is linked and the isolated restore rehearsal passes.

### Purpose

Create a safe delivery envelope and establish what the current system actually does before changing it.

### Work

- Record current routes, database tables, RLS policies, storage buckets, Edge Function secrets, deployed function versions, and production environment variables.
- Capture representative current user journeys: upload, extract, choose all/single paper, start/resume session, change layer, generate exam, submit, mark, and return to practice.
- Create a risk register and a decision log under `docs/architecture/decisions/`.
- Establish feature flags for new API, extraction, tutor, simulator, and contribution workflows.
- Define supported document types, maximum sizes/pages, supported mathematical domains, and explicit non-goals for the first release.
- Take a restorable database backup before schema work.

### Deliverables

- Current-state inventory.
- Baseline smoke-test checklist and captured fixtures.
- Feature-flag registry.
- Risk/decision logs.
- Backup and restore rehearsal record.

### Exit gate

- Production resources can be reproduced or their external dependency is explicitly documented.
- The current critical journeys have deterministic smoke cases.
- Every planned migration has a rollback or forward-fix strategy.

### Parallelism

Safe to run documentation, fixture capture, and environment inventory in parallel. Do not begin schema mutation until the inventory and backup gate pass.

## S1 — Reproducible Database, Security and Prototype Stabilization

Implementation evidence: [`docs/architecture/s1/README.md`](s1/README.md).

### Purpose

Remove immediate hazards and make the current system reproducible before introducing the replacement.

### Work

- Add migrations for all existing foundational tables, indexes, triggers, buckets, and RLS policies.
- Derive user identity from verified JWTs at every server boundary; stop trusting caller-provided `userId`.
- Remove the browser Anthropic API path and client API key variable.
- Fix message persistence, current-question linkage, layer/session resume, and missing error propagation.
- Move quota checks behind a trusted server transaction or database function.
- Add minimum lint/build/unit checks to CI.
- Add structured error codes instead of parsing arbitrary error strings.

### Deliverables

- Rebuildable Supabase schema.
- Security regression tests.
- Current-app hotfix release with no architecture redesign.
- CI checks for lint, build, migrations, and basic tests.

### Exit gate

- Zero known service-role writes based on an unverified client user ID.
- A clean environment can recreate the schema and storage policies.
- Current journeys pass smoke tests after the hotfixes.
- No Anthropic secret can be bundled into the browser.

### Parallelism

Security work and schema capture can proceed in parallel if they touch separate migrations/functions. Bug fixes can proceed separately, but all merge only after one integrated current-app smoke run.

## S2 — Incremental Domain Model and Versioned Contract Packs

### Purpose

Freeze shared language in dependency-sized packs. Contract-first remains the main sequential gate, but unrelated future domains must not become one programme-wide bottleneck.

### S2A — Common platform contracts

Freeze checkpoint (14 September 2026): `contracts/s2a/` is frozen at v1.0.0
after exercising paper extraction, interactive tutor/resume and exam/remediation
scenarios. Pydantic is the server source of truth; generated JSON Schema,
OpenAPI and TypeScript artifacts plus shared fixtures pass in Python and
JavaScript. [`contracts/s2a/freeze-review.md`](../../contracts/s2a/freeze-review.md)
records the findings, writer boundaries, lifecycle/deletion decisions and gate
evidence. S3 may build against these contracts, but this does not authorize
live integration.

- Authenticated principal, tenant scope, commands, typed errors, idempotency, workflow jobs/steps, model calls, outbox events, and audit events.
- Principal identity is the stable Supabase user ID. Authentication method (`password`, `google`, or a later provider) is audit metadata, never a tenant key, ownership key, role, or authorization decision.
- Auth callback and return-path contracts allow only configured Atlas origins and validated relative application paths.

### S2B — Resource and evidence contracts

- `resources`, `resource_pages`, `resource_regions`.
- `resource_scope_snapshots`, `resource_scope_members`.
- `extraction_runs`, `extraction_artifacts`, `extraction_findings`.
- `questions`, `question_parts`, `question_evidence`.
- `institutions`, `courses`, `course_offerings`, `concepts`, `concept_aliases`, `question_concepts`.

### S2C — Learning contracts

- `study_spaces`, `learning_plans`, `learning_objectives`, `conversation_threads`, `conversation_episodes`.
- `learner_states`, `learning_sessions`, `tutor_turns`, `attempts`.
- Learning-objective origin fields that can reference a remediation assignment without making display labels or URL segments authoritative.
- `study_spaces` support a deterministic `exam_remediation` goal type, an optional student-edited display name, and a stable originating exam-attempt reference. One active exam-review study space exists per user and exam attempt.
- `learning_sessions` are resumable executions inside a study space; `conversation_episodes` may roll over for context control without changing the study space, objective, or remediation identity.

### S2D — Assessment contracts

- `pattern_snapshots`, `pattern_evidence`.
- `exam_blueprints`, `exams`, `exam_questions`, `solutions`, `marking_schemes`, `exam_attempts`, `marking_results`.
- `remediation_assignments`, with stable links to the originating exam, exam question, marking result, canonical competency, target learning objective, status, and completion criteria.
- Remediation status is versioned and allowlisted: `suggested`, `active`, `paused`, `completed`, `review_required`, or `superseded`. Re-marking may supersede an earlier suggestion but never silently rewrites its evidence history.

### S2E — Contribution and library contracts

- `contribution_submissions`, `contribution_reviews`, `library_resources`, `library_entitlements`, `contributor_rewards`, `takedown_cases`.

### Contract rules

- UUIDs are opaque and tenant-scoped.
- Every mutable record has `created_at`, `updated_at`, and an optimistic version or immutable event history.
- Model-affected records carry schema, prompt, model, and workflow versions.
- Evidence records carry resource, page, region/bounding box, text span, and confidence.
- Detected institution metadata, confirmed resource metadata, and optional student affiliation are separate fields.
- Private ownership, shared-library eligibility, and library access are separate concepts.
- Display labels never act as canonical identifiers.
- Slash-command names map to versioned application commands; mention labels map to stable typed IDs and never carry authorization.
- Study-space identity is separate from its current topic, learning layer, and conversation thread.
- Resource-set scopes are immutable snapshots; refresh creates a new version rather than silently changing active coverage.
- Exam remediation preserves its full origin chain across navigation and resume; route text and fuzzy topic-name matching are never the source of truth.
- System display names are derived from stored exam, question, and concept metadata. A student rename changes only the display label, never identity, authorization, routing, or idempotency.

### API contracts

- Generate OpenAPI and JSON Schema from Pydantic models.
- Generate or validate TypeScript client types from those contracts.
- Version event and model-output schemas independently.
- Create fixture packages for every contract so downstream lanes can work before live upstreams exist.

### Exit gate

- Architecture review approves entity ownership, lifecycle, tenant scope, and deletion behavior for the pack being frozen.
- JSON Schema contract tests pass in Python and JavaScript.
- No unresolved question remains about which service is allowed to update each state.
- Fixtures cover normal, empty, partial, invalid, and legacy records.
- Every pack declares the earlier packs it imports; circular pack dependencies are rejected.
- Password and Google sign-in resolve to the same principal contract, and a verified same-email link preserves the existing Supabase user ID and all tenant-owned records.
- Auth callbacks reject unlisted origins and unsafe return paths; provider secrets and provider access tokens never enter browser bundles, application logs, or Atlas model context.

### Parallelism

Entity modelling can be divided by pack, but one contract owner integrates naming, identifiers, lifecycle, and cross-domain invariants. A consumer may begin when all packs it imports are frozen; it does not wait for unrelated later packs. Contract changes are additive and versioned after consumers begin.

## S3 — Backend Platform and Boring Workflow Runtime

Implementation checkpoint (14 September 2026): `backend/atlas_api/` provides a
fixture-tested FastAPI shell and deterministic job-runtime semantics against the
frozen S2A contracts. The shell starts locked, separates liveness from readiness,
rejects protected access without injected authentication, emits typed
content-safe errors, and forbids fixture authentication in production. The job
runtime proves tenant-scoped idempotency, explicit transitions, leases, bounded
attempts, stale-worker rejection, cancellation and retry scheduling. The same
semantics now have a Postgres repository and leased transactional outbox; the
additive schema is applied to the linked Supabase project and its self-cleaning
live probe passes. PostgreSQL owns durable time calculations so worker clock
skew cannot invalidate retry schedules. This is still a build milestone: no
worker loop, publisher process, JWT verifier or model connection is enabled.
Sanitized live evidence is recorded in
[`s3/evidence/20260914T132454Z-postgres-runtime-probe.json`](s3/evidence/20260914T132454Z-postgres-runtime-probe.json).

### Purpose

Build the trusted execution boundary shared by every intelligent feature.

### Work

- FastAPI application with JWT verification, request IDs, typed errors, health/readiness endpoints, and OpenAPI.
- Service/repository boundary that always receives an authenticated principal rather than a free-form user ID.
- Verify the same allowlisted Supabase JWT issuer, audience, signature, expiry, and principal contract for both password and Google-authenticated sessions; provider claims do not create a separate authorization path.
- Postgres-backed durable job runner using row locks (`FOR UPDATE SKIP LOCKED`) and leases.
- Transactional outbox written in the same transaction as state changes.
- Idempotency keys on public commands and unique step keys on workflow stages.
- Model gateway with allowlisted route configs, input/output limits, structured output, timeouts, retry classification, cost budgets, and trace metadata.
- Feature flags and version registry stored outside prompts.
- Structured logs, metrics, traces, and audit events with secret/content redaction.

### Canonical job execution

```text
API command
   |
   v
authorize + validate idempotency key
   |
   v
DB transaction: create domain record + job + outbox event
   |
   v
worker claims leased job
   |
   v
inspect current state and step key
   |
   +--> already completed: return recorded result
   |
   v
execute bounded step
   |
   v
validate postcondition
   |
   v
transaction: store result + advance state + enqueue next event
```

### Retry policy

- Retry only transient network, provider-rate, and lease-expiry failures.
- Exponential backoff with jitter and a finite attempt count.
- Validation failure receives at most one bounded repair step.
- Unknown errors move to `failed`; ambiguous content moves to `review_required`.
- Cancellation prevents new steps but does not erase audit history.
- A watchdog reclaims expired leases; step idempotency prevents duplicate effects.

### Exit gate

- Crash/restart tests demonstrate safe recovery at every step boundary.
- Duplicate commands and repeated worker delivery produce one logical result.
- Authorization, timeout, retry, cancellation, and cost-limit tests pass.
- Password and Google-created Supabase sessions pass the same JWT and tenant-isolation suite; authentication provider metadata cannot change authorization.
- No model output can directly mutate domain tables.

### Parallelism

API shell, job runner, model gateway, and observability can be owned separately after S2A freezes. Integrate them through contract tests before feature workflows use them.

## S4 — Evaluation Harness and Dataset Governance

### Purpose

Make quality measurable before prompt and model choices harden. Dataset governance and baseline capture begin during S0; reusable runner implementation follows the contracts it measures.

### S4A — Baseline and evaluation contract

Implementation checkpoint (14 September 2026): the extraction dataset schema,
development scaffold, deliberately empty held-out manifest, and deterministic
split validator are present under `evals/datasets/extraction/`. Two local
tutorial PDFs have been registered as private candidates by hash and page count
only. They remain git-ignored and have not been copied, extracted, uploaded, or
assigned to a split. The release form of the validator intentionally fails until
reviewed executable development and independently protected held-out cases exist.

- Begin during S0 while the current application is still observable.
- Assign immutable case IDs and record journey, source, consent/license status, redaction, expected behavior, critical-failure labels, and intended split.
- Freeze grader inputs/outputs with the relevant S2 contract pack.
- Isolate held-out cases from prompt and model authors from the moment they are designated.

### S4B — Harness and release automation

### Work

- Versioned development and held-out datasets with immutable case IDs.
- Dataset manifests recording source, consent/license status, redaction, split, intended graders, and leakage restrictions.
- Deterministic, model, and human grader interfaces.
- JSON result format with workflow version, model, prompt, latency, tokens, cost, retries, and grader evidence.
- Self-contained HTML reports and baseline comparison.
- Evaluation runner that supports controlled concurrency, seeds/configuration, resumability, and failed-case replay.
- Release-gate configuration per workflow.

### Dataset families

- OCR/layout/question segmentation.
- Metadata/taxonomy normalization.
- Tutor explanation, hinting, answer assessment, and mastery transitions.
- Pattern calculations.
- Exam blueprint, generation, solutions, and solvability.
- Marking agreement and abstention.
- Remediation routing.
- Contribution consent, personal-data detection, duplicate detection, eligibility, and access authorization.
- Dependency failure, adversarial input, and tenant isolation.
- Authentication journeys: new Google user, existing password user with the same verified Google email, cancelled consent, provider error, expired callback, rejected return URL, repeated callback, sign-out, password fallback, and preservation of existing tenant data after identity linking.

### Provisional critical gates

- 100% schema-valid accepted outputs.
- Zero cross-tenant/library leaks or unauthorized writes.
- Zero automatic publication without explicit consent and accepted review.
- Zero mastery promotion without sufficient evidence.
- Zero published exam without an accepted solution/marking scheme.
- Blank answers always receive zero or explicit `not_markable`, never invented credit.
- No unbounded retries or tool/model loops.

Numeric average thresholds are ratified only after the first human-reviewed baseline; critical failures remain zero-tolerance.

### Exit gate

- Each active workflow has development and untouched held-out cases.
- Graders have calibration examples and disagreement handling.
- CI runs cheap deterministic evals; release runs the complete held-out suite.
- Prompt/model changes cannot merge without a versioned comparison report.

### Parallelism

S4A starts during S0 and runs alongside current-system inventory. S4B begins after S2A and then expands as each domain contract pack freezes. Dataset collection can proceed by workflow in parallel, but held-out examples must be isolated from prompt authors.

## S5 — Frontend Shell and API Boundary

### Purpose

Decompose monolithic pages without prematurely changing learning behavior.

### Work

- Introduce feature folders: `resources`, `patterns`, `learning`, `simulator`, `contributions`, and shared UI/data clients.
- Replace direct table writes with typed application commands incrementally.
- Add request, job-progress, retry, cancellation, and recoverable-error states.
- Preserve current mobile behavior through visual regression and journey tests.
- Build desktop resource-focus layout behind a flag using region fixtures.
- Create mock API adapters generated from S2 contracts.
- Make the authenticated Atlas conversation shell the proposed primary surface behind a feature flag.
- Add a discoverable command registry: `/recent`, `/resources`, `/upload`, `/progress`, and `/patterns` remain deterministic UI commands; `/learn`, `/quiz`, `/exam`, `/clarify`, `/next`, and `/variant` dispatch typed workflow commands.
- Add a grouped `@` entity picker whose resource labels resolve to stable IDs and fresh authorization; defer canonical topic mentions until S7 taxonomy stability passes.
- Add a standards-compliant `Continue with Google` action to the shared authentication surface, with pending, cancellation, callback-error, safe-return, and password-fallback states. Do not load a second authentication SDK.
- Render upload progress, recent study spaces, resource management, progress, patterns, and library results as application-owned cards/drawers rather than model prose.
- Group exam-routed objectives under one Exam Review card per exam attempt; show the active objective, remediation stage, completed/total weak areas, and Continue action without exposing technical session or episode IDs.
- Keep legacy Home, Upload, and Vault routes until their management and journey responsibilities have verified replacements.

### Verified simulator/progress-rail baseline

An authenticated in-app Browser review of an existing marked simulation on 2026-09-13 confirmed that the useful question-navigation interaction can be retained, but its layout mechanics should not be copied unchanged into the tutoring workspace. The review also followed a `Practice` action through to a live Atlas foundation session, confirming the current exam-to-tutor handoff described in S11.

These observations do **not** reopen S1. They are allocated by responsibility:

| Finding | Owning segment | Plain-language reason |
|---|---|---|
| Fixed two-column simulator grid and mobile squeezing | S5 Frontend | This is a responsive layout/component problem, not a database or security repair. |
| Reusable exam/tutor progress navigator | S5 with S9 fixtures | Build the visual shell in S5; supply real learning objectives and mastery states from S9. |
| Preserve simulation, question, marking-result and competency provenance | S2C/S2D contracts | The IDs and lifecycle must be defined before either workflow relies on them. |
| Idempotent `Practice` command and evidence-linked Atlas handoff | S11, integrating S9 | S11 owns remediation; S9 owns the durable learning objective that receives it. |
| Responsive, accessibility and handoff regression coverage | S4/S5/S11 | The harness measures the behavior, the frontend owns layout, and remediation owns routing correctness. |

| View | Main workspace | Rail | Observed behaviour |
|---|---:|---:|---|
| 1440 px, expanded | 696 px | 220 px | Usable two-column layout. |
| 1440 px, collapsed | 652 px | 44 px | The outer container shrinks from 980 px to 760 px, so collapse does not return space to the paper. |
| 390 px, expanded | about 91 px | 220 px | The permanent second column severely compresses exam content. |
| 390 px, collapsed | about 267 px | 44 px | The rail, 16 px grid gap, and page padding still consume material workspace width. |

The rail and its contents are also statically positioned, so question navigation scrolls out of view on long papers. The simulator grid is defined with inline styles and has no simulator-specific responsive breakpoint.

Implement this as a focused component extraction rather than a simulator rewrite:

- Extract a reusable `ProgressRail` with typed items, active item, completion/mark state, selection callback, collapse state, and accessible labels.
- Keep the current 220 px rail interaction on desktop, but make its inner navigation sticky and independently scrollable when necessary.
- Keep the desktop outer container width stable when the rail collapses so released width is returned to the paper or learning workspace.
- Below the mobile breakpoint, use a single-column workspace. The collapsed control becomes a small edge bookmark that consumes no grid column, gap, or content margin.
- Open the full mobile rail as a right-side drawer/sheet over the workspace instead of squeezing the resource or question.
- Give the trigger `aria-expanded`, `aria-controls`, an explicit label, the current item, and completed/total progress; restore focus when the drawer closes.
- Reuse the same shell in Atlas tutoring with learning objectives/steps and mastery states in place of exam-question marks.
- Cover 390 px, 430 px, 768 px, and 1440 px states in visual regression tests, including expanded/collapsed, long-page scroll, keyboard navigation, and focus return.

### Exit gate

- `EnginePage` and `SimulatePage` are orchestration shells composed from tested feature modules.
- Mobile critical journeys retain accepted visual/interaction behavior.
- At mobile widths, opening or collapsing progress navigation never changes the resource workspace width; the closed bookmark does not reserve a grid column.
- At desktop widths, collapsing the rail increases rather than decreases available workspace width, and progress navigation remains reachable while scrolling.
- New components can run against fixtures without live model calls.
- No new frontend feature performs privileged domain writes directly.
- Explicit UI/navigation commands make zero model calls, and unknown commands fail closed with a discoverable supported-command list.
- Renaming a resource does not break mention resolution, existing study spaces, or resume links.
- Google OAuth succeeds on supported desktop/mobile browsers, returns only to an allowlisted Atlas route, preserves an existing linked account's data, and degrades to actionable password sign-in when unavailable or cancelled.

### Parallelism

Safe after the relevant S2A/S2B/S2C contracts freeze. UI extraction, typed client generation, and desktop layout can proceed in parallel by directory ownership. The Google-authentication UI/configuration slice and its callback, identity-linking, and tenant-preservation tests passed before the S2A freeze. Do not wire other live workflow transitions until S3 endpoints are accepted.

## S6 — Ingestion and OCR v2

### Purpose

Create a deterministic-first resource representation before Atlas speaks to a student.

### State machine

```text
queued -> validating -> parsing -> rendering -> segmenting
       -> interpreting -> verifying
       -> accepted | review_required | failed | cancelled
```

### Work

- Hash and deduplicate uploads without crossing private ownership boundaries.
- Extract native PDF text/layout first; render pages deterministically.
- Apply OCR/vision only where native extraction is absent or insufficient.
- Segment question hierarchy and preserve bounding boxes/text spans.
- Use structured model interpretation for bounded ambiguous fields.
- Validate page accounting, numbering sequences, mark totals, empty text, malformed mathematics, and duplicated regions.
- Store all intermediate artifacts and confidence reasons.
- Never publish partial accepted question sets silently.

### Exit gate

- Every page is accounted for and linked to immutable source evidence.
- Held-out extraction meets ratified transcription, segmentation, numbering, and marks thresholds.
- Low-confidence or inconsistent documents route to review.
- Retrying any stage does not duplicate canonical questions.
- Atlas cannot start a resource-based session until ingestion is accepted.

### Parallelism

Native parsing/rendering, OCR adapters, segmentation, and validators can be developed in parallel against shared S2B fixtures. All are required branches unless a work packet explicitly defines a safe degraded artifact. Final acceptance orchestration is sequential and owned by one workflow.

## S7 — Review, Metadata and Taxonomy Normalization

### Purpose

Turn probabilistic extraction into a trustworthy resource model and canonical concept graph.

### Work

- Review UI showing original page/region beside extracted fields.
- Approve/edit/split/merge/reject question operations with audit history.
- Institution/course metadata suggestion followed by explicit user or reviewer confirmation.
- Versioned concept taxonomy, aliases, prerequisite edges, and course mappings.
- Deterministic normalization first; bounded model suggestion only for unmatched values.
- Reprocessing policy that preserves prior versions and invalidates affected downstream snapshots.

### Exit gate

- Every accepted question has evidence anchors and canonical concept status or an explicit `unmapped` state.
- Display-string changes do not break identifiers.
- Review changes trigger deterministic downstream invalidation events.
- Metadata confirmation does not silently establish student affiliation.

### Parallelism

Review UI and taxonomy services can proceed in parallel after S2B. Automated normalization depends on S4 evaluation cases. Patterns may build on frozen normalized fixtures but not production extraction until this gate passes.

## S8 — Patterns v2

### Purpose

Strengthen the high-ROI deterministic intelligence layer.

### Work

- Pure functions for topic frequency, paper recurrence, question position, marks, difficulty, coverage, and confidence.
- Separate personal, selected-resource, all-private-resource, and institution/course scopes.
- Immutable snapshot with source IDs, eligibility filters, algorithm version, confidence, and creation reason.
- Incremental invalidation when a question, taxonomy mapping, contribution status, or takedown changes.
- Explainable UI that shows the evidence behind every pattern claim.
- Blueprint-ready output contract for exam generation.

### Exit gate

- Golden deterministic fixtures produce byte-stable normalized outputs.
- Snapshot recomputation is idempotent and excludes unauthorized/unaccepted resources.
- Every insight can name its supporting resources/questions.
- Simulator consumers use snapshot IDs rather than rebuilding patterns ad hoc.

### Parallelism

Algorithms and UI can proceed in parallel against S2B/S2D fixtures. Live integration waits for S7. The S2D blueprint contract must freeze before S10 begins integration.

## S9 — Progressive Learning and Mastery Engine v2

### Purpose

Make Atlas an evidence-driven tutor rather than an unstructured chat loop.

### State machine

```text
diagnosing -> teaching -> worked_example -> guided_attempt
           -> independent_attempt -> exam_level_attempt
           -> transfer_attempt -> mastered
           -> remediation / paused / review_required
```

### Work

- Host-selected learning objective and source scope.
- Durable study spaces bind a frozen authorized scope snapshot, goal, plan, current objective, attempts, and conversation episodes.
- Resource progression plans cover accepted source questions and canonical concepts while tracking resource completion separately from global competency mastery.
- Enforce explicit scope policies (`strict_resource`, `resource_mastery`, `resource_transfer`, and `collection_scope`) and prevent silent cross-scope retrieval.
- Resume an existing compatible active plan idempotently; a different resource mention requires an explicit one-request reference or scope switch.
- Build per-turn context from durable state and current evidence with bounded recent turns; roll long conversations into new episodes without treating summaries as state.
- Deterministic question selection constraints with model assistance only where ambiguity remains.
- Structured tutor-turn output: message, evidence anchors, assessment, error type, confidence, next activity, and proposed transition.
- Host mastery policy using attempt evidence, independence, difficulty, recency, and transfer performance.
- Deterministic remediation placement policy selects the starting stage from accepted marking evidence and prior learner state. Blank or prerequisite failures may begin at diagnosis/foundation; a specific procedural gap may begin at a worked or guided attempt; a minor error with prior mastery may begin at exam/trap practice; strong performance may begin at transfer. The model may propose but cannot persist placement.
- Reuse an active remediation objective idempotently when its assignment is selected again. Evidence from another compatible learning plan may inform learner state, but Atlas never silently merges study spaces with different goals or scope snapshots.
- Durable resume from stored state rather than reconstructed chat history.
- Bounded math verification, source retrieval, and visualization tools with matched tool-result loops.
- Session summarization as derived state, never the source of truth.
- Prompt versions and tutor eval reports.

### Exit gate

- Reloading or changing devices resumes the identical objective/state.
- Every mastery transition cites accepted attempt evidence.
- A model cannot skip, invent, or persist a state transition directly.
- Held-out educator review meets ratified correctness, pedagogy, assessment, and progression thresholds.
- Mobile mode passes journey and accessibility tests.
- A resource-scoped plan cannot select an unrelated curriculum objective, and every assessed item names its scope snapshot and source or labelled transfer provenance.
- Long-history and device-switch tests resume the same study space, objective, evidence, and pending activity without replaying the full transcript.
- An exam-routed objective does not begin a model turn until its exam, question, marking result, remediation assignment, authorized scope, learner state, and placement decision have been loaded and validated.

### Parallelism

Learner-state policy, prompt/eval work, tool adapters, and frontend learning components can proceed in parallel after S2B/S2C and the relevant S4 contracts using fixtures. End-to-end persistence waits for S3; source-grounded release waits for S6/S7.

## S10 — Exam Blueprint, Generation and Verification

### Purpose

Produce exams through a validated manufacturing pipeline rather than one JSON request.

### State machine

```text
blueprint_created -> generating -> validating -> solving
                  -> accepted
                  -> repair_pending -> generating
                  -> failed / cancelled
```

### Work

- Deterministic blueprint from a versioned pattern snapshot.
- Slot-level constraints for topic, concept, marks, difficulty, position, and source similarity.
- Structured question generation per slot or bounded batch.
- Duplicate and leakage checks against source/private/approved scope.
- Canonical solution and marking-scheme generation followed by independent verification.
- Arithmetic/symbolic checks with bounded deterministic math tools where applicable.
- One repair cycle per rejected item; fail explicitly after budget exhaustion.

### Exit gate

- Exam totals, instructions, slot coverage, and schema validate deterministically.
- Every published question has an accepted solution and marking scheme.
- No prohibited source copying or unauthorized resource use is detected.
- Educator-held-out acceptance and difficulty calibration meet ratified thresholds.

### Parallelism

Blueprint code, generation prompt/evals, duplicate checks, and solver/verifier adapters can proceed in parallel after S8 contract freeze. Publication orchestration is sequential and cannot bypass any validator.

## S11 — Marking and Evidence-Linked Remediation

### Purpose

Turn exam performance into a trustworthy learning objective and close the loop.

### Work

- Mark only against the accepted question, solution, marking scheme, and typed student evidence.
- Structured per-question result with marks, correctness, confidence, error taxonomy, evidence, and abstention.
- Deterministic total calculation and consistency checks.
- Canonical concept mapping through IDs, not approximate labels.
- Remediation assignment containing source exam/question, answer, lost marks, diagnosis, target competency, and completion criteria.
- Atlas opens the remediation objective with full authorized evidence.
- Reassessment closes, repeats, or escalates the assignment.

The current prototype's `Practice` action inserts a generic session at the `foundation` layer and navigates to `/engine/:topic__:subtopic__:sessionId`. Preserve the immediate handoff experience, but replace that implicit route with an idempotent application command that creates or resumes a durable remediation assignment linked to the originating simulation, question, marking result, and canonical competency. The shared `ProgressRail` should display that linkage and completion state without becoming the authority for either workflow.

### Exam-routed session identity and state

Treat the exam review, remediation objective, learning session, and conversation history as separate identities:

| Record | Example display | Responsibility |
|---|---|---|
| Exam Review study space | `Review · Simulated Exam — 22 May` | Durable container for every weak area from one user/exam attempt; this is the Recent card. |
| Learning objective | `De Morgan's Laws · Question 1` | The competency and source question currently being remediated. |
| Learning session | Not normally named | One resumable execution of the objective, including its current stage and pending activity. |
| Conversation episode | Hidden | A bounded transcript window that may roll over without resetting learning state. |

```text
marked exam attempt
        |
        v
one Exam Review study space
        |
        +-- suggested remediation: Q1 / De Morgan's Laws
        +-- active remediation: Q2 / Complex Numbers
        +-- completed remediation: Q4 / Factor Theorem
```

The marking workflow creates versioned `suggested` remediation assignments. Selecting `Practice` issues `start_or_resume_remediation(remediation_assignment_id)` with an idempotency key derived from the authenticated user, exam attempt, accepted marking result, question, and canonical competency. The command:

1. Re-authorizes the exam attempt, evidence, and scope snapshot.
2. Creates or returns the single Exam Review study space for that exam attempt.
3. Creates or returns the assignment's single target learning objective and active learning session.
4. Applies the host-owned placement policy rather than defaulting every student to `foundation`.
5. Reads back the persisted links and state before returning a stable ID-based route such as `/study-spaces/:studySpaceId?objective=:objectiveId`.
6. Loads the origin evidence and durable learner state before Atlas may produce its first turn.

Repeated clicks, refreshes, retries, and device changes return the same active objective. A compatible objective elsewhere may contribute learner evidence, but it is not silently merged into the exam-review study space. This keeps exam-specific context and resource authorization intact while preventing duplicate Recent cards. System names are deterministic fallbacks; students may rename a study space without changing any IDs or links.

### Exit gate

- Blank, contradictory, and non-markable cases behave deterministically.
- Human marking agreement meets ratified exact/within-one-mark and error-category thresholds.
- Every Practice action resolves to a canonical objective or explicitly reports no safe match.
- Completion updates the originating remediation assignment and learner state.
- One exam attempt produces at most one active Exam Review study space and one target objective per remediation assignment under retries and concurrent clicks.
- Recent cards, progress navigation, reloads, and cross-device resume show the same active objective and completed/total remediation count.
- Placement tests prove that prior learner evidence and diagnosed error type select an allowed starting stage; no model output or hard-coded `foundation` default can bypass host policy.
- Renaming any visible exam-review or objective label cannot alter routing, scope, authorization, or resume behavior.

### Parallelism

Marking evals, remediation schema/UI, and routing code can proceed in parallel after S2C/S2D and the relevant S4 contracts. Live marking depends on accepted S10 outputs; Atlas handoff depends on S9 objective contracts.

## S12 — Governed Contribution Network

### Purpose

Create the institution-specific network effect without collapsing private ownership, copyright, privacy, or access boundaries.

### State machine

```text
draft -> submitted -> screening -> review_required
      -> accepted -> published
      -> rejected / quarantined
published -> withdrawn / takedown
```

### Work

- Separate explicit contribution command from private upload.
- Versioned consent and rights attestation.
- Institution/course detection followed by user confirmation.
- Personal-data scan and redaction workflow.
- Exact hash and bounded near-duplicate detection within authorized review scope.
- Manual reviewer console, reason codes, provenance, allowed-use policy, and audit trail.
- Library access entitlements and deterministic institution/course/resource filtering.
- Idempotent contributor rewards only after acceptance.
- Takedown/withdrawal that blocks new shared use and invalidates derived snapshots.
- Institution-specific Patterns snapshots and product analytics measuring contribution quality and network growth.
- First-party `@public_library` search with bounded query-to-filter parsing followed by deterministic metadata/lexical search and explicit result selection.
- A separately gated, read-only public Atlas MCP design for search, metadata, derived course patterns, authorized region reads, and Atlas study deep links.

### Required policy gate

Before implementation reaches publication, obtain reviewed policies for eligible material, contributor representations, privacy, retention, takedown, repeat abuse, institution naming, and permitted derived use. This is a product/legal dependency, not a model decision.

### Exit gate

- Private uploads never become shared without a distinct accepted submission.
- Zero unauthorized library reads in adversarial tests.
- Personal-data and eligibility gates meet ratified release thresholds with manual review retained.
- Duplicate submissions cannot create duplicate rewards.
- Takedown removes shared availability and recomputes affected snapshots.
- Public-library results cannot enter a private or institution-scoped study space without explicit selection and a fresh entitlement check.
- No public MCP release occurs without protocol, authorization, rate-limit, provenance, copyright/allowed-use, abuse, and takedown evaluations.

### Parallelism

Contribution UX, review console, duplicate tooling, entitlement policy, and reward ledger can build in parallel after S2E against fixtures. Live integration waits for S3 and the relevant S4 harness. Publication cannot start before S6/S7 quality gates and the policy gate. Institution Patterns integration depends on S8; institution-scoped tutoring depends on S9 scope and entitlement contracts.

## S13 — Continuous Migration, Cutover and Production Rollout

### Purpose

Move each accepted vertical slice from prototype paths to routed workflows without a flag day. S13 is a cross-cutting lane that begins with Wave A migration fixtures and repeats per workflow; contribution delivery is not a prerequisite for releasing the private learning core.

### Work

- Backfill legacy resources, questions, sessions, attempts, exams, and results into the new schema with provenance `legacy`.
- Produce reconciliation reports before and after every migration.
- Run new ingestion, tutoring assessment, exam generation, and marking in shadow/advisory modes.
- Compare outcomes and collect educator/user corrections.
- Roll out by workflow and cohort with independent kill switches.
- Route new writes to the new system before retiring old reads.
- Retain rollback/read compatibility for a defined window.
- Perform load, cost, backup/restore, provider-failure, and incident-response drills.

### Suggested cutover order

1. Google sign-in through Supabase Auth, with password fallback and an authentication kill switch.
2. Read-only new API and typed frontend client.
3. New private resource model and ingestion shadow.
4. Patterns v2 reads.
5. New learning sessions for a pilot cohort.
6. Exam generation pilot.
7. Marking/remediation pilot.
8. Contribution pilot at selected institutions.
9. Remove old Edge Function paths after retention and rollback windows expire.

Each numbered item has its own build, shadow, cohort, release, rollback, and retirement decision. A later item cannot delay an earlier item that independently passes its release gate.

### Exit gate

- Held-out evaluations and operational SLOs pass for every enabled workflow.
- Backup/restore and rollback drills succeed.
- No production route depends on undocumented legacy schema or browser-held secrets.
- Incident ownership, alerts, dashboards, runbooks, and kill switches are tested.

### Parallelism

Migration readers, reconciliation, runbooks, dashboards, and load/failure drills may progress beside feature implementation using frozen contracts. Only one owner may authorize a workflow's write cutover. Old-path retirement is sequential and occurs after that workflow's compatibility and rollback window, not after the whole programme completes.

## 6. Safe Parallel Delivery Waves

## Wave A — Foundation

Baseline evaluation capture begins during S0. The first product slice has this sequential contract spine:

```text
Pre-S0 -> S0 + S4A -> S1 -> S2A -> S2B + S2C contract freeze
```

S2D and S2E may be designed in parallel when ownership is available, but they do not block the first resource-to-learning slice. After the required packs freeze, run these lanes in parallel:

| Lane | Work | Isolation rule |
|---|---|---|
| Platform | S3 API, jobs, model gateway, observability | Own `backend/platform` and infrastructure |
| Evaluation | S4B runners, graders, reports and gates | Own `evals/`; prompt authors cannot edit held-out labels |
| Frontend | S5 feature extraction and mock clients | Own `src/features` and generated client boundaries |
| Migration/Rollout | Legacy readers, fixtures, reconciliation and S13 controls | Read-only against production until a per-workflow cutover is approved; own migration tooling |

Authentication gate: both password and Google sign-in produce the same stable Supabase principal and tenant access, safe callback/return behavior, working sign-out, and password fallback. A linked existing account retains its resources, sessions, entitlements, and history.

Integration gate: one authenticated command must travel UI -> API -> durable job -> worker -> validated result -> UI using a non-model fixture under both password and Google-authenticated Supabase sessions.

## Wave B — Resource and Learning Core

Parallel lanes:

| Lane | Work | Can use fixtures? | Live dependency |
|---|---|---:|---|
| Document | S6 parsing, OCR, regions, validation | Yes | S3/S4 |
| Review/Taxonomy | S7 review UI and normalization | Yes | Accepted S6 records |
| Learning | S9 learner policy, tutor prompts, tools | Yes | S3/S4; release needs S6/S7 |
| Frontend | Resource-focus and learning components | Yes | S5 contracts |

Integration gate: an accepted resource question with a page region starts a persisted learning objective, renders on mobile/desktop, records a structured attempt, and resumes identically.

Chat-shell gate: `/learn @resource` resolves an authorized immutable scope, creates or resumes one compatible study space idempotently, advances only through that scope's accepted coverage, rolls conversation episodes without losing state, and makes zero model calls for explicit UI commands.

## Wave C — Intelligence and Assessment

Parallel lanes:

| Lane | Work | Entry gate |
|---|---|---|
| Patterns | S8 deterministic snapshots | S7 normalized fixtures accepted |
| Exam blueprint/generation | S10 component work | S8 blueprint contract frozen |
| Marking evaluation | S11 datasets and graders | S10 solution/mark-scheme schema frozen |
| Remediation | S11 objective mapping/UI | S9 objective contract frozen |

Integration gate: an accepted pattern snapshot produces a validated exam; a submitted attempt produces consistent marking and one evidence-linked Exam Review study space. Every Practice action idempotently focuses its canonical remediation objective, preserves exam/question/result/scope provenance, applies deterministic starting-stage placement, survives retry and device change without duplication, and reports completion back to the originating assignment.

## Wave D — Network and Rollout

Parallel preparation:

- Contribution UX and reviewer console.
- Privacy/duplicate/eligibility evaluation.
- Entitlement/reward ledger.
- Policy and takedown operations.
- Migration and operational runbooks.

Fixture-backed preparation may begin after S2E freezes; live integration waits for S3 and the relevant S4 harness. It does not block private-resource ingestion, tutoring, Patterns, simulation, remediation, or their per-workflow S13 releases.

Sequential release:

```text
policy approval
  -> private contribution submission
  -> manual screening/review
  -> limited institution library
  -> institution pattern snapshots
  -> contributor rewards
  -> broader cohort rollout
```

## 7. Work That Must Not Be Parallelized Prematurely

- Schema consumers before every contract pack they import is frozen.
- Shared-library access before verified authentication, RLS, and entitlement tests.
- Live Patterns v2 before normalized question/concept records are accepted.
- Desktop page highlighting before page/region coordinates have an evaluated contract.
- Tutor mastery writes before the learner-state policy and grading evals pass.
- Exam marking before canonical solutions and marking schemes exist.
- Remediation handoff before Atlas accepts evidence-linked objectives.
- Contribution publication before consent, eligibility, privacy, review, and takedown controls.
- Prompt/model optimization before a baseline dataset and cost/quality report exist.
- Microservice splitting before the modular service shows a measured scaling or isolation problem.
- Treating contribution delivery as a prerequisite for cutting over an independently accepted private-learning workflow.

## 8. Parallel Engineering Rules

To make parallel work safe and boring:

1. Merge contract PRs before consumer PRs.
2. Assign directory ownership per lane and avoid simultaneous edits to shared orchestration files.
3. Use generated clients or checked JSON fixtures rather than copying types manually.
4. Every lane supplies contract tests and at least one failure fixture.
5. Keep PRs single-purpose and deployable behind a disabled flag.
6. Rebase frequently; avoid long-lived integration branches.
7. Run an integration suite whenever a contract version changes.
8. Never change a held-out expected answer in the same PR as the prompt/model being evaluated.
9. Database migrations are additive first; destructive cleanup is a later, separately approved release.
10. One owner coordinates state-machine changes because transition names and invariants are shared contracts.

## 9. Python-Agents Reference Standard

`C:\Users\Lusa\python-agents` is a read-only teaching and implementation reference. Atlas must not import it, modify it, or couple production behavior to it. Atlas implementations reproduce only the reviewed principles needed inside the Atlas codebase:

- Keep workflow orchestration provider-independent and place Claude/provider syntax in thin adapters.
- Use a chain for known sequential transformations; give every step a unique stable name and validate its output before the next step.
- Run branches concurrently only when they are independent. Cap concurrency, preserve declared branch identity and aggregation order, and fail closed unless partial output is explicitly safe.
- Route over a closed application-owned label set, validate confidence locally, execute exactly one route, and define clarification or an allowlisted fallback for low confidence.
- Bound evaluator/repair loops by iterations, time, tokens, and cost. Preserve candidates and evaluations and return an explicit unaccepted outcome at the limit.
- Preserve complete structured model blocks and matched tool request/result IDs privately; render only controlled progress labels to students.
- Test orchestration with plain functions and fake adapters before using live model calls.
- Add comments or docstrings for intent, invariants, failure policy, and non-obvious constraints; do not comment code merely to restate it.

### Required implementation work packet

Every task entering implementation must state:

| Field | Required content |
|---|---|
| Objective | One bounded user or system outcome |
| Contract packs | Frozen schemas and versions consumed or produced |
| Dependency class | Build, live integration, and release prerequisites separately |
| Pattern | Deterministic function, one model call, chain, parallel aggregation, route, bounded evaluator/repair, or bounded tool loop |
| Steps/branches | Stable names, inputs, outputs, validators, and aggregation order |
| Authority | Initiator, authenticated principal, reads, writes, tenant scope, and approval rule |
| Failure policy | Fail-closed/partial rule, retry classes, cancellation, degraded mode, and explicit unaccepted result |
| Budget | Calls, tool rounds, wall time, tokens, cost, concurrency, payload, and retry/repair limit |
| Verification | Unit, contract, integration, authorization, idempotency, postcondition, and eval cases |
| Ownership | Directory owner, integration owner, rollout owner, feature flag, and kill switch |

### Default workflow budgets and failure semantics

These are design ceilings, not spending targets. S0 may lower them after document-size and latency baselines; raising them requires a versioned design and evaluation change.

| Workflow | Model-call ceiling | Tool/repair ceiling | Parallel/partial policy |
|---|---:|---:|---|
| Explicit command or mention resolution | 0 | 0 | Exactly one deterministic route; unknown input fails closed |
| Tutor turn | 3 total | 2 tool rounds or 1 repair within the same total | Required evidence/tool failures abstain; optional visualization may degrade explicitly |
| One extraction run | 3 total | 1 invalid-output repair within the same total | Required page accounting, segmentation, and validation fail closed; uncertain fields route to review |
| Pattern snapshot | 0 normally | 0 | Required inputs fail closed; unavailable optional metrics are labelled and excluded |
| Exam generation | 4 total | 1 repair per rejected bounded batch within the same total | All blueprint slots, solutions, and marking schemes are required for publication |
| Marking | 2 total | 1 repair within the same total | Unmarkable answers abstain explicitly; totals publish only after all required items resolve |
| Contribution screening | 2 total | 1 repair within the same total | Privacy, eligibility, authorization, and duplicate gates fail closed; no reward or publication on partial results |

Parallel branches use bounded configuration rather than an unbounded task fan-out. The initial process-local ceiling is four branches and each route may set a lower value. Outputs are aggregated in declared stable order even when execution completes out of order. A work packet must override the default explicitly when a safe partial result is intended.

## 10. Orchestration Invariants

Every workflow must satisfy:

- A command names one intent and carries an idempotency key.
- Authorization is derived from the request token and fresh database state.
- The state transition is allowlisted in code.
- The current record version is checked before mutation.
- The domain write, job creation, and outbox event share one transaction.
- Each workflow step has a unique `(workflow_id, step_name, step_version)` key.
- External calls have timeouts, budgets, recorded request hashes, and classified failures.
- Structured outputs are schema-validated and domain-validated.
- Unknown states, tools, routes, or output variants fail closed.
- Success is verified by reading the persisted postcondition.
- Logs contain IDs and versions, not secrets or unnecessary student content.
- A retry can repeat execution but cannot repeat the logical effect.
- A kill switch can stop new work without corrupting work already committed.

## 11. Definition of Done for Every Segment

A segment is not done when code exists. It is done when:

- contracts and migrations are reviewed;
- unit, integration, authorization, idempotency, and failure tests pass where applicable;
- development and held-out evaluation results meet the segment gate;
- metrics, traces, alerts, and cost reporting exist;
- cancellation, retry, degraded-mode, and rollback behavior are documented;
- frontend errors are actionable and do not expose internals;
- runbooks identify owner, kill switch, recovery, and data-repair steps;
- the feature is demonstrated through a production-like environment;
- residual risks and intentionally unsupported cases are recorded.

## 12. Recommended First Three Delivery Milestones

### Milestone 1 — Safe, Reproducible Prototype

Includes Pre-S0, S0, S1, and frozen S2A/S2B/S2C packs. Later S2D/S2E packs proceed when their consumers approach implementation and do not block this milestone.

Outcome: the existing product still works, schema/security/session defects are controlled, Google and password sign-in share one verified Supabase principal boundary, and the replacement contracts required by the first vertical slice are frozen.

### Milestone 2 — Resource-to-Learning Vertical Slice

Includes the minimum accepted parts of S3, S4, S5, S6, S7, and S9.

Outcome:

```text
upload -> accepted extraction -> highlighted question
       -> immutable @resource scope -> durable study space
       -> progressive Atlas objective -> structured attempt
       -> persisted learner state -> reliable resume
```

This should be the first new-architecture product slice because it directly proves Atlas's core promise.

### Milestone 3 — Pattern-to-Remediation Vertical Slice

Includes S8, S10, and S11.

Outcome:

```text
accepted resources -> explainable pattern snapshot
                   -> validated simulated exam
                   -> evidence-based marking
                   -> targeted Atlas remediation
```

Only after these slices are stable should S12 turn resource quality into the institution-specific network effect.

## 13. Explicitly Deferred Decisions

- Separate microservices: defer until measured scale, team ownership, or permission isolation requires them.
- Redis/Celery/Kafka: defer until Postgres job/outbox throughput is insufficient.
- Broad RAG: defer until scoped lexical/relational retrieval fails a reviewed retrieval dataset.
- Multiple agents/subagents: defer until fixed/routed workflows fail because valid tool sequences are genuinely dynamic.
- Prompt caching: defer until stable prompts and repeated-prefix telemetry demonstrate material savings.
- Automatic contribution approval: defer indefinitely until manual-review evidence supports a narrowly scoped safe class.
- Public Atlas MCP: defer external release until the governed first-party library passes licensing, entitlement, provenance, abuse, protocol, rate-limit, and takedown gates; begin read-only.
