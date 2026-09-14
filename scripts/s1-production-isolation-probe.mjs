import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { TextEncoder } from 'node:util'
import { createClient } from '@supabase/supabase-js'

/* global AbortSignal, fetch */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = resolve(root, 'docs', 'architecture', 's1', 'evidence')
const runId = randomUUID()
const marker = `s1-security-probe-${runId}`
const startedAt = new Date().toISOString()
const checks = []
const cleanup = []
const requestTimeoutMs = 20000

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--confirm-project-ref') result.confirmProjectRef = argv[++index]
    else if (value === '--cleanup-stale') result.cleanupStale = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}

async function loadEnvFile(path) {
  let contents
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : '')
  if (!value || /YOUR_|placeholder/i.test(value)) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      fetch: (input, init = {}) => fetch(input, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs)
      })
    }
  })
}

async function findProbeUsers(admin) {
  const users = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    assert.ifError(result.error)
    const batch = result.data.users || []
    users.push(...batch.filter(user => user.email?.startsWith('s1-security-probe-')))
    if (batch.length < 1000) break
  }
  return users
}

async function cleanupProbeUsers(admin, users) {
  let failures = 0
  for (const user of users) {
    const listed = await admin.storage.from('papers').list(user.id, { limit: 1000 })
    if (listed.error) {
      failures += 1
    } else if (listed.data?.length) {
      const paths = listed.data.map(item => `${user.id}/${item.name}`)
      const removed = await admin.storage.from('papers').remove(paths)
      if (removed.error) failures += 1
    }
    const removedUser = await admin.auth.admin.deleteUser(user.id)
    if (removedUser.error) failures += 1
  }
  return { removed: users.length, failures }
}

async function check(id, description, operation) {
  try {
    const detail = await operation()
    checks.push({ id, status: 'passed', description, ...(detail ? { detail } : {}) })
  } catch (error) {
    checks.push({ id, status: 'failed', description, detail: safeError(error) })
    throw error
  }
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 300)
}

function assertNoRows(result, label) {
  assert.ifError(result.error)
  assert.equal(result.data?.length || 0, 0, `${label} unexpectedly returned rows`)
}

function assertRejected(result, label) {
  assert.ok(result.error, `${label} unexpectedly succeeded`)
}

async function invokeDetailed(supabase, functionName, body) {
  const result = await supabase.functions.invoke(functionName, { body })
  if (!result.error) return { status: 200, payload: result.data }

  const response = result.error.context
  let payload = result.data
  if (response && typeof response.clone === 'function') {
    try {
      payload = await response.clone().json()
    } catch {
      // The HTTP status is still authoritative when the gateway returns text.
    }
  }
  return { status: Number(response?.status || 0), payload }
}

function assertFunctionError(result, status, code) {
  assert.equal(result.status, status)
  if (code) assert.equal(result.payload?.error?.code, code)
}

async function countRows(admin, table, column, value) {
  const result = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, value)
  assert.ifError(result.error)
  return result.count || 0
}

async function signIn(url, anonKey, email, password) {
  const signedIn = client(url, anonKey)
  const result = await signedIn.auth.signInWithPassword({ email, password })
  assert.ifError(result.error)
  assert.ok(result.data.session?.access_token)
  return signedIn
}

