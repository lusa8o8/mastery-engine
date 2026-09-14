# S2A common platform contracts

Status: **draft â€” consumers must not connect to live state until this pack is frozen**

In plain language, these files define the labels on the envelopes passed between
Atlas services. They do not implement tutoring, extraction, or exam behavior.

## Boundary decisions

- `principal_id` is the stable Supabase `auth.users.id`. Google and password
  sessions produce the same principal shape; `auth_method` is audit metadata.
- Atlas currently uses a personal tenant, so `tenant_id == principal_id` in
  `principal.v1` and commands. A multi-user institution tenant needs a new,
  reviewed schema rather than weakening this invariant.
- Idempotency belongs to the authenticated command boundary. Workflow steps use
  a separate stable `step_key` so retries cannot repeat a logical effect.
- Event payload versions and model-output versions are independent of their
  envelope versions.
- Auth return targets are accepted only after application code checks a configured
  origin allow-list and a relative Atlas path.
- Raw prompts, document content, secrets, provider tokens, and model responses do
  not belong in these common envelopes.

## Ownership and lifecycle

| Record | Sole writer | Retention/deletion rule |
| --- | --- | --- |
| Principal | Auth adapter | Derived per request; never independently deleted |
| Command | API command service | Retain with tenant audit history; reject duplicate idempotency keys |
| Workflow job/step | Job runtime | Retain terminal trace; tenant deletion removes or irreversibly anonymizes it |
| Model call | Model gateway | Retain metering/version metadata, not raw student content |
| Outbox event | Transactional repository + publisher acknowledgement | Retain delivery trace; payload follows owning aggregate retention |
| Audit event | Audit writer | Append-only; redact metadata and apply the approved tenant retention policy |
| Error | Producing boundary | Response only; durable diagnosis belongs in redacted logs/audit |

## Dependency rule

This pack imports no Atlas domain pack. S2Bâ€“S2E may import S2A; S2A must never
import them. Domain payload schemas remain opaque here to prevent circular
dependencies.

## Generate and test

```powershell
py contracts\s2a\generate.py
py -m unittest tests.s2a_contracts_test
node --test tests/s2a-contracts.test.mjs
```

`models.py` is the source of truth. CI fails when generated JSON Schema,
OpenAPI, or TypeScript artifacts drift from it.
