# Architecture Decision Log

These are the accepted programme-level decisions that constrain S0 and the next stages.

| ID | Decision | Status |
|---|---|---|
| ADR-0001 | Preserve current student journeys behind flags while internals change | Accepted |
| ADR-0002 | Use deterministic orchestration with bounded model steps | Accepted |
| ADR-0003 | Start with one modular service and Postgres-backed jobs | Accepted |
| ADR-0004 | Treat `python-agents` as a read-only design reference | Accepted |
| ADR-0005 | Prefer canonical/lexical filters over RAG for authoritative paper scope | Accepted |

## Decision details

### ADR-0001 — Preserve the experience

Keep the working mobile tutor and simulator journeys available while replacing internals behind independent, default-off kill switches. Route/page retirement happens only after replacement parity is measured.

### ADR-0002 — Deterministic orchestration

Code owns authentication, authorization, state transitions, validation, persistence, retries and budgets. Models perform bounded interpretation, teaching, generation or assessment. Model output is untrusted until validated, and loops have explicit limits.

### ADR-0003 — Boring deployment first

Begin with one modular application service and a worker using Postgres-backed durable jobs. Add Railway or another long-running host when required by measured workload; do not begin with microservices, Redis or event streaming.

### ADR-0004 — Read-only Python reference

`C:\Users\Lusa\python-agents` informs workflow naming, tool contracts, validation, retry limits and eval structure. Atlas neither edits it nor imports it at runtime. Atlas implementation remains native to this repository.

### ADR-0005 — Scope before similarity

Paper IDs, question IDs, regions, canonical concepts and deterministic filters define authorized learning scope. Lexical search supports discovery. Semantic retrieval is optional only where measured recall warrants it; it cannot decide authorization, provenance or resource scope.

New decisions use the next numeric ID and record context, decision, alternatives, consequences, owner and date.
