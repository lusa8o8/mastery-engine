# S0 Risk Register

Scale: likelihood and impact are Low/Medium/High/Critical. Owners are capability owners, not named people.

| ID | Risk | Likelihood | Impact | Current control | Next control / owner |
|---|---|---:|---:|---|---|
| R-001 | Browser-bundled Anthropic secret through `VITE_ANTHROPIC_API_KEY` | High | Critical | Template warns against production use | Remove direct-browser path and verify deployed bundles/env; S1 Security |
| R-002 | Service-role writes trust caller-supplied user/resource IDs | High | Critical | Some client queries include `user_id` filters | Verify JWT server-side and derive principal/resource ownership; S1 Security |
| R-003 | Foundational schema/RLS/storage cannot be recreated | Certain | Critical | Newer simulator migrations exist | Capture remote schema safely, review, then create idempotent migrations and tests; S1 Data |
| R-004 | Extraction silently omits, invents or mis-segments questions | High | High | JSON parsing and non-empty check | Page accounting, schemas, evidence regions, confidence/review and OCR evals; S6 Ingestion |
| R-005 | Retry duplicates extracted questions | High | High | None observed | Job/idempotency keys and uniqueness/provenance constraints; S3/S6 |
| R-006 | Tutor escapes the selected paper’s scope | High | High | Prompt receives matching user questions | Persist resource scope and retrieve only authorized evidence; S2/S9 |
| R-007 | Model or student self-report advances unreliable mastery state | High | High | Manual layers and error classifier | Deterministic policy based on accepted attempt evidence; S9 Learning |
| R-008 | Exam JSON is malformed, unsolvable, copied or miscalibrated | High | High | JSON parse only | Blueprint/schema/solution/leakage validators plus bounded repair; S8/S10 |
| R-009 | Marking awards invented credit or routes to wrong topic | High | High | Conservative prompt and basic database checks | Marking schema, math checks, human-calibrated evals and canonical competency IDs; S10/S11 |
| R-010 | Exam-to-practice lineage is lost | Certain | Medium | Immediate UI handoff works | Durable remediation assignment linking simulation, result and objective; S11 |
| R-011 | Mobile regression during shell/page decomposition | Medium | High | Existing responsive UI works | Viewport visual/journey baselines and rollout flag; S5 Frontend |
| R-012 | Public library creates copyright, privacy or false-affiliation harm | Medium | Critical | Feature not implemented | Consent, rights, takedown, redaction, moderation and legal policy gate; S12 Library |
| R-013 | Cost/quota enforcement can be bypassed or races | High | High | Browser checks and tables | Atomic server-side entitlement reservation and budgets; S3 Platform |
| R-014 | No verified restorable production backup before migrations | Certain | Critical | Schema mutation is gated; live API reports no physical backups/PITR | Establish backup, restore to isolated target and record checks; S0 Owner |
| R-015 | Storage accepts types/sizes outside frontend checks | High | Medium | Browser filters five formats and 20 MB | Add bucket limits/MIME allow-list plus server validation in migrations; S1/S6 |
| R-016 | `messages` is exposed with RLS disabled | Certain | Critical | No effective database control observed | Enable RLS and add session-owner policies in a reviewed, tested S1 migration; S1 Security |
| R-017 | Authenticated storage policies allow reads/uploads with expression `true` | High | Critical | Bucket is private and filenames begin with user ID, but policy does not enforce it | Replace with bucket- and `auth.uid()` folder-scoped policies; add cross-tenant storage tests; S1 Security |

Risks close only with evidence (test, drill, reviewed policy or measured eval), not with an implementation claim.
