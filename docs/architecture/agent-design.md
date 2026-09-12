# Agent Design: Atlas Learning System

## Decision Summary

- Objective: Turn private and explicitly contributed mathematics resources into reliable progressive teaching, assessment, exam simulation, evidence-linked remediation, and institution-specific learning intelligence.
- Selected architecture: A server-owned routed workflow, initially implemented as a modular Python service with background workers, bounded model calls, and a few read-only tools.
- Why simpler options are insufficient: Deterministic code cannot interpret varied documents or teach and assess open-ended mathematics by itself. One model call cannot safely cover ingestion, validation, learner-state updates, exam construction, and remediation.
- Why more complex options are unnecessary: The product routes are known. A general tool agent or parent with subagents adds autonomy, latency, cost, and evaluation work without solving a demonstrated routing problem.
- Risk level: High. Incorrect extraction, instruction, marking, or progression can mislead students and corrupt durable mastery records.
- Current versus proposed state: The browser currently orchestrates loosely structured model calls. The proposed backend owns schemas, workflows, evidence, transitions, budgets, and audit traces.

## Scope

### Supported Tasks

- Ingest a PDF/image into reviewable pages, regions, questions, metadata, and concepts.
- Analyze normalized questions deterministically for frequency, position, marks, and coverage.
- Teach a selected resource, paper, topic, sub-topic, or anchored question progressively.
- Assess student work and update evidence-based learner state.
- Generate and validate a simulated exam from a deterministic blueprint.
- Mark a simulation with explicit confidence and uncertainty.
- Create an evidence-linked remediation assignment and route it back into Atlas.
- Render one session as mobile chat or desktop resource-focus mode.
- Let a student explicitly submit an eligible private resource for contribution without changing the default privacy of other uploads.
- Review, deduplicate, de-identify, approve, and publish eligible resources into institution/course libraries.
- Grant contributor benefits only after a contribution is accepted.
- Use approved institution/course evidence to improve local pattern analysis, tutoring, and simulation.
- Present Atlas as a chat-first product shell whose slash commands invoke allowlisted application workflows without a model call where interpretation is unnecessary.
- Resolve `@` mentions to authorized, immutable resource-scope snapshots and keep resource-scoped learning inside their accepted coverage.
- Resume a durable study space and progression plan independently of conversation length or device.

### Explicit Exclusions

- One general agent with every database and tool capability.
- Autonomous multi-agent delegation.
- Open-ended web search or unsourced curriculum expansion.
- Conversation history as durable learner state.
- Sending slash commands to a model and treating its interpretation as workflow authorization.
- Expanding an `@` mention into an entire document or trusting a display name as a resource identifier.
- Silently blending private, contributed, public-library, or newly uploaded resources into an active study scope.
- Model-owned mastery promotion without a host policy.
- Canonical publication of low-confidence extraction without review.
- Broad curriculum RAG in the first revision.
- Silent inference of a student's institution from an uploaded paper.
- Automatic publication of uploads or model-only approval of contributions.
- Acceptance of leaked, unreleased, access-controlled, personally identifying, or otherwise ineligible material.
- Semantic similarity as an authorization, institution-assignment, or contribution-eligibility mechanism.

### Users and Interfaces

- Students use a responsive web application on mobile and desktop.
- Desktop may show the source page and highlighted active region beside Atlas.
- Mobile keeps the current chat-first layout with an optional question crop or source drawer.
- After authentication, the Atlas conversation shell becomes the primary product surface; application-rendered cards and drawers provide upload, recent study spaces, resources, progress, patterns, and library results.
- Internal reviewers inspect low-confidence extraction and evaluation failures.
- Contributors explicitly submit resources and confirm detected institution/course metadata.
- Library reviewers inspect contribution rights, personal information, duplicates, metadata, and quality before publication.

## Success Contract

