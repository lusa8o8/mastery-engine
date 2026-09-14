import { useState } from 'react'
import { supabase } from '../../api/supabase'
import { runS3GoogleCommandProbe } from '../../utils/s3GoogleCommandProbeClient'

export default function S3GoogleCommandProbe() {
  const enabled = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('s3-command-probe') === '1'
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  if (!enabled) return null

  async function runProbe() {
    setRunning(true)
    setResult(null)
    try {
      const { data } = await supabase.auth.getSession()
      const outcome = await runS3GoogleCommandProbe({
        accessToken: data.session?.access_token,
        idFactory: () => crypto.randomUUID()
      })
      setResult(outcome)
    } catch {
      setResult({ status: 'failed' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      aria-label="S3 Google command parity probe"
      style={{ border: '1px solid var(--border)', padding: '1rem', marginBottom: '2rem' }}
    >
      <h2 style={{ marginBottom: '0.5rem' }}>Development authentication probe</h2>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        Sends the current Google session to the local Atlas API and creates one removable test job.
      </p>
      <button className="secondary" type="button" disabled={running} onClick={runProbe}>
        {running ? 'Running probe...' : 'Run Google command parity probe'}
      </button>
      {result?.status === 'passed' && (
        <p role="status" style={{ marginTop: '0.75rem' }}>
          Passed: Google principal, tenant scope, durable command, replay and conflict checks.
          <span data-probe-job-id={result.jobId} style={{ display: 'none' }} />
        </p>
      )}
      {result?.status === 'failed' && (
        <p role="alert" style={{ marginTop: '0.75rem' }}>
          Probe failed. No session details were displayed.
        </p>
      )}
    </section>
  )
}
