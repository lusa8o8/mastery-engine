# Current-State Inventory

Captured from the repository at `f4313d8c801f2b2d1bbf7ac0ee0c06a362ca497f` and the linked Supabase project on 2026-09-12. No row contents or secret values were captured.

## Live deployment facts

| Item | Observed value |
|---|---|
| Supabase link | Confirmed against the intended project |
| Region | `eu-central-1` |
| Supabase CLI | `2.109.1` |
| PostgREST schema version | `14.5` |
| Remote migrations | All five local migrations are applied; no remote-only migration versions reported |
| Database lint | No schema errors reported for `public` or `extensions` |
| Backups | WAL-G enabled; PITR disabled; no physical backups reported |
| Vercel project | `mastery-engine` in the authenticated Hobby team |
| Production domain | `solvd.trymyapp.uk` |
| Vercel project variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; both apply to all environments |

## Application boundary

Atlas is a Vite/React single-page application hosted with a catch-all Vercel rewrite. Authentication, database access and file storage are called directly from the browser through Supabase. Three Supabase Edge Functions proxy Claude calls.

| Area | Current implementation | Production-readiness note |
|---|---|---|
| Frontend | React 18, React Router 6, Vite 7 | No CI, automated UI suite or error boundary is present. |
| Hosting | Vercel project `mastery-engine`; SPA rewrite to `/`; custom domain `solvd.trymyapp.uk` | The deployment is visible in the dashboard, but this checkout has no `.vercel/project.json` link. |
| Auth | Supabase email/password; route-level `ProtectedRoute` | Local `site_url` is port 3000 while Vite defaults to 5173. Deployed redirect allow-list is unverified. |
| Data | Browser uses Supabase anon client | Correctness and authorization depend heavily on remote RLS that is not fully represented by migrations. |
| Files | Browser uploads to a `papers` bucket and creates one-hour signed URLs | Bucket creation, limits and storage policies are missing from migrations. |
| Models | `atlas-chat`, `atlas-extract`, `atlas-variant` call Anthropic | Functions accept caller-provided identity/context; authentication is not established inside the function code. |
| Tests | S0 structural controls only | There was no test/eval directory or test script before S0. |

## Routes

| Route | Protection | Responsibility |
|---|---|---|
| `/` | Public | Landing page |
| `/auth` | Public | Sign up and sign in |
| `/home` | Authenticated | Navigation, recent topic sessions and token summary |
| `/upload` | Authenticated | Upload and synchronous extraction |
| `/vault` | Authenticated | All/single-paper filter, topic coverage and session creation |
| `/patterns` | Authenticated | Deterministic pattern summaries, AI narrative, simulator history/quota |
| `/simulate` | Authenticated | Generate a pattern-based exam |
| `/simulate/:simulationId` | Authenticated | Resume, answer, submit, mark and review an exam |
| `/engine/:topic` | Authenticated | Tutor chat; the path segment encodes `topic__subType__sessionId` |
| `/summary` | Authenticated | Session/attempt summary |
| `/progress` | Authenticated | Learner progress |
| `*` | Redirect | Redirect to `/` |

## Database inventory

### Represented by migrations

| Table | Migration coverage | RLS represented |
|---|---|---|
| `exam_simulations` | Create plus later marking columns | Select/insert/update/delete by `auth.uid() = user_id` |
| `exam_simulation_answers` | Create | Select/insert/update/delete by `auth.uid() = user_id` |
| `exam_simulation_marking_results` | Create | Select/insert/update/delete by `auth.uid() = user_id` |
| `user_entitlements` | Create | User-select only |
| `token_logs` | Only cost columns/index | Base table and its policies are missing |

### Required by code but absent from migrations

| Resource | Observed use |
|---|---|
| `papers` | Upload metadata, rename, paper metadata, pattern source |
| `questions` | Extracted question store, Vault, Patterns, tutor context |
| `sessions` | Recent sessions, layer state, summaries, exam remediation handoff |
| `messages` | Tutor transcript writes |
| `attempts` | Correctness/error records and coverage |
| `token_logs` base table | Browser/server usage accounting |
| Storage bucket `papers` | Private document upload and signed retrieval |

All ten listed application tables exist remotely. Generated types confirmed their columns and foreign-key relationships. The dashboard supplied the live RLS inventory below. However, exact legacy table creation SQL, constraints, triggers and grants remain absent from the repository. A full schema dump could not be produced because this machine does not have Docker, which the Supabase CLI requires for `db dump`.

Important live shape observations:

- `papers`, `questions`, `sessions` and `token_logs` allow nullable `user_id` according to generated types.
- `attempts` and `messages` have no direct `user_id`; tenant isolation must traverse `session_id` policies correctly.
- `exam_simulations`, its answers/results, and `user_entitlements` require a `user_id`.
- The generated schema contains no public views, RPC functions or enums.
- The database linter finding no SQL errors does **not** prove tenant authorization is correct.

### Live RLS inventory