- Expected inputs: Authenticated user, private upload, explicit contribution consent and metadata confirmation, selected learning scope, learner response, or submitted simulation.
- Required outputs: Validated private records, governed library publication decision, contributor entitlement decision, evidence-linked tutor turn, learner-state decision, validated exam, marking result, or remediation assignment.
- Success metrics: Extraction fidelity, grounding, contribution eligibility accuracy, privacy-redaction recall, duplicate detection, institutional routing precision, mathematical correctness, grading agreement, progression precision, exam validity, latency, calls, and cost.
- Critical failures: Tenant leak; publication without explicit consent; publication of personal, leaked, or ineligible content; unauthorized library access; reward before acceptance; corrupted source question; false teaching accepted as correct; unsupported mastery promotion; invalid exam; silent extraction loss; unbounded loop.
- Clarification conditions: Ambiguous region, unreadable source, unmatched concept, incomplete answer, or conflicting evidence.
- Abstention conditions: Evidence cannot be recovered or verified above the workflow threshold.

## Architecture

Atlas remains one product identity, not one runtime agent. A deterministic interaction router handles explicit slash commands and resolved mentions before an authenticated API selects an allowlisted workflow. No model authorizes or directly chooses between product workflows.

```text
Atlas conversation shell
  / command = reviewed workflow
  @ mention = authorized resource scope
  plain text = goal, question, working, or answer
                         |
                         v
       Deterministic command + mention resolver
                         |
                         v
              Authenticated API / Router
                         |
      +------------------+------------------+
      |                  |                  |
      v                  v                  v
 Ingestion          Learning Engine      Assessment
 workflow           workflow             workflows
      |                  |              +----+-----+
      v                  v              |          |
 Resource model     Learner state     Generate     Mark
      |                  |              |          |
      +---------> Pattern engine <-------+          |
      |                  |                          |
      v                  +----> Remediation <-------+
 Contribution network               |
      |                              v
      +----> Institution library -> New Atlas objective
```

### Implementation Delivery Model

Contract work freezes incrementally rather than as one programme-wide schema event:

```text
S2A common platform
  +--> S2B resources/evidence
  +--> S2C learning
  +--> S2D assessment
  +--> S2E contribution/library
```

A lane may build against fixtures when every pack it consumes is frozen. Live integration additionally requires accepted upstream behavior. Release additionally requires held-out, security, operational, rollback, and workflow-specific gates. Unrelated future packs cannot block the first resource-to-learning slice.

Evaluation baseline and dataset-governance work begins during current-system inventory. Harness implementation expands as each contract pack freezes. Migration and rollout are continuous per-workflow activities; an unfinished contribution network cannot block release of an independently accepted private-learning workflow.

### Chat Shell, Commands and Mentions

The simple interface is a shell over separate application workflows, not a single unbounded chat. Typing `/` opens a discoverable command menu. Explicit UI commands such as `/recent`, `/resources`, `/upload`, `/progress`, and `/patterns` render application data and make no model call. Learning commands such as `/learn`, `/quiz`, `/exam`, and `/variant` create typed commands whose arguments and current workflow state are validated by the host.

The interaction grammar is deliberately small:

```text
/command     = what Atlas should do
@mention     = what authorized evidence Atlas should use
normal text  = the student's goal, working, answer, or question
```

An `@` token is a typed UI entity. Its friendly label resolves server-side to a stable resource, collection, canonical concept, or library-scope identifier. Renames do not change identity; duplicate labels are disambiguated in the picker. Filenames, labels, document text, and public-library results remain untrusted content. A mention never grants access and never pastes a full resource into the prompt.

Changing scope is explicit. A different resource mentioned inside an active study space is either a one-request reference or the start of a separately confirmed scope change; it cannot silently alter plan coverage. `@all_my_papers` and multi-resource selections are frozen as versioned scope snapshots so later uploads do not change an active plan without an explicit refresh.

### Resource-Scoped Study Spaces

