import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('workflow tables enforce lifecycle, tenant, and idempotency invariants', async () => {
  const sql = await read('supabase/migrations/202609140001_create_platform_workflow_runtime.sql')
  for (const table of ['platform_commands', 'workflow_jobs', 'workflow_steps', 'outbox_events']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(sql, /unique \(tenant_id, idempotency_key\)/i)
  assert.match(sql, /check \(tenant_id = principal_id\)/i)
  assert.match(sql, /foreign key \(command_id, tenant_id\)/i)
  assert.match(sql, /foreign key \(job_id, tenant_id\)/i)
  assert.match(sql, /attempt_count <= max_attempts/i)
  assert.match(sql, /status = 'running' and lease_expires_at is not null/i)
  assert.doesNotMatch(sql, /create policy[^;]+using\s*\(true\)/is)
})

test('Postgres runtime uses database time, row locks, and atomic outbox writes', async () => {
  const jobs = await read('backend/atlas_api/postgres_jobs.py')
  assert.match(jobs, /select now\(\) as database_now/i)
  assert.match(jobs, /for update skip locked/i)
  assert.match(jobs, /on conflict \(tenant_id, idempotency_key\) do nothing/i)
  assert.match(jobs, /insert into public\.outbox_events/i)
  assert.match(jobs, /with self\._connection_factory\(\) as connection/i)
  assert.match(jobs, /never command payload/i)
})

test('outbox delivery is leased and explicitly at-least-once', async () => {
  const sql = await read('supabase/migrations/202609140001_create_platform_workflow_runtime.sql')
  const outbox = await read('backend/atlas_api/outbox.py')
  assert.match(sql, /publish_lease_token uuid/i)
  assert.match(sql, /publish_attempt_count between 0 and 20/i)
  assert.match(outbox, /for update skip locked/i)
  assert.match(outbox, /publish_attempt_count = event\.publish_attempt_count \+ 1/i)
  assert.match(outbox, /Consumers must deduplicate by event_id/i)
  assert.match(outbox, /publish_lease_token = %s/i)
  assert.match(outbox, /raise OutboxLeaseLost/i)
})