| Table | RLS | Policies observed | Baseline assessment |
|---|---:|---|---|
| `attempts` | Enabled | `Users own their attempts` — ALL, public; session belongs to `auth.uid()` | Indirect ownership; must be regression-tested |
| `exam_simulation_answers` | Enabled | Separate SELECT/INSERT/UPDATE/DELETE user policies | Represented by migrations |
| `exam_simulation_marking_results` | Enabled | Separate SELECT/INSERT/UPDATE/DELETE user policies | Represented by migrations |
| `exam_simulations` | Enabled | Separate SELECT/INSERT/UPDATE/DELETE user policies | Represented by migrations |
| `messages` | **Disabled** | None | **Critical: dashboard warns the table is Data API accessible** |
| `papers` | Enabled | `Users own their papers` — ALL, public; `auth.uid() = user_id` | Missing from migrations |
| `questions` | Enabled | `Users own their questions` — ALL, public; `auth.uid() = user_id` | Missing from migrations |
| `sessions` | Enabled | `Users own their sessions` — ALL, public; `auth.uid() = user_id` | Missing from migrations |
| `token_logs` | Enabled | `Users own their token logs` — ALL, public; `auth.uid() = user_id` | Missing base migration |
| `user_entitlements` | Enabled | User SELECT policy | Represented by migrations |

“Public” above is the PostgreSQL policy target role. The expression still restricts rows where shown. `messages` has neither RLS nor a policy, which is materially different and requires an immediate S1 migration.

## Edge Functions and model routes

| Function | Model path | Current responsibility | Reliability/security observation |
|---|---|---|---|
| `atlas-extract` v4 | Claude Haiku 4.5, two sequential calls | Question extraction, then paper metadata extraction, then service-role writes | Active with platform JWT verification **disabled**. Whole document is independently sent twice. Output has JSON parsing but no schema/domain validator, page accounting, idempotency or source regions. Caller supplies paper ID, URL and user ID. |
| `atlas-chat` v9 | Haiku normally; Sonnet 4.6 for `exam_simulation` and `exam_marking` | Tutor turns, pattern narrative, exam generation, marking and summaries | Active with platform JWT verification enabled. The function code still does not derive and authorize the principal before trusting browser-supplied context/session/user IDs. One endpoint multiplexes unrelated reliability classes. |
| `atlas-variant` v1 | Claude Haiku 4.5 | Generate a slightly harder practice variant | Active with platform JWT verification **disabled**. No durable provenance, validation or bounded comparison against source scope. |
| Browser `src/api/llm.js` | Claude Haiku 4.5 | Legacy direct LLM helper | Reads `VITE_ANTHROPIC_API_KEY` and enables direct-browser Anthropic access. This must not be populated in production. |

Function versions and deployment hashes were observed through the management API; hashes are intentionally not copied into this human-facing inventory.

## Secrets and environment variable names

Values were deliberately not captured.

| Name | Intended boundary | Status |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser-visible | Present in Vercel for all environments |
| `VITE_SUPABASE_ANON_KEY` | Browser-visible | Present in Vercel for all environments; safety relies on RLS |
| `VITE_ANTHROPIC_API_KEY` | Browser-visible legacy path | Not present in the Vercel project inventory; keep unset/remove code path in S1 |
| `ANTHROPIC_API_KEY` | Edge Function secret | Required by all three functions |
| `SUPABASE_URL` | Edge Function environment | Required by service-role clients |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secret | Required by chat logging/extraction; never expose to Vite |

The linked function secret registry confirms `ANTHROPIC_API_KEY` and the Supabase-provided URL/key names are present. Vercel exposes only the two expected Supabase browser variables. Only names/presence were recorded; no “Reveal Value” action was used. `.env`, `.env.local`, and `.env*.local` are ignored; `.env.example` contains names/placeholders only.

## Storage

One live bucket exists:

| Bucket | Public | File-size limit | MIME allow-list | Migration coverage |
|---|---:|---:|---|---|
| `papers` | No | None configured | None configured | Missing |

The frontend enforces 20 MB and five extensions, but the bucket itself does not enforce those limits.

Two policies exist on `storage.objects`, both for the `authenticated` role:

| Policy | Command | Expression | Assessment |
|---|---|---|---|
| `authenticated read 1ikfdyf_0` | SELECT | `true` | **Critical: not restricted by bucket or user folder** |
| `authenticated upload 1ikfdyf_0` | INSERT | `true` | **Critical: not restricted by bucket or user folder** |

The bucket is private, but these policies allow any authenticated user through their respective operation without tenant scoping. There are no bucket-table policies and no bucket-specific policy group shown for `papers`.

## Product-state observations

- Upload accepts PDF, JPG/JPEG, PNG and WebP up to 20 MB per file. Files are processed sequentially, but upload and extraction form one synchronous UI operation.
- Vault’s “All papers” filter changes only discovery/coverage. Starting a session persists topic, subtype and layer, but not selected paper, so tutoring fetches that subtype across every user paper.
- Tutor progression is `foundation → drills → patterns → traps → pressure → recall`; the student can manually advance it. The model assesses answers, while the student self-classifies correctness/error for durable attempts.
- A tutor turn sends only the six most recent in-memory messages. Resume does not load stored messages or stored layer and creates a generic welcome message.
- Patterns are mostly calculated deterministically in the browser. The optional narrative is model-generated.
- Exam generation stores a pattern snapshot, asks Claude for JSON, parses it directly and stores it. Marking also parses Claude JSON directly and writes results from the browser.
- Exam “Practice” fuzzy-matches model-produced topic text against extracted topics, creates a new generic foundation session and navigates to Atlas. It does not retain the simulation/question/marking-result link.

## External deployment inventory still required

1. Exact grants, triggers and constraints for the six legacy resources through a reviewed schema dump.
2. A restorable logical/physical backup and isolated restore evidence.
3. A local `.vercel` link if future CLI-based deployment operations are desired; this is not required to document the current deployment.