The durable unit is a study space, not a topic-labelled conversation. A study space binds an authenticated student, immutable authorized scope snapshot, goal type, progression plan, and active objective. Topics and learning layers are cursors inside that plan. Conversation episodes are replaceable presentation history.

```text
Study space: @Math_1110_2021
  Goal: master this paper
  Scope policy: resource_mastery
       |
       +-- objective: Differentiation / First Principles / drills
       +-- objective: Trigonometry / Identities / foundation
       +-- objective: Polynomials / Factor Theorem / not started
       +-- attempts and mastery evidence
       +-- conversation episodes
       +-- resource coverage and completion
```

Supported scope policies are explicit: `strict_resource` permits only accepted source questions and concepts; `resource_mastery` permits generated teaching and practice inside the resource's concept envelope; `resource_transfer` additionally permits a labelled, slightly harder transfer item; `collection_scope` operates over a frozen authorized resource set. Mathematical explanations may use model knowledge, but curriculum coverage, assessment selection, and lecturer-style claims remain constrained to accepted evidence.

`/recent` lists resumable study spaces or plans rather than deduplicated topics. Mentioning a resource with one active compatible plan offers resume, progress review, or a different goal instead of creating a duplicate. Resource management remains available through a deterministic `/resources` surface even if the legacy Vault page disappears from primary navigation.

The visible history may span months, but each model turn receives only universal policy, the active scope manifest, current objective and learner state, current source evidence, relevant attempts, a bounded recent-turn window, and an optional derived summary. Thread rollover creates a new conversation episode without changing the study space. Chat history and summaries never become the source of truth for progress or mastery.

### Resource Ingestion Workflow

1. Validate file, hash, tenant, and storage ownership.
2. Create an idempotent extraction run.
3. Use deterministic PDF text/layout extraction where available; use OCR/vision for scans and visual regions.
4. Segment pages and candidate question regions with bounding-box provenance.
5. Use a bounded structured model call for question boundaries, transcription, metadata, and taxonomy candidates.
6. Validate schema, numbering, marks, completeness, and mathematical text.
7. Run one bounded repair/secondary check for failed or low-confidence fields.
8. Publish accepted records; route uncertain records to confirmation.

Every item retains resource, page, bounding box, extraction run, model/prompt version, raw evidence, normalized text, and confidence. Those anchors support both desktop highlighting and mobile question crops.

### Pattern Intelligence Workflow

Patterns stays deterministic. It operates on normalized, reviewable records and creates immutable versioned snapshots. Inputs include canonical concept IDs, question hierarchy, marks, position, assessment type, institution/course scope, rights/access status, and extraction confidence. Low-confidence or unapproved shared data is excluded or weighted explicitly.

Personal snapshots use the student's authorized resources. Institution/course snapshots use only accepted library contributions. The source set and eligibility policy are recorded on every snapshot so lecturer-style and institutional claims remain explainable.

### Progressive Learning Workflow

The host owns the state machine:

```text
diagnose -> teach -> worked example -> guided attempt -> independent attempt
         -> exam-level attempt -> tricky transfer attempt -> retain/remediate
```

The six existing layer names can remain, but advancement depends on structured evidence rather than a manual Next button. Each tutor turn returns pedagogical content, source anchors, answer assessment, error type, confidence, learner-state proposal, next activity, and an allowed transition. The host validates and writes state.

During an active question, ordinary input defaults to student working. `/clarify`, `/next`, and `/variant` are deterministic intent overrides exposed through a discoverable menu; progression layers such as drills remain host-owned states rather than model-selected navigation. A context-sensitive Continue action may remain when it reduces effort, but a permanent five-button mobile toolbar is unnecessary.

Optional model-requested tools are limited to deterministic mathematics, allowlisted resource reads, and visualization. The model receives no unrestricted database write tools.

### Desktop Resource-Focus Mode

Desktop mode is a view over the same session, not another agent:

```text
+---------------------------+  +---------------------------+
| Original PDF/page         |  | Atlas                     |
|                           |  |                           |
|   +-------------------+   |  | Teach concept            |
|   | active question   |   |  | Worked example           |
|   | highlighted       |   |  | Guided attempt           |
|   +-------------------+   |  | Independent attempt      |
|                           |  | Tricky transfer question  |
+---------------------------+  +---------------------------+
```

Mobile keeps the chat-first view and can show a cropped region or source drawer. Device switching does not change workflow state.

### Exam Generation Workflow

1. Deterministic code creates a blueprint from a versioned pattern snapshot.
2. A model fills bounded question slots using structured output.
3. Validators check schema, totals, duplicates, topic fit, and source overlap.
4. A solver/verifier checks canonical answers and marking points.
5. One bounded repair pass handles rejected items.
6. Only an accepted exam is published; otherwise return an explicit failure.

### Marking and Remediation Workflow

Marking consumes the validated exam, canonical solution/mark scheme, student answer, and fixed error taxonomy. Uncertain results are labelled rather than forced.

Weaknesses resolve to canonical concept IDs, not display-string matching. A remediation assignment stores the source exam/question, answer evidence, diagnosed error, target competency, and completion criteria. Atlas starts with that objective; reassessment closes or repeats it.

### Governed Contribution Network

Private upload and library contribution are separate workflows. Uploading never implies permission to share, pool, or redistribute a resource.

```text
Private resource
      |
      | student explicitly selects "Contribute"
      v
Consent and rights attestation
      |
      v
Detect institution/course metadata
      |
      v
Student confirms or corrects metadata
      |
      v
Privacy scan + duplicate fingerprint + eligibility checks
      |
      v
Manual review during initial rollout
      |
   +--+----------------+
   |                   |
 reject/quarantine     accept
                       |
                       +--> approved institution/course library
                       +--> contributor benefit
                       +--> institution pattern snapshot
                                      |
                                      +--> Atlas tutoring
                                      +--> Exam simulation
```

Paper metadata may suggest an institution, but it does not establish that the uploader attends that institution. Store detected resource metadata separately from confirmed resource metadata and optional, explicitly declared student affiliation.

An approved contribution records provenance, consent version, rights-attestation basis, review decision, duplicate family, personal-data scan, institution/course identifiers, allowed product uses, access policy, takedown status, and reward status. Contributor benefits are granted idempotently only after acceptance and can include simulation or marking credits, temporary premium access, or additional storage.

Access to institution libraries is determined by explicit entitlements and deterministic metadata filters. Semantic search does not assign institutions, authorize access, or determine eligibility. If later introduced, hybrid retrieval operates only inside an already-authorized institution/course/resource set.

`@public_library` is initially a search scope. A bounded parser may translate natural language into allowlisted institution, course, document-type, and year filters, after which deterministic metadata and lexical search run inside the authorized catalog. A selected result becomes a separately authorized resource scope; search results never contaminate a private study space automatically.

A public Atlas MCP is a later, read-only distribution surface over the governed library, not a launch dependency. Candidate capabilities include library search, resource metadata, course patterns, available topics, authorized region reads, and Atlas study deep links. It must enforce the same provenance, licensing, entitlement, takedown, tenant, rate-limit, and audit policies as the first-party application. Full copyrighted resources are not exposed unless their recorded allowed-use policy permits it.

Library withdrawal and takedown must immediately prevent new shared use while preserving the contributor's private copy only when they remain entitled to keep it. Derived institutional pattern snapshots need an explicit invalidation and recomputation policy when source eligibility changes.

## Context Plan

