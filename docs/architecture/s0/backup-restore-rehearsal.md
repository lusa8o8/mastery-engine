# Backup and Restore Rehearsal

Status: **PASS WITH ACCEPTED SCOPE LIMITATION**
Recorded: 2026-09-12

## Live findings

- The checkout is linked to the confirmed intended project.
- Region: `eu-central-1`.
- Physical backup API: WAL-G enabled, PITR disabled, zero backups returned.
- `supabase db dump --linked --schema public,storage` was attempted read-only and failed before dumping because Docker Desktop is not installed.
- PostgreSQL 17.11 portable client tools were then used against the PostgreSQL 17.6 source.
- A transactionally consistent custom-format logical backup of the `public` schema was created and restored into a temporary local PostgreSQL cluster.
- The local rehearsal server was stopped cleanly and its data directory retained with the backup evidence.

Atlas now has evidence of a restorable application-schema backup. The accepted limitation is that this is not a complete Supabase disaster-recovery image: Auth identities and Storage file bodies are excluded. The current users are disposable test accounts, and uploaded files have separate backups.

## Safe completion procedure

Never paste credentials into documentation or shell history.

1. Put `SUPABASE_DB_PASSWORD` in `.env.local`; never paste it into documentation or shell history.
2. Run `powershell -ExecutionPolicy Bypass -File .\scripts\s0-backup-restore-rehearsal.ps1` immediately before schema work.
3. Restore into a new isolated rehearsal database — never over production.
4. Compare schema, row counts and deterministic checksums for critical tables; confirm auth/storage recovery strategy and run read-only smoke queries.
5. Record start/end time, backup identifier, restore target alias, operator, results and retention decision below.
6. Have a second reviewer accept the evidence before S1 production migration begins.

## Evidence record

| Field | Value |
|---|---|
| Source project confirmed | Yes — intended linked project |
| Backup/PITR capability | WAL-G enabled; PITR off; zero physical backups reported |
| Backup identifier and timestamp | `20260912-181120/atlas-public.dump`; 2026-09-12 18:11 SAST |
| Archive SHA-256 | `6231AF456E223D473219BB7DB1F76F816223607C80BDC3A64961A3A1C2441795` |
| Isolated restore target | Local PostgreSQL 17.11 database `atlas_restore_verified`; stopped after test |
| Schema comparison | Match: 10 tables, 15 foreign keys, 9 RLS-enabled tables, 18 policies |
| Critical table counts/checksums | Exact row-count match for all 10 tables; archive checksum recorded above |
| Storage/auth recovery notes | Accepted limitation: Auth identities and Storage file bodies excluded; local Auth stand-in contained one referenced test identity; uploaded files are separately backed up |
| Restore smoke result | Pass: pre-data, data and post-data restored; foreign keys and policies applied successfully |
| Reviewer | Codex automated verification; owner accepted the limited scope on 2026-09-12 |

### Row-count comparison

| Table | Live | Restored |
|---|---:|---:|
| `attempts` | 9 | 9 |
| `exam_simulation_answers` | 13 | 13 |
| `exam_simulation_marking_results` | 13 | 13 |
| `exam_simulations` | 2 | 2 |
| `messages` | 0 | 0 |
| `papers` | 18 | 18 |
| `questions` | 497 | 497 |
| `sessions` | 39 | 39 |
| `token_logs` | 171 | 171 |
| `user_entitlements` | 0 | 0 |

Backup artifacts are intentionally outside Git at `C:\Users\Lusa\AtlasBackups\mastery-engine\20260912-181120`. They contain application data and must not be committed or shared casually.

## S1 migration safety rule

Every planned migration must be additive or have a documented forward-fix. Destructive cleanup waits until the compatibility window closes. The restore rehearsal is an emergency control, not the routine rollback mechanism.
