import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const readText = path => readFile(new URL(path, import.meta.url), 'utf8')

test('critical journey fixtures are complete, unique and synthetic', async () => {
  const dataset = await readJson('../evals/datasets/development/current-system/journeys.json')
  assert.equal(dataset.schema_version, 1)
  assert.equal(dataset.privacy, 'synthetic-only')
  assert.equal(dataset.cases.length, 12)

  const ids = dataset.cases.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const item of dataset.cases) {
    for (const field of ['id', 'journey', 'route', 'precondition', 'expected', 'critical_failure']) {
      assert.equal(typeof item[field], 'string', `${item.id} lacks ${field}`)
      assert.ok(item[field].trim(), `${item.id} has empty ${field}`)
    }
  }

  const raw = JSON.stringify(dataset)
  assert.doesNotMatch(raw, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  assert.doesNotMatch(raw, /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)
})

test('feature flags are unique, fail closed and independently reversible', async () => {
  const registry = await readJson('../docs/architecture/s0/feature-flags.json')
  assert.equal(registry.policy.default_for_unknown_flag, false)
  assert.equal(registry.policy.fail_closed, true)
  const keys = registry.flags.map(flag => flag.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const flag of registry.flags) {
    assert.equal(flag.default, false, `${flag.key} must start disabled`)
    assert.equal(flag.kill_switch, true, `${flag.key} needs a kill switch`)
    assert.ok(flag.owner && flag.purpose)
  }
})

test('every declared current route has a journey or is explicitly non-critical', async () => {
  const dataset = await readJson('../evals/datasets/development/current-system/journeys.json')
  const covered = new Set(dataset.cases.map(item => item.route))
  const critical = ['/auth', '/upload', '/vault', '/patterns', '/simulate', '/simulate/:simulationId', '/engine/:topic']
  for (const route of critical) assert.ok(covered.has(route), `${route} has no baseline journey`)
})

test('restore rehearsal recreates Supabase policy roles before post-data', async () => {
  const script = await readText('../scripts/s0-backup-restore-rehearsal.ps1')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(script, new RegExp(`CREATE ROLE ${role}\\b`, 'i'))
  }
  assert.ok(
    script.indexOf('CREATE ROLE authenticated') < script.indexOf("foreach ($section in @('pre-data', 'data'))"),
    'Supabase roles must exist before policy restoration'
  )
})
