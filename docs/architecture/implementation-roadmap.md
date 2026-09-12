# Atlas Implementation Roadmap

## 1. Programme Objective

Replace the current browser-orchestrated prototype with a server-owned, resource-grounded learning system that is reproducible, observable, testable, and safe to evolve.

This is not one refactor. It is a sequence of independently releasable system changes governed by contracts and evaluation gates.

The governing rule is:

> Models interpret, teach, assess, or generate. Deterministic code authenticates, authorizes, routes, validates, persists, retries, budgets, and decides whether state may advance.

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

## 4. Dependency Graph

```text
S0 Programme controls and baseline
 |
 v
S1 Reproducible database, security and current-system stabilization
 |
 v
S2 Domain model and versioned contracts -----------------------------+
 |                                                                  |
 +----------------------+----------------------+--------------------+
 |                      |                      |                    |
 v                      v                      v                    v
S3 Backend/runtime     S4 Eval harness       S5 Frontend shell    Migration fixtures
 |                      |                      |                    |
 +-----------+----------+                      |                    |
             |                                 |                    |
             v                                 |                    |
       S6 Ingestion/OCR v2 <-------------------+                    |
             |                                                      |
             v                                                      |
       S7 Review + taxonomy normalization                            |
             |                                                      |
        +----+-------------------------+                            |
        |                              |                            |
        v                              v                            |
  S8 Patterns v2                 S9 Learning/mastery v2 <-----------+
        |                              |
        v                              +----------+
  S10 Exam generation                           |
        |                                        |
        +------------------+---------------------+
                           v
                  S11 Marking + remediation
                           |
                           v
                  S12 Contribution network
                           |
                           v
                  S13 Cutover and production rollout
```

The diagram shows minimum dependencies, not a mandate to wait unnecessarily. Several segments can build against frozen fixtures before upstream live integration is available.

## 5. Work Segments

## S0 — Programme Controls and Baseline

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

## S2 — Domain Model and Versioned Contracts

### Purpose

Freeze the shared language every later lane will use. This is the main sequential gate.

### Core entities

- `resources`, `resource_pages`, `resource_regions`.
- `resource_scope_snapshots`, `resource_scope_members`.
- `study_spaces`, `learning_plans`, `learning_objectives`, `conversation_threads`, `conversation_episodes`.
- `extraction_runs`, `extraction_artifacts`, `extraction_findings`.
- `questions`, `question_parts`, `question_evidence`.
- `institutions`, `courses`, `course_offerings`, `concepts`, `concept_aliases`, `question_concepts`.
- `learner_states`, `learning_objectives`, `learning_sessions`, `tutor_turns`, `attempts`.
- `pattern_snapshots`, `pattern_evidence`.
- `exam_blueprints`, `exams`, `exam_questions`, `solutions`, `marking_schemes`, `exam_attempts`, `marking_results`.
- `remediation_assignments`.
- `contribution_submissions`, `contribution_reviews`, `library_resources`, `library_entitlements`, `contributor_rewards`, `takedown_cases`.
- `workflow_jobs`, `workflow_steps`, `model_calls`, `outbox_events`, `audit_events`.

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

### API contracts

- Generate OpenAPI and JSON Schema from Pydantic models.
- Generate or validate TypeScript client types from those contracts.
- Version event and model-output schemas independently.
- Create fixture packages for every contract so downstream lanes can work before live upstreams exist.

### Exit gate

- Architecture review approves entity ownership, lifecycle, tenant scope, and deletion behavior.
- JSON Schema contract tests pass in Python and JavaScript.
- No unresolved question remains about which service is allowed to update each state.
- Fixtures cover normal, empty, partial, invalid, and legacy records.

### Parallelism

Entity modelling can be divided by domain, but one owner must integrate naming, identifiers, lifecycle, and cross-domain invariants. Consumer implementation must not begin until the first contract version is frozen.

## S3 — Backend Platform and Boring Workflow Runtime

### Purpose

Build the trusted execution boundary shared by every intelligent feature.

### Work

- FastAPI application with JWT verification, request IDs, typed errors, health/readiness endpoints, and OpenAPI.
- Service/repository boundary that always receives an authenticated principal rather than a free-form user ID.
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
- No model output can directly mutate domain tables.

### Parallelism

API shell, job runner, model gateway, and observability can be owned separately after interfaces freeze. Integrate them through contract tests before feature workflows use them.

## S4 — Evaluation Harness and Dataset Governance

### Purpose

Make quality measurable before prompt and model choices harden.

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

This lane should start immediately after S2 and run continuously. Dataset collection can proceed by workflow in parallel, but held-out examples must be isolated from prompt authors.

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
- Render upload progress, recent study spaces, resource management, progress, patterns, and library results as application-owned cards/drawers rather than model prose.
- Keep legacy Home, Upload, and Vault routes until their management and journey responsibilities have verified replacements.

### Verified simulator/progress-rail baseline

A live Chrome review of an existing marked simulation on 2026-09-10 confirmed that the useful question-navigation interaction can be retained, but its layout mechanics should not be copied unchanged into the tutoring workspace.

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

### Parallelism

Safe after S2. UI extraction, typed client generation, and desktop layout can proceed in parallel by directory ownership. Do not wire live workflow transitions until S3 endpoints are accepted.

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