| Context | Mechanism | Loaded when | Trust treatment |
|---|---|---|---|
| User/tenant identity | Authenticated application state | Every request | Never accepted from model arguments |
| Source page/region | Resource record | Selected task | Untrusted uploaded evidence |
| Canonical concept | Storage/resource | Classification and learning | Versioned application data |
| Learner state | Storage | Tutor/remediation turn | Durable, tenant-scoped, host-updated |
| Recent interaction | Request prompt | Tutor turn | Trimmed untrusted text |
| Slash command | Deterministic command registry | Explicit user selection | Parsed and validated before routing; never model authorization |
| Mention token | Application entity resolver | Scope selection or bounded reference | Stable ID, fresh authorization, display label untrusted |
| Scope snapshot | Storage/resource | Study-space creation and every scoped turn | Immutable authorized resource versions and policy |
| Study space and progression plan | Storage | Resume, tutoring, remediation | Durable host-owned state; conversation-independent |
| Conversation summary | Derived storage | Only when relevant after thread rollover | Convenience context, never mastery authority |
| Universal tutor policy | System policy | Every tutor call | Reviewed and versioned |
| Pattern snapshot | Storage/resource | Exam generation | Immutable versioned input |
| Canonical solution | Storage/resource | Marking | Validated before use |
| Contribution consent and rights attestation | Storage | Contribution review | Versioned, explicit, auditable user declaration |
| Institution/course metadata | Storage/resource | Contribution, patterns, access | Detected and user-confirmed values kept separate |
| Approved library resource | Resource | Institution learning/simulation | Access-controlled; eligibility and takedown checked on every use |

## Capability Matrix

| Capability | Kind | Initiator | Access | Side effect | Verification |
|---|---|---|---|---|---|
| Ingest resource | Workflow | Application | Execute | Internal writes | Idempotency, schemas, counts, evidence anchors |
| Read evidence | Resource | Application | Read | None | Tenant and anchor validation |
| Route slash command | Deterministic code | User/UI | Execute | None or typed internal command | Registry, argument schema, active-state and route validation |
| Resolve resource mention | Resource | User/UI | Read | None | Stable ID, tenant/library authorization, status and version |
| Create/resume study space | Workflow | User/application | Execute | Internal writes | Scope snapshot, goal, idempotency, active-plan uniqueness and readback |
| Search public library | Routed workflow | User | Read | None | Allowlisted filters, entitlement, source eligibility and takedown status |
| Normalize concepts | Workflow | Application | Execute | Internal writes | Taxonomy version and confidence |
| Analyze patterns | Workflow | Application | Execute | Internal writes | Deterministic fixtures and snapshot hash |
| Produce tutor turn | Workflow | Application | Execute | Internal writes | Output schema and transition policy |
| Compute mathematics | Tool | Model | Execute | None | Typed operation and deterministic result |
| Render visualization | Tool | Model | Execute | None | Schema, expression, and renderer checks |
| Generate exam | Workflow | User | Execute | Internal writes | Blueprint, schema, solver, and totals |
| Mark exam | Workflow | User | Execute | Internal writes | Mark-scheme agreement and confidence |
| Create remediation | Workflow | Application | Execute | Internal writes | Canonical concept and evidence linkage |
| Submit contribution | Workflow | User | Write | Internal writes | Explicit consent, rights attestation, metadata confirmation, immutable submission |
| Review contribution | Workflow | Reviewer/application | Execute | Internal writes | Privacy, duplicate, rights, eligibility, metadata, and quality checks |
| Publish library resource | Workflow | Application | Write | Shared-library publication | Accepted review, access policy, provenance, and post-publication readback |
| Grant contributor benefit | Workflow | Application | Write | Internal entitlement | Accepted contribution ID, idempotency key, and entitlement readback |
| Read institution library | Resource | Application | Read | None | User entitlement, institution/course scope, source eligibility, and takedown status |

## Data and Trust Boundaries

