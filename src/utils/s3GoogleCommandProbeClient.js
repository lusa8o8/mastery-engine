const PROBE_API = 'http://127.0.0.1:8000'

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function checkedRequest(fetcher, path, options, expectedStatus) {
  const response = await fetcher(`${PROBE_API}${path}`, options)
  const body = await safeJson(response)
  if (response.status !== expectedStatus) {
    throw new Error(`Probe request failed with status ${response.status}`)
  }
  return body
}

// This development helper never returns, renders, or logs the access token.
// It proves that the same Google session can cross the new trusted API boundary.
export async function runS3GoogleCommandProbe({ accessToken, fetcher = fetch, idFactory }) {
  if (!accessToken) throw new Error('An authenticated session is required')

  const authHeaders = { authorization: `Bearer ${accessToken}` }
  const identity = await checkedRequest(fetcher, '/v1/whoami', {
    method: 'GET',
    headers: authHeaders
  }, 200)

  if (
    identity?.auth_method !== 'google' ||
    !identity?.principal_id ||
    identity.principal_id !== identity.tenant_id
  ) {
    throw new Error('The API did not resolve a Google personal-tenant principal')
  }

  const probeId = idFactory()
  const idempotencyKey = `google-probe:${probeId}`
  const body = {
    command_type: 'platform.integration_probe',
    payload_schema_version: 'platform_probe.v1',
    payload: { probe_id: probeId, sequence: 1 }
  }
  const commandHeaders = {
    ...authHeaders,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey
  }
  const first = await checkedRequest(fetcher, '/v1/commands', {
    method: 'POST',
    headers: commandHeaders,
    body: JSON.stringify(body)
  }, 202)
  const replay = await checkedRequest(fetcher, '/v1/commands', {
    method: 'POST',
    headers: commandHeaders,
    body: JSON.stringify(body)
  }, 202)
  const conflict = await checkedRequest(fetcher, '/v1/commands', {
    method: 'POST',
    headers: commandHeaders,
    body: JSON.stringify({ ...body, payload: { probe_id: probeId, sequence: 2 } })
  }, 409)

  if (
    first?.replayed !== false ||
    replay?.replayed !== true ||
    first?.job?.job_id !== replay?.job?.job_id ||
    first?.job?.tenant_id !== identity.tenant_id ||
    conflict?.code !== 'CONFLICT'
  ) {
    throw new Error('The command idempotency or tenant postcondition failed')
  }

  return {
    authMethod: identity.auth_method,
    jobId: first.job.job_id,
    status: 'passed'
  }
}