Native parsing/rendering, OCR adapters, segmentation, and validators can be developed in parallel against shared fixtures. Final acceptance orchestration is sequential and owned by one workflow.

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

Review UI and taxonomy services can proceed in parallel after S2. Automated normalization depends on S4 evaluation cases. Patterns may build on frozen normalized fixtures but not production extraction until this gate passes.

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

Algorithms and UI can proceed in parallel against S2 fixtures. Live integration waits for S7. Blueprint contract must freeze before S10 begins integration.

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

### Parallelism

Learner-state policy, prompt/eval work, tool adapters, and frontend learning components can proceed in parallel after S2/S4 using fixtures. End-to-end persistence waits for S3; source-grounded release waits for S6/S7.

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

### Exit gate

- Blank, contradictory, and non-markable cases behave deterministically.
- Human marking agreement meets ratified exact/within-one-mark and error-category thresholds.
- Every Practice action resolves to a canonical objective or explicitly reports no safe match.
- Completion updates the originating remediation assignment and learner state.

### Parallelism

Marking evals, remediation schema/UI, and routing code can proceed in parallel after S2. Live marking depends on accepted S10 outputs; Atlas handoff depends on S9 objective contracts.

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

Contribution UX, review console, duplicate tooling, entitlement policy, and reward ledger can proceed in parallel after S2/S3/S4. Publication cannot start before S6/S7 quality gates and the policy gate. Institution Patterns integration depends on S8.

## S13 — Migration, Cutover and Production Rollout

### Purpose

Move from prototype paths to the routed workflows without a flag day.

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

1. Read-only new API and typed frontend client.
2. New private resource model and ingestion shadow.
3. Patterns v2 reads.
4. New learning sessions for a pilot cohort.
5. Exam generation pilot.
6. Marking/remediation pilot.
7. Contribution pilot at selected institutions.
8. Remove old Edge Function paths after retention and rollback windows expire.

### Exit gate

- Held-out evaluations and operational SLOs pass for every enabled workflow.
- Backup/restore and rollback drills succeed.
- No production route depends on undocumented legacy schema or browser-held secrets.
- Incident ownership, alerts, dashboards, runbooks, and kill switches are tested.

## 6. Safe Parallel Delivery Waves

## Wave A — Foundation

Sequential start:

```text
S0 -> S1 -> S2 contract freeze
```

After S2, run these lanes in parallel:

| Lane | Work | Isolation rule |
|---|---|---|
| Platform | S3 API, jobs, model gateway, observability | Own `backend/platform` and infrastructure |
| Evaluation | S4 datasets, graders, reports | Own `evals/`; prompt authors cannot edit held-out labels |
| Frontend | S5 feature extraction and mock clients | Own `src/features` and generated client boundaries |
| Migration | Legacy readers, fixtures, reconciliation | Read-only against production; own migration tooling |

Integration gate: one authenticated command must travel UI -> API -> durable job -> worker -> validated result -> UI using a non-model fixture.

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

Integration gate: an accepted pattern snapshot produces a validated exam; a submitted attempt produces consistent marking and an evidence-linked Atlas remediation session.

## Wave D — Network and Rollout

Parallel preparation:

- Contribution UX and reviewer console.
- Privacy/duplicate/eligibility evaluation.
- Entitlement/reward ledger.
- Policy and takedown operations.
- Migration and operational runbooks.

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

- Schema consumers before S2 contract freeze.
- Shared-library access before verified authentication, RLS, and entitlement tests.
- Live Patterns v2 before normalized question/concept records are accepted.
- Desktop page highlighting before page/region coordinates have an evaluated contract.
- Tutor mastery writes before the learner-state policy and grading evals pass.
- Exam marking before canonical solutions and marking schemes exist.
- Remediation handoff before Atlas accepts evidence-linked objectives.
- Contribution publication before consent, eligibility, privacy, review, and takedown controls.
- Prompt/model optimization before a baseline dataset and cost/quality report exist.
- Microservice splitting before the modular service shows a measured scaling or isolation problem.

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

## 9. Orchestration Invariants

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

## 10. Definition of Done for Every Segment

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

## 11. Recommended First Three Delivery Milestones

### Milestone 1 — Safe, Reproducible Prototype

Includes S0, S1, and S2.

Outcome: the existing product still works, but schema/security/session defects are controlled and the replacement contracts are frozen.

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

## 12. Explicitly Deferred Decisions

- Separate microservices: defer until measured scale, team ownership, or permission isolation requires them.
- Redis/Celery/Kafka: defer until Postgres job/outbox throughput is insufficient.
- Broad RAG: defer until scoped lexical/relational retrieval fails a reviewed retrieval dataset.
- Multiple agents/subagents: defer until fixed/routed workflows fail because valid tool sequences are genuinely dynamic.
- Prompt caching: defer until stable prompts and repeated-prefix telemetry demonstrate material savings.
- Automatic contribution approval: defer indefinitely until manual-review evidence supports a narrowly scoped safe class.
- Public Atlas MCP: defer external release until the governed first-party library passes licensing, entitlement, provenance, abuse, protocol, rate-limit, and takedown gates; begin read-only.
