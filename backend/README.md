# Atlas backend

This package is the fixture-backed beginning of S3. It is deliberately locked
by default and has no database, Supabase JWT, model-provider, or production
connection yet.

In plain language: the front door and its safety rules now exist, but it is not
wired to the building.

## Current behavior

- `/health/live` confirms only that the process is running.
- `/health/ready` returns a typed `503` until every injected dependency is ready.
- `/v1/whoami` requires a bearer token and returns the frozen S2A principal.
- Every response receives a UUID request ID.
- Validation, authentication, missing-route and unexpected errors use the S2A
  error envelope without reflecting submitted values or exception text.
- The fixture authenticator must be injected by tests and is rejected when the
  runtime mode is `production`.

## Local locked process

```powershell
python -m uvicorn backend.atlas_api.main:app --host 127.0.0.1 --port 8000
```

This command is useful only for liveness and fail-closed checks. Do not add a
shared development token. Authenticated local testing uses `TestClient` and
explicit principal fixtures.

## Still required before live integration

- Supabase JWT verification with pinned issuer/audience/algorithm and bounded
  JWKS refresh behavior.
- Postgres repositories, idempotency transactions, durable jobs and outbox.
- Model gateway, usage/cost limits and provider timeout classification.
- Structured redacted telemetry and audit persistence.
- S3 crash, retry, cancellation, authorization and tenant-isolation gates.
