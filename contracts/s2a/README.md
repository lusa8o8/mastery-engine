# S2A common platform contracts

Status: **frozen as version 1.0.0 - S3 may build against it, but may not connect
to production until the S3 gate passes**

In plain language, these files define the labels on the envelopes passed between
Atlas services. They do not implement tutoring, extraction, or exam behavior.

## Boundary decisions

- `principal_id` is the stable Supabase `auth.users.id`. Google and password
  sessions produce the same principal shape; `auth_method` is audit metadata.
- `tenant_scope.v1` is resolved by trusted application code after authentication;
  a client or model cannot grant itself a different scope.
- Atlas currently uses a personal tenant, so `tenant_id == principal_id` in
  v1 identity and command contracts. A multi-user institution tenant needs a
  new, reviewed schema rather than weakening this invariant.
- Idempotency belongs to the authenticated command boundary. Workflow steps use
  a separate stable `step_key` so retries cannot repeat a logical effect.
- Event payload versions and model-output versions are independent of their
  envelope versions.
- Auth return targets are accepted only after application code checks configured
  origin and application-route allowlists.
- Raw prompts, document content, secrets, provider tokens, model responses and
  student answers do not belong in these common envelopes or audit metadata.

## Ownership and lifecycle

| Record | Sole writer | Retention/deletion rule |
| --- | --- | --- |
| Principal | Auth adapter | Derived per request; never independently retained |
| Tenant scope | Authorization adapter | Derived per request; never independently retained |
| Command | API command service | Retain with tenant; reject duplicate tenant/idempotency keys |
| Workflow job/step | Job runtime | Retain terminal trace; tenant deletion cancels active work and removes it |
| Model call | Model gateway | Retain metering/version metadata without content; remove with tenant |
| Outbox event | Transactional repository + publisher acknowledgement | Retain delivery trace; payload follows owning aggregate retention |
| Audit event | Audit writer | Append-only for at most 180 days; delete earlier with tenant |
| Error | Producing boundary | Response only; durable diagnosis belongs in redacted logs/audit |

## Dependency rule

This pack imports no Atlas domain pack. S2B-S2E may import S2A; S2A must never
import them. Domain payload schemas remain opaque here to prevent circular
dependencies.

## Generate and test

```powershell
py contracts\s2a\generate.py
python tests\s2a_contracts_test.py
node --test tests\s2a-contracts.test.mjs
```

`models.py` is the source of truth. CI fails when generated JSON Schema,
OpenAPI, or TypeScript artifacts drift from it.

See [`freeze-review.md`](freeze-review.md) for the scenario review, exact writer
boundaries, retention/deletion decisions, compatibility policy and gate result.