- Tenancy: Private resources and learning records remain user-scoped. Approved library resources occupy a separately authorized shared-library scope; publication never changes ownership or authorization implicitly. Identity comes from the verified token.
- Sensitive data: Uploaded resources, scope selections, study-space history, answers, performance history, email, inferred weaknesses, institution/course metadata, optional declared affiliation, contribution consent, and review evidence.
- Sources: Private uploads, explicit contribution submissions, deterministic parsers, model outputs, student confirmations, reviewer decisions, student answers, and application taxonomy.
- Retention/deletion: Define cascading account deletion, contribution withdrawal, library takedown, entitlement reversal policy, and derived-snapshot invalidation before production; preserve only minimal versioned audit metadata without secrets.
- External services: Model provider and deployment runtime; Supabase can remain Auth, Postgres, and Storage initially.
- Untrusted boundaries: Documents, filenames, extracted text, detected institutional metadata, rights claims, model outputs, mathematical markup, tool arguments, and rendered HTML/SVG.

## Budgets and Stops

- Manifest budgets are absolute per-workflow-execution ceilings. Route configuration may only lower them. Initial, verification, repair, and tool-follow-up model calls all consume the same execution budget; a stage, branch, batch, or page boundary never resets it.
- Tutor turn: normally one model call; three maximum including tools/repair.
- Explicit navigation commands and mention resolution: zero model calls. Ambiguous natural-language routing: at most one bounded classification call followed by host validation.
- Ingestion: three model calls maximum per document execution, including verification and repair.
- Contribution checks: normally deterministic; two bounded model calls maximum for privacy/metadata assistance, never for final authorization.
- Exam generation: four calls maximum; marking: two.
- Tool rounds: two maximum.
- Interactive hard timeout: 60 seconds; background job attempt: five minutes.
- Cost and concurrency: tier-specific limits checked atomically; initial process-local parallel-branch ceiling is four and routes may lower it.
- Retry policy: Retry transient failures idempotently; allow one invalid-output repair, then fail or review.

## Failure and Approval Policy

- Missing information: Clarify or mark incomplete; never invent source content.
- Dependency failure: Preserve job state and offer safe retry.
- Partial results: Store draft artifacts but do not publish incomplete canonical records.
- Parallel branches: Declare stable branch names, required versus optional status, bounded concurrency, deterministic aggregation order, cancellation behavior, and whether completed outputs remain usable. Required-branch failure fails closed by default. Explicitly permitted partial results remain labelled degraded, retain branch errors, and cannot silently advance canonical state.
- Contribution failure: Keep the private resource usable by its owner, quarantine the submission, grant no reward, and disclose a reviewable reason.
- Environment inspection: Check identity, ownership, explicit consent, rights/eligibility state, library entitlement, takedown status, current workflow state, quota, and version before reads or writes.
- Postconditions: Read back and validate IDs, statuses, counts, publication visibility, entitlements, links, and transitions.
- Audit: Record workflow, prompt, model, schema, referenced inputs, outputs, validators, latency, tokens, cost, and status.

## Evaluation Plan

- Development dataset: `evals/datasets/development/` with reviewed documents, extraction truth, tutor turns, student answers, exam blueprints, questions, marking, and routing cases.
- Held-out dataset: `evals/datasets/held-out/`, isolated from prompt development.
- Deterministic graders: Command parsing, mention resolution, rename stability, active-plan idempotency, scope freezing, schema validity, transcription distance, field accuracy, segmentation, taxonomy, state transitions, exam totals, contribution consent, personal-data detection, exact/near duplicate detection, institution/course routing, library authorization, takedown enforcement, reward idempotency, and storage idempotency.
- Model graders: Pedagogical quality, hinting, explanation clarity, difficulty alignment, and feedback usefulness, calibrated against humans.
- Human review: Mathematics educators assess fidelity, correctness, exam validity, marking agreement, and tricky-question transfer; contribution reviewers assess eligibility, metadata, privacy, provenance, and quality.
- Metrics: Quality plus latency, calls, retries, tokens, cost, abstention, corrections, and tool failures.
- Critical thresholds: Zero tenant/library authorization leaks, cross-scope evidence contamination, model-authorized commands, publication without consent, accepted leaked or personally identifying content, premature rewards, unauthorized writes, silent source corruption, unsupported mastery promotion, invalid published schemas, accepted aggregates after required-branch failure, budget resets across stage/page boundaries, and unbounded execution.
- Reports: `evals/reports/<workflow>/<version>/report.html`.

