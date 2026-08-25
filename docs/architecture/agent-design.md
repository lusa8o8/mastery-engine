# Agent Design: Atlas Learning System

## Decision Summary

- Objective: Turn uploaded mathematics resources into reliable progressive teaching, assessment, exam simulation, and evidence-linked remediation.
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

### Explicit Exclusions

- One general agent with every database and tool capability.
- Autonomous multi-agent delegation.
- Open-ended web search or unsourced curriculum expansion.
- Conversation history as durable learner state.
- Model-owned mastery promotion without a host policy.
- Canonical publication of low-confidence extraction without review.
- Broad curriculum RAG in the first revision.

### Users and Interfaces

- Students use a responsive web application on mobile and desktop.
- Desktop may show the source page and highlighted active region beside Atlas.
- Mobile keeps the current chat-first layout with an optional question crop or source drawer.
- Internal reviewers inspect low-confidence extraction and evaluation failures.

## Success Contract

- Expected inputs: Authenticated user, uploaded resource, selected learning scope, learner response, or submitted simulation.
- Required outputs: Validated records, evidence-linked tutor turn, explicit learner-state decision, validated exam, marking result, or remediation assignment.
- Success metrics: Extraction fidelity, grounding, mathematical correctness, grading agreement, progression precision, exam validity, latency, calls, and cost.
- Critical failures: Tenant leak; corrupted source question; false teaching accepted as correct; unsupported mastery promotion; invalid exam; silent extraction loss; unbounded loop.
- Clarification conditions: Ambiguous region, unreadable source, unmatched concept, incomplete answer, or conflicting evidence.
- Abstention conditions: Evidence cannot be recovered or verified above the workflow threshold.

## Architecture

Atlas remains one product identity, not one runtime agent. An authenticated API selects an allowlisted workflow from an explicit UI action. No model chooses between product workflows.

```text
Student UI (mobile chat or desktop resource-focus)
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
                         |                          |
                         +----> Remediation <-------+
                                      |
                                      v
                              New Atlas objective
```

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

Patterns stays deterministic. It operates on normalized, reviewable records and creates immutable versioned snapshots. Inputs include canonical concept IDs, question hierarchy, marks, position, assessment type, and extraction confidence. Low-confidence data is excluded or weighted explicitly.

### Progressive Learning Workflow

The host owns the state machine:

```text
diagnose -> teach -> worked example -> guided attempt -> independent attempt
         -> exam-level attempt -> tricky transfer attempt -> retain/remediate
```

The six existing layer names can remain, but advancement depends on structured evidence rather than a manual Next button. Each tutor turn returns pedagogical content, source anchors, answer assessment, error type, confidence, learner-state proposal, next activity, and an allowed transition. The host validates and writes state.

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

## Context Plan

| Context | Mechanism | Loaded when | Trust treatment |
|---|---|---|---|
| User/tenant identity | Authenticated application state | Every request | Never accepted from model arguments |
| Source page/region | Resource record | Selected task | Untrusted uploaded evidence |
| Canonical concept | Storage/resource | Classification and learning | Versioned application data |
| Learner state | Storage | Tutor/remediation turn | Durable, tenant-scoped, host-updated |
| Recent interaction | Request prompt | Tutor turn | Trimmed untrusted text |
| Universal tutor policy | System policy | Every tutor call | Reviewed and versioned |
| Pattern snapshot | Storage/resource | Exam generation | Immutable versioned input |
| Canonical solution | Storage/resource | Marking | Validated before use |

## Capability Matrix

| Capability | Kind | Initiator | Access | Side effect | Verification |
|---|---|---|---|---|---|
| Ingest resource | Workflow | Application | Execute | Internal writes | Idempotency, schemas, counts, evidence anchors |
| Read evidence | Resource | Application | Read | None | Tenant and anchor validation |
| Normalize concepts | Workflow | Application | Execute | Internal writes | Taxonomy version and confidence |
| Analyze patterns | Workflow | Application | Execute | Internal writes | Deterministic fixtures and snapshot hash |
| Produce tutor turn | Workflow | Application | Execute | Internal writes | Output schema and transition policy |
| Compute mathematics | Tool | Model | Execute | None | Typed operation and deterministic result |
| Render visualization | Tool | Model | Execute | None | Schema, expression, and renderer checks |
| Generate exam | Workflow | User | Execute | Internal writes | Blueprint, schema, solver, and totals |
| Mark exam | Workflow | User | Execute | Internal writes | Mark-scheme agreement and confidence |
| Create remediation | Workflow | Application | Execute | Internal writes | Canonical concept and evidence linkage |

