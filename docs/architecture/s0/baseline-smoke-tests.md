# Baseline Smoke Tests

These cases preserve what students can do today while making known weaknesses visible. Fixture IDs are fake and contain no student content.

| Case | Student-visible path | Deterministic expected result | Known baseline limitation |
|---|---|---|---|
| J-001 | Sign in → Home | Protected routes admit an authenticated user | Remote auth redirect configuration is unverified |
| J-002 | Upload named PDF/image ≤20 MB with assessment type | File is uploaded, paper row created, extraction called, success navigates to Vault | Upload+two LLM calls are synchronous; partial failure cleanup is absent |
| J-003 | Vault → All papers | Extracted topics across all papers are shown | “All papers” is a null UI filter, not a persisted study scope |
| J-004 | Vault → one paper | Topics/coverage are limited to that paper | New session does not persist selected paper |
| J-005 | Start topic/subtopic | Foundation session is inserted and `/engine/:encoded` opens | Route encoding is an implicit contract |
| J-006 | Home → Continue | Existing session ID is reused | Resume loads neither transcript nor persisted layer |
| J-007 | Tutor → Next layer | Layer advances in fixed sequence and persists current layer | Advancement is manual/model-led, not evidence-gated |
| J-008 | Patterns | Deterministic frequencies/positions/marks render; narrative is optional | Free-text taxonomy can split equivalent topics |
| J-009 | Generate exam | A generating row becomes generated with model JSON | No schema, solution or leakage validation |
| J-010 | Answer/resume exam | Answer text/flag and current question persist | Browser performs domain writes directly |
| J-011 | Submit and mark | Status moves through marking to marked, or explicit marking_failed | Claude result is parsed and persisted without strong validation |
| J-012 | Marked result → Practice | A foundation session opens for a fuzzy-matched extracted topic | No durable link to source simulation/result |

## Mandatory S1 security regression cases

- User A cannot select, insert, update or delete User B’s `messages` through a known session ID.
- User A cannot list, read, sign, overwrite or upload into User B’s storage prefix.
- Anonymous callers cannot invoke `atlas-extract` or `atlas-variant` successfully.
- A valid User A token cannot make an Edge Function write rows attributed to User B.

## Manual evidence capture template

For each live run record: case ID, app commit, environment alias (never secrets), viewport, timestamp, result, screenshot/trace path, and defect IDs. Use at least 390 px, 430 px, 768 px and 1440 px for the mobile-sensitive exam/tutor cases.

## Automated structural check

`npm run test:s0` verifies that every fixture has unique IDs and required fields, every declared route is represented, every feature flag is unique/default-off/kill-switchable, and no fixture contains live-looking UUIDs or email addresses. It does not pretend to replace authenticated browser and remote-infrastructure tests.