## Rollout

- Build domain schemas, deterministic functions, and evaluation fixtures first.
- Freeze only the contract packs required by the next vertical slice; do not wait for unrelated assessment or network packs.
- Shadow new extraction, assessment, marking, institution detection, and duplicate/privacy checks beside current behavior without updating learner or library state.
- Start contributions with manual review, one or two institution/course pilots, conservative eligibility, and no automatic publication.
- Introduce the command registry and mention picker alongside existing navigation, measure discoverability and routing, then remove redundant mobile controls and make chat the authenticated landing shell only after journey parity passes.
- Replace topic-deduplicated recent sessions with study-space resume cards; keep the legacy Vault route available until resource management, scope selection, and start/resume parity are verified.
- Pilot first-party public-library search before exposing a read-only public MCP; add external access only after licensing, entitlement, protocol, abuse, and takedown gates pass.
- Roll out through internal fixtures, educators/reviewers, a small student cohort, then broader institution cohorts.
- Maintain per-workflow kill switches and last-known-good prompt/model/config versions.
- Run migration, reconciliation, shadowing, cohort enablement, rollback rehearsal, and legacy retirement per workflow throughout delivery rather than as one final programme event.

## Residual Risks

- Scans and handwritten mathematics may remain ambiguous.
- Teaching and grading remain probabilistic after validation.
- Curriculum taxonomy requires human governance.
- Resource copyright, contribution, retention, and reuse require separate review.
- Contributor rights attestations may be inaccurate; legal review and a responsive takedown process remain necessary.
- Institution and lecturer metadata can create privacy, reputational, endorsement, and misclassification risk.
- Incentives can attract spam, duplicates, manipulated documents, or leaked assessments.
- Desktop highlighting depends on accurate region extraction.

## Deferred Capabilities

| Capability | Reason excluded | Evidence needed to add it |
|---|---|---|
| General tool agent | Routes and transitions are known | Cases proving fixed/routed workflows cannot select valid tool sequences |
| Multi-agent system | No measured isolation benefit | Stable parent contract plus measured specialist gain |
| Broad RAG | Deterministic institution/course/resource filters and lexical lookup are more reliable initially | Retrieval evals showing authorized scoped lookup cannot find appropriate material |
| Web search | Outside resource-grounded scope | Approved sourced-information feature and citation evals |
| General code execution | Excess privilege | Reviewed tasks bounded math tools cannot handle |
| Prompt caching | Prompts and traffic are not stable | Telemetry proving repeated prefixes and savings |

## Specialist Skills for Implementation

### Python-agents reference boundary

`C:\Users\Lusa\python-agents` is a read-only teaching and implementation reference, not an Atlas package or runtime dependency. Atlas must not edit or directly import it. Implement the necessary patterns locally with provider-independent orchestration, thin model adapters, named validated chain steps, closed routing, bounded parallel aggregation, finite repair loops, matched tool-result IDs, and plain-function tests. Comments and docstrings explain intent, invariants, failure policy, and non-obvious constraints rather than restating code.

- `build-and-evaluate-vision-agents`: page/region evidence and OCR evaluation.
- `engineer-and-evaluate-prompts`: extraction interpretation, tutoring, generation, and marking evals.
- `build-anthropic-tool-agents`: only for bounded mathematics and visualization loops.
- `build-and-evaluate-rag-agents`: deferred until retrieval scale demonstrates need.

## Implementation Roadmap

The phased work breakdown, dependency graph, parallel lanes, orchestration rules, and segment exit gates are maintained in [`implementation-roadmap.md`](implementation-roadmap.md).