## Data and Trust Boundaries

- Tenancy: Every resource, extraction run, session, attempt, exam, result, and remediation record is user-scoped. Identity comes from the verified token.
- Sensitive data: Uploaded resources, answers, performance history, email, and inferred weaknesses.
- Sources: Uploads, deterministic parsers, model outputs, student answers, and application taxonomy.
- Retention/deletion: Define cascading account deletion before production; preserve only minimal versioned audit metadata without secrets.
- External services: Model provider and deployment runtime; Supabase can remain Auth, Postgres, and Storage initially.
- Untrusted boundaries: Documents, filenames, extracted text, model outputs, mathematical markup, tool arguments, and rendered HTML/SVG.

## Budgets and Stops

- Tutor turn: normally one model call; three maximum including tools/repair.
- Ingestion: three model calls maximum per document stage.
- Exam generation: four calls maximum; marking: two.
- Tool rounds: two maximum.
- Interactive hard timeout: 60 seconds; background job attempt: five minutes.
- Cost and concurrency: tier-specific limits checked atomically.
- Retry policy: Retry transient failures idempotently; allow one invalid-output repair, then fail or review.

## Failure and Approval Policy

- Missing information: Clarify or mark incomplete; never invent source content.
- Dependency failure: Preserve job state and offer safe retry.
- Partial results: Store draft artifacts but do not publish incomplete canonical records.
- Environment inspection: Check identity, ownership, current state, quota, and version before writes.
- Postconditions: Read back and validate IDs, statuses, counts, links, and transitions.
- Audit: Record workflow, prompt, model, schema, referenced inputs, outputs, validators, latency, tokens, cost, and status.

## Evaluation Plan

- Development dataset: `evals/datasets/development/` with reviewed documents, extraction truth, tutor turns, student answers, exam blueprints, questions, marking, and routing cases.
- Held-out dataset: `evals/datasets/held-out/`, isolated from prompt development.
- Deterministic graders: Schema validity, transcription distance, field accuracy, segmentation, taxonomy, state transitions, exam totals, duplicates, routing, authorization, and idempotency.
- Model graders: Pedagogical quality, hinting, explanation clarity, difficulty alignment, and feedback usefulness, calibrated against humans.
- Human review: Mathematics educators assess fidelity, correctness, exam validity, marking agreement, and tricky-question transfer.
- Metrics: Quality plus latency, calls, retries, tokens, cost, abstention, corrections, and tool failures.
- Critical thresholds: Zero tenant leaks, unauthorized writes, silent source corruption, unsupported mastery promotion, invalid published schemas, and unbounded execution.
- Reports: `evals/reports/<workflow>/<version>/report.html`.

## Rollout

- Build domain schemas, deterministic functions, and evaluation fixtures first.
- Shadow new extraction, assessment, and marking beside current behavior without updating learner state.
- Roll out through internal fixtures, educators, a small student cohort, then broader cohorts.
- Maintain per-workflow kill switches and last-known-good prompt/model/config versions.

## Residual Risks

- Scans and handwritten mathematics may remain ambiguous.
- Teaching and grading remain probabilistic after validation.
- Curriculum taxonomy requires human governance.
- Resource copyright, contribution, retention, and reuse require separate review.
- Desktop highlighting depends on accurate region extraction.

## Deferred Capabilities

| Capability | Reason excluded | Evidence needed to add it |
|---|---|---|
| General tool agent | Routes and transitions are known | Cases proving fixed/routed workflows cannot select valid tool sequences |
| Multi-agent system | No measured isolation benefit | Stable parent contract plus measured specialist gain |
| Broad RAG | Direct scoped resource lookup is enough initially | Retrieval evals showing scale requires indexing/ranking |
| Web search | Outside resource-grounded scope | Approved sourced-information feature and citation evals |
| General code execution | Excess privilege | Reviewed tasks bounded math tools cannot handle |
| Prompt caching | Prompts and traffic are not stable | Telemetry proving repeated prefixes and savings |

## Specialist Skills for Implementation

- `build-and-evaluate-vision-agents`: page/region evidence and OCR evaluation.
- `engineer-and-evaluate-prompts`: extraction interpretation, tutoring, generation, and marking evals.
- `build-anthropic-tool-agents`: only for bounded mathematics and visualization loops.
- `build-and-evaluate-rag-agents`: deferred until retrieval scale demonstrates need.
