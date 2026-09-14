import assert from 'node:assert/strict'
import test from 'node:test'

import { runS3GoogleCommandProbe } from '../src/utils/s3GoogleCommandProbeClient.js'

function response(status, body) {
  return { status, async json() { return body } }
}

test('Google command probe proves identity, replay, conflict, and hides the token', async () => {
  const calls = []
  const token = 'private-google-session-token'
  const job = { job_id: 'job-1', tenant_id: 'user-1' }
  const replies = [
    response(200, { auth_method: 'google', principal_id: 'user-1', tenant_id: 'user-1' }),
    response(202, { replayed: false, job }),
    response(202, { replayed: true, job }),
    response(409, { code: 'CONFLICT' })
  ]
  const result = await runS3GoogleCommandProbe({
    accessToken: token,
    idFactory: () => 'probe-id',
    fetcher: async (url, options) => {
      calls.push({ url, options })
      return replies.shift()
    }
  })

  assert.deepEqual(result, { authMethod: 'google', jobId: 'job-1', status: 'passed' })
  assert.equal(calls.length, 4)
  assert.ok(calls.every(({ options }) => options.headers.authorization === `Bearer ${token}`))
  assert.doesNotMatch(JSON.stringify(result), /private-google-session-token/)
})

test('Google command probe rejects a non-Google or cross-tenant principal', async () => {
  for (const identity of [
    { auth_method: 'password', principal_id: 'user-1', tenant_id: 'user-1' },
    { auth_method: 'google', principal_id: 'user-1', tenant_id: 'user-2' }
  ]) {
    await assert.rejects(
      runS3GoogleCommandProbe({
        accessToken: 'fixture-token',
        idFactory: () => 'probe-id',
        fetcher: async () => response(200, identity)
      }),
      /Google personal-tenant principal/
    )
  }
})
