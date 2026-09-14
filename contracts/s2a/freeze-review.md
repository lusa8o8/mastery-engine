# S2A freeze review

Decision date: 14 September 2026
Decision: **accepted and frozen as version 1.0.0**

In plain language, the common envelopes are now stable enough for the new API
and worker to build against. This does not approve connecting that runtime to
production; S3 has its own security and recovery gate.

## Scenarios exercised

| Workflow | Shape proven here | Owned by a later pack |
| --- | --- | --- |
| Paper upload and extraction | Authenticated command, durable job/steps, bounded model-call record, event and audit trace | Resources, pages, regions, questions and extraction artifacts (S2B) |
| Tutor turn and resume | Authenticated interactive command, model call without a fake background job, request correlation and audit | Study spaces, sessions, episodes, turns, attempts and mastery (S2C) |
| Exam, marking and remediation | Correlated commands/jobs, versioned calls, chained events and fail-closed steps | Exam, marking and remediation records plus origin links (S2C/S2D) |

The machine-readable version is [`review-scenarios.json`](review-scenarios.json).

## Findings closed during review

- Added a separate tenant-scope record instead of asking every domain to infer
  scope from an email or authentication provider.
- Added a request ID to commands, jobs and model calls so interactive and
  background work share one trace boundary.
- Made model job/step IDs an all-or-nothing pair. Interactive tutor turns may
  omit both; background calls must provide both.
- Added job scheduling, cancellation request, leases, step versions, required
  step flags and bounded retry counts.
- Added state/timestamp invariants for jobs, steps and model calls.
- Added event correlation, causation and bounded publication attempts.
- Restricted audit metadata to a small scalar map and rejected key names likely
  to carry secrets, prompts, document content or student answers.
- Aligned typed error codes with permitted HTTP statuses.
- Aligned OAuth return validation with configured origins and allowlisted Atlas
  route prefixes.

## State ownership

| State | Only component allowed to write it | Verification |
| --- | --- | --- |
| Principal and tenant scope | Authentication/authorization adapter | JWT issuer, signature, audience, expiry and `sub`; scope resolves to the same personal tenant |
| Command envelope | API command boundary | Authenticated principal, payload-schema registry and unique tenant/idempotency key |
| Job and step state | Workflow runtime | Compare-and-set transition, active lease, attempt bound and read-back |
| Model-call metadata | Model gateway | Route allowlist, matched request/response, usage settlement and terminal status |
| Outbox event | Domain transaction; publisher may only acknowledge delivery | Event and domain write commit together; publisher records attempts and `published_at` |
| Audit event | Append-only audit writer | Sanitized allowlisted metadata and durable insert confirmation |

No model output is permitted to write these records directly.

## Lifecycle and deletion

- Principal and tenant scope are request-scoped values, not separately retained
  profiles.
- Commands, jobs, steps and outbox records remain while their owning tenant
  exists. Account deletion cancels active work, then removes these records with
  the tenant after bounded cleanup completes.
- Model-call records retain only operational/version/usage metadata, never raw
  prompts, source documents, student messages or outputs. They follow tenant
  deletion; anonymized aggregate billing metrics may remain without tenant IDs.
- Audit records retain the same no-content metadata for at most 180 days and are
  deleted earlier when the tenant is deleted. Longer legal retention requires a
  separately reviewed policy and schema.
- Error envelopes are responses, not stored records. Durable diagnosis uses the
  redacted audit/log boundary.

## Compatibility rules

- S2A has no Atlas pack dependencies. S2B-S2E may import S2A; the reverse is
  forbidden.
- Frozen v1 fields are not silently repurposed or removed. Compatible additions
  are optional; incompatible changes create a v2 contract and migration plan.
- JSON Schema and TypeScript describe portable wire shape. Pydantic remains the
  server authority for cross-field lifecycle and tenant invariants, which
  clients may not use as authorization evidence.
- Domain payloads remain opaque to S2A and must be validated through their own
  versioned schema registry before execution.

## Freeze gate result

- Ownership, tenant scope, lifecycle and deletion: pass.
- Python and JavaScript schema/fixture tests: pass.
- Normal, empty, partial, invalid and legacy fixtures: pass.
- Password/Google stable-principal contract: pass.
- Origin and application return-path rejection: pass.
- Dependency declaration and circular-dependency check: pass.
- Unresolved common writers: none.

Residual work belongs to S2B/S2C/S2D or S3 and does not require changing S2A.
