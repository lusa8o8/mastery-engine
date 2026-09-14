# Atlas backend

This package is the incremental S3 platform runtime. It is deliberately locked
by default; production mode enables bounded Supabase JWT verification while
database and model-provider wiring remain separate release gates.

In plain language: the secure front door and the checked job-request counter now
exist, but production deployment and the model-powered rooms are not wired yet.

## Current behavior

- `/health/live` confirms only that the process is running.
- `/health/ready` returns a typed `503` until every injected dependency is ready.
- `/v1/whoami` requires a bearer token and returns the frozen S2A principal.
- Every response receives a UUID request ID.
- Validation, authentication, missing-route and unexpected errors use the S2A
  error envelope without reflecting submitted values or exception text.
- The fixture authenticator must be injected by tests and is rejected when the
  runtime mode is `production`.
- Production authentication accepts only locally verified Supabase ES256 or
  RS256 user tokens from the configured project. Issuer, audience, role and
  authentication method are checked before a personal tenant principal exists.
- Public signing keys are fetched with a five-second default timeout, a 256 KiB
  response cap and a ten-minute maximum application cache. New key IDs may cause
  a throttled refresh; unavailable discovery fails closed with a typed `503`.
- `atlas_api/jobs.py` defines tenant-scoped command idempotency, explicit job
  transitions, bounded attempts, leased claims, stale-worker rejection,
  cooperative cancellation, and review routing. Its in-memory repository is a
  fixture adapter, not an application runtime option.
- `atlas_api/postgres_jobs.py` preserves those rules in durable transactions,
  uses PostgreSQL time and `FOR UPDATE SKIP LOCKED`, and writes state events to
  the outbox before the transaction commits.
- `atlas_api/outbox.py` leases events for bounded at-least-once publication.
  Downstream consumers must deduplicate by the stable event ID.
- `atlas_api/worker.py` and `atlas_api/publisher.py` provide bounded batches,
  allowlisted version routing, independent postcondition verification, hard
  handler timeouts, lease safety margins, retry classification and sanitized
  traces. Unknown routes fail closed; poisoned events are retained as dead
  letters instead of blocking the queue.
- `POST /v1/commands` accepts only registered command and payload versions. The
  client cannot supply identity, tenant, request, command or job IDs; the API
  derives them from verified application state and checks the stored result.
- Command writes require an `Idempotency-Key`. Repeating the same tenant-scoped
  intent returns one job, while reusing the key for different intent returns a
  typed conflict. The route remains locked until a durable service and explicit
  command allowlist are injected.
- Self-cleaning live probes have passed both password and Google Supabase JWT
  paths through the same principal contract and durable Postgres command
  submission, replay and conflict behavior. These probes prove the boundary;
  they do not turn on product-route command handling.
- Registered workers may attach a route-specific Pydantic result contract.
  Successful output is validated and stored with job completion and its outbox
  event in one transaction; invalid output fails without result persistence.
- `GET /v1/jobs/{job_id}` returns a durable job snapshot and accepted result
  through the authenticated tenant boundary. Missing and foreign IDs both
  return `NOT_FOUND`; browser roles cannot query the underlying result table.
- A tenant-scoped option on outbox claims keeps shared-project probes from
  consuming unrelated events. Production publishers remain global by default.

## Local locked process

```powershell
python -m uvicorn backend.atlas_api.main:app --host 127.0.0.1 --port 8000
```

This command is useful only for liveness and fail-closed checks. Do not add a
shared development token. Authenticated local testing uses `TestClient` and
explicit principal fixtures.

## Still required before live integration

- Deployment entrypoints, graceful shutdown and readiness for continuously
  running worker and publisher processes.
- Production construction and injection of the Postgres command service for
  real product routes.
- Frontend submission and bounded result polling through the authenticated API,
  verified under both password and Google sessions.
- Model gateway, usage/cost limits and provider timeout classification.
- Structured redacted telemetry and audit persistence.
- S3 crash, retry, cancellation, authorization and tenant-isolation gates.