async function writeReport(projectRef, status, error) {
  await mkdir(evidenceDir, { recursive: true })
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const reportPath = resolve(evidenceDir, `${stamp}-production-isolation-probe.json`)
  let commit = 'unknown'
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  } catch {
    // Evidence remains useful when the script is run outside a Git checkout.
  }
  const report = {
    schema_version: '1.0',
    probe: 's1-production-isolation',
    environment: 'production-test-only-project',
    project_ref: projectRef,
    app_commit: commit,
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status,
    critical_failure: status !== 'passed',
    model_provider_calls_expected: 0,
    checks,
    cleanup,
    ...(error ? { error: safeError(error) } : {})
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

async function main() {
  await loadEnvFile(resolve(root, '.env.local'))
  await loadEnvFile(resolve(root, '.env'))

  const args = parseArgs(process.argv.slice(2))
  const url = required('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const anonKey = required('VITE_SUPABASE_ANON_KEY')
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const parsedUrl = new URL(url)
  const projectRef = parsedUrl.hostname.split('.')[0]

  assert.equal(parsedUrl.protocol, 'https:', 'The probe requires an HTTPS Supabase URL')
  assert.ok(args.confirmProjectRef, 'Refusing to run without --confirm-project-ref <exact-project-ref>')
  assert.equal(args.confirmProjectRef, projectRef, 'Confirmed project ref does not match SUPABASE_URL')

  const admin = client(url, serviceRoleKey)
  const staleUsers = await findProbeUsers(admin)
  if (args.cleanupStale) {
    const result = await cleanupProbeUsers(admin, staleUsers)
    console.log(`Stale probe users removed: ${result.removed}`)
    console.log(`Cleanup failures: ${result.failures}`)
    assert.equal(result.failures, 0, 'One or more stale probe fixtures could not be removed')
    assert.equal((await findProbeUsers(admin)).length, 0, 'Stale probe users remain after cleanup')
    return
  }
  assert.equal(staleUsers.length, 0, 'Stale probe users exist; run again with --cleanup-stale before starting a new probe')

  const passwordA = randomBytes(24).toString('base64url')
  const passwordB = randomBytes(24).toString('base64url')
  const emailA = `${marker}-a@example.invalid`
  const emailB = `${marker}-b@example.invalid`
  const createdUsers = []
  const storagePaths = []
  let userA
  let userB
  let paperA
  let sessionA
  let sessionB
  let messageA
  let runError = null

  try {
    const createdA = await admin.auth.admin.createUser({
      email: emailA,
      password: passwordA,
      email_confirm: true,
      user_metadata: { s1_probe_run_id: runId }
    })
    assert.ifError(createdA.error)
    userA = createdA.data.user
    createdUsers.push(userA.id)

    const createdB = await admin.auth.admin.createUser({
      email: emailB,
      password: passwordB,
      email_confirm: true,
      user_metadata: { s1_probe_run_id: runId }
    })
    assert.ifError(createdB.error)
    userB = createdB.data.user
    createdUsers.push(userB.id)

    const [asA, asB] = await Promise.all([
      signIn(url, anonKey, emailA, passwordA),
      signIn(url, anonKey, emailB, passwordB)
    ])
    const anonymous = client(url, anonKey)

    await check('AUTH-001', 'Temporary users receive distinct authenticated principals', async () => {
      assert.notEqual(userA.id, userB.id)
      return { principals: 2 }
    })

    const storagePathA = `${userA.id}/${marker}.pdf`
    storagePaths.push(storagePathA)
    const pdfFixture = new TextEncoder().encode('%PDF-1.4\n% S1 isolated authorization fixture\n%%EOF\n')
    const uploaded = await asA.storage.from('papers').upload(storagePathA, pdfFixture, {
      contentType: 'application/pdf',
      upsert: false
    })
    assert.ifError(uploaded.error)

    const insertedPaper = await asA.from('papers').insert({
      user_id: userA.id,
      file_url: `papers/${storagePathA}`,
      file_type: 'pdf',
      name: marker,
      assessment_type: 'Tutorial Sheet'
    }).select('id').single()
    assert.ifError(insertedPaper.error)
    paperA = insertedPaper.data

    const insertedSessionA = await asA.from('sessions').insert({
      user_id: userA.id,
      topic: marker,
      sub_type: 'Tenant isolation A'
    }).select('id').single()
    assert.ifError(insertedSessionA.error)
    sessionA = insertedSessionA.data

    const insertedSessionB = await asB.from('sessions').insert({
      user_id: userB.id,
      topic: marker,
      sub_type: 'Tenant isolation B'
    }).select('id').single()
    assert.ifError(insertedSessionB.error)
    sessionB = insertedSessionB.data

    const insertedMessage = await asA.from('messages').insert({
      session_id: sessionA.id,
      role: 'assistant',
      content: marker
    }).select('id').single()
    assert.ifError(insertedMessage.error)
    messageA = insertedMessage.data

    await check('DB-001', 'User B cannot select User A paper, session, or message', async () => {
      assertNoRows(await asB.from('papers').select('id').eq('id', paperA.id), 'paper select')
      assertNoRows(await asB.from('sessions').select('id').eq('id', sessionA.id), 'session select')
      assertNoRows(await asB.from('messages').select('id').eq('id', messageA.id), 'message select')
    })

    await check('DB-002', 'User B cannot insert rows attributed to User A', async () => {
      assertRejected(await asB.from('papers').insert({
        user_id: userA.id,
        file_url: `papers/${userA.id}/${marker}-forbidden.pdf`,
        file_type: 'pdf',
        name: `${marker}-forbidden`
      }), 'paper attribution insert')
      assertRejected(await asB.from('messages').insert({
        session_id: sessionA.id,
        role: 'user',
        content: `${marker}-forbidden`
      }), 'message attribution insert')
    })

    await check('DB-003', 'User B cannot update or delete User A rows', async () => {
      assertNoRows(await asB.from('messages').update({ content: `${marker}-tampered` }).eq('id', messageA.id).select('id'), 'message update')
      assertNoRows(await asB.from('messages').delete().eq('id', messageA.id).select('id'), 'message delete')
      assertNoRows(await asB.from('sessions').update({ topic: `${marker}-tampered` }).eq('id', sessionA.id).select('id'), 'session update')
      assertNoRows(await asB.from('sessions').delete().eq('id', sessionA.id).select('id'), 'session delete')

      const original = await admin.from('messages').select('content').eq('id', messageA.id).single()
      assert.ifError(original.error)
      assert.equal(original.data.content, marker)
    })

    await check('DB-004', 'Browser principals cannot write server-owned usage tables', async () => {
      assertRejected(await asB.from('token_logs').insert({
        user_id: userA.id,
        session_id: sessionA.id,
        input_tokens: 1,
        output_tokens: 1,
        model: 'forbidden',
        context: marker
      }), 'token log insert')
      assertRejected(await asB.from('model_call_allowances').select('id').limit(1), 'allowance read')
    })

    await check('STORAGE-001', 'User B cannot list, read, or sign User A object', async () => {
      const listed = await asB.storage.from('papers').list(userA.id, { limit: 100 })
      assert.ifError(listed.error)
      assert.equal(listed.data?.some(item => item.name === `${marker}.pdf`), false)
      assertRejected(await asB.storage.from('papers').download(storagePathA), 'storage download')
      assertRejected(await asB.storage.from('papers').createSignedUrl(storagePathA, 60), 'signed URL creation')
    })

    await check('STORAGE-002', 'User B cannot upload, overwrite, or delete inside User A prefix', async () => {
      const forbiddenPath = `${userA.id}/${marker}-forbidden.pdf`
      assertRejected(await asB.storage.from('papers').upload(forbiddenPath, pdfFixture, {
        contentType: 'application/pdf',
        upsert: false
      }), 'cross-prefix upload')
      assertRejected(await asB.storage.from('papers').update(storagePathA, pdfFixture, {
        contentType: 'application/pdf'
      }), 'cross-prefix update')
      await asB.storage.from('papers').remove([storagePathA])

      const stillPresent = await admin.storage.from('papers').download(storagePathA)
      assert.ifError(stillPresent.error)
    })

    await check('FUNCTION-001', 'User B cannot invoke Atlas chat against User A session', async () => {
      const before = await countRows(admin, 'model_call_allowances', 'user_id', userB.id)
      const denied = await invokeDetailed(asB, 'atlas-chat', {
        systemPrompt: 'S1 authorization probe. Do not call the model.',
        messages: [{ role: 'user', content: marker }],
        sessionId: sessionA.id,
        context: 'foundation_start'
      })
      assertFunctionError(denied, 403, 'SESSION_FORBIDDEN')
      assert.equal(await countRows(admin, 'model_call_allowances', 'user_id', userB.id), before)
      assert.equal(await countRows(admin, 'token_logs', 'user_id', userB.id), 0)
    })

    await check('FUNCTION-002', 'User B cannot invoke extraction against User A paper', async () => {
      const before = await countRows(admin, 'model_call_allowances', 'user_id', userB.id)
      const denied = await invokeDetailed(asB, 'atlas-extract', { paperId: paperA.id })
      assertFunctionError(denied, 404, 'PAPER_NOT_FOUND')
      assert.equal(await countRows(admin, 'model_call_allowances', 'user_id', userB.id), before)
    })

    await check('FUNCTION-003', 'Anonymous callers are denied by every model boundary', async () => {
      const cases = [
        ['atlas-chat', {
          systemPrompt: 'S1 anonymous probe.',
          messages: [{ role: 'user', content: marker }],
          context: 'foundation_start'
        }],
        ['atlas-extract', { paperId: paperA.id }],
        ['atlas-variant', {
          topic: marker,
          subType: marker,
          layer: 'foundation',
          questions: [{ raw_text: marker }]
        }]
      ]
      for (const [name, body] of cases) {
        const denied = await invokeDetailed(anonymous, name, body)
        assert.equal(denied.status, 401, `${name} accepted an anonymous request`)
      }
      return { boundaries: cases.length }
    })

    await check('ALLOWANCE-001', 'Exhausted allowance fails before any model-provider call', async () => {
      const seeded = await admin.from('model_call_allowances').insert({
        user_id: userB.id,
        route: 'atlas_chat',
        status: 'completed',
        reserved_input_tokens: 0,
        reserved_output_tokens: 1,
        actual_input_tokens: 1000000,
        actual_output_tokens: 0,
        settled_at: new Date().toISOString()
      })
      assert.ifError(seeded.error)

      const denied = await invokeDetailed(asB, 'atlas-chat', {
        systemPrompt: 'S1 allowance probe. Do not call the model.',
        messages: [{ role: 'user', content: marker }],
        sessionId: sessionB.id,
        context: 'foundation_start'
      })
      assertFunctionError(denied, 429, 'MODEL_ALLOWANCE_EXHAUSTED')
      assert.equal(await countRows(admin, 'model_call_allowances', 'user_id', userB.id), 1)
      assert.equal(await countRows(admin, 'token_logs', 'user_id', userB.id), 0)
    })
  } catch (error) {
    runError = error
  } finally {
    for (const path of storagePaths) {
      const removed = await admin.storage.from('papers').remove([path])
      cleanup.push({ target: 'storage_object', status: removed.error ? 'failed' : 'removed' })
      if (removed.error && !runError) runError = removed.error
    }

    for (const id of [...createdUsers].reverse()) {
      const removed = await admin.auth.admin.deleteUser(id)
      cleanup.push({ target: 'temporary_auth_user', status: removed.error ? 'failed' : 'removed' })
      if (removed.error && !runError) runError = removed.error
    }

    if (userA && userB) {
      for (const table of ['papers', 'questions', 'sessions', 'token_logs', 'model_call_allowances']) {
        for (const userId of [userA.id, userB.id]) {
          try {
            const count = await countRows(admin, table, 'user_id', userId)
            cleanup.push({ target: `${table}_rows`, status: count === 0 ? 'verified_empty' : 'failed', count })
            if (count !== 0 && !runError) runError = new Error(`Cleanup left ${count} ${table} rows`)
          } catch (error) {
            cleanup.push({ target: `${table}_rows`, status: 'failed', detail: safeError(error) })
            if (!runError) runError = error
          }
        }
      }

      if (messageA) {
        const messageCount = await countRows(admin, 'messages', 'id', messageA.id)
        cleanup.push({ target: 'message_row', status: messageCount === 0 ? 'verified_empty' : 'failed', count: messageCount })
        if (messageCount !== 0 && !runError) runError = new Error('Cleanup left the probe message row')
      }
    }
  }

  const reportPath = await writeReport(projectRef, runError ? 'failed' : 'passed', runError)
  console.log(`S1 production-isolation probe: ${runError ? 'FAILED' : 'PASSED'}`)
  console.log(`Checks passed: ${checks.filter(item => item.status === 'passed').length}/${checks.length}`)
  console.log(`Sanitized evidence: ${reportPath}`)
  if (runError) throw runError
}

main().catch(error => {
  console.error(`Probe failed: ${safeError(error)}`)
  process.exitCode = 1
})
