import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../api/supabase'
import { LAYERS } from '../utils/constants'
import { getSessionTokens } from '../utils/logTokens'

const ERROR_LABELS = {
  conceptual_gap: 'Conceptual Gap',
  trap_failure: 'Trap Failure',
  careless: 'Careless Error',
  time_pressure: 'Time Pressure',
  recall_failure: 'Recall Failure'
}

export default function SummaryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session')

  const [session, setSession] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tokenData, setTokenData] = useState(null)

  useEffect(() => {
    if (!user) return
    loadSummary()
  }, [user])

  async function loadSummary() {
    setLoading(true)
    try {
      const sessionQuery = sessionId
        ? supabase.from('sessions').select('*').eq('id', sessionId).single()
        : supabase.from('sessions').select('*').eq('user_id', user.id)
            .order('created_at', { ascending: false }).limit(1).single()

      const { data: sessionData, error: sessionError } = await sessionQuery
      if (sessionError) throw sessionError
      setSession(sessionData)

      const { data: attemptsData, error: attemptsError } = await supabase
        .from('attempts')
        .select('*')
        .eq('session_id', sessionData.id)
        .order('created_at', { ascending: true })

      if (attemptsError) throw attemptsError
      setAttempts(attemptsData)

      try {
        const tokens = await getSessionTokens(sessionData.id)
        setTokenData(tokens)
      } catch (e) {
        console.error('Token fetch failed:', e)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="page"><p className="muted">Loading summary…</p></div>
  )

  if (error) return (
    <div className="page">
      <p className="error-text">{error}</p>
      <button className="ghost" onClick={() => navigate('/vault')}>← Back to vault</button>
    </div>
  )

  if (!session) return (
    <div className="page">
      <p className="muted">No session found.</p>
      <button className="ghost" onClick={() => navigate('/vault')}>← Back to vault</button>
    </div>
  )

  const total = attempts.length
  const correct = attempts.filter(a => a.is_correct).length
  const incorrect = total - correct
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0

  const errorBreakdown = {}
  for (const a of attempts) {
    if (a.error_type) {
      errorBreakdown[a.error_type] = (errorBreakdown[a.error_type] || 0) + 1
    }
  }

  const layersCovered = [...new Set(attempts.map(a => a.layer))]
  const layersCompleted = LAYERS.filter(l => layersCovered.includes(l.id))

  const dominantError = Object.entries(errorBreakdown)
    .sort(([, a], [, b]) => b - a)[0]

  return (
    <div className="page">
      <h1>Session complete</h1>
      <p className="muted" style={{ marginBottom: '2rem' }}>
        {session.topic} · {session.current_layer}
      </p>

      <hr className="divider" />

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Results</h2>
        <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '2rem', fontWeight: 'normal', lineHeight: 1 }}>{accuracy}%</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Accuracy</p>
          </div>
          <div>
            <p style={{ fontSize: '2rem', fontWeight: 'normal', lineHeight: 1 }}>{total}</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Attempts</p>
          </div>
          <div>
            <p style={{ fontSize: '2rem', fontWeight: 'normal', lineHeight: 1, color: 'var(--success)' }}>{correct}</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Correct</p>
          </div>
          <div>
            <p style={{ fontSize: '2rem', fontWeight: 'normal', lineHeight: 1, color: incorrect > 0 ? 'var(--error)' : 'var(--fg)' }}>{incorrect}</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Incorrect</p>
          </div>
        </div>
      </div>

      <hr className="divider" />

      {layersCompleted.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Layers covered</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {layersCompleted.map(l => (
              <span key={l.id} style={{
                fontSize: '0.85rem',
                padding: '0.25rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '2px'
              }}>
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <hr className="divider" />

      {Object.keys(errorBreakdown).length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Error breakdown</h2>
          {Object.entries(errorBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <div key={type} className="row" style={{
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border)'
              }}>
                <span style={{ flex: 1 }}>{ERROR_LABELS[type] || type}</span>
                <span className="muted" style={{ fontSize: '0.9rem' }}>{count}×</span>
              </div>
            ))}
        </div>
      )}

      {dominantError && (
        <div style={{
          marginBottom: '2rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)'
        }}>
          <p style={{ marginBottom: '0.25rem', fontSize: '0.85rem' }}>
            <strong>Focus area:</strong> Your most common error was{' '}
            <strong>{ERROR_LABELS[dominantError[0]]}</strong> ({dominantError[1]}×).
          </p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {dominantError[0] === 'conceptual_gap' && 'Return to Foundation layer and rebuild the concept spine.'}
            {dominantError[0] === 'trap_failure' && 'Spend more time in the Traps layer before moving on.'}
            {dominantError[0] === 'careless' && 'Slow down on each step. Write out every line of working.'}
            {dominantError[0] === 'time_pressure' && 'Practice the Pressure layer until recognition becomes automatic.'}
            {dominantError[0] === 'recall_failure' && 'Return in 7 days for the Recall layer to reinforce retention.'}
          </p>
        </div>
      )}

      {tokenData && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Session usage</h2>
          <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                {tokenData.totalTokens.toLocaleString()}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Total tokens</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                ${tokenData.estimatedCost.toFixed(4)}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Estimated cost</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                {tokenData.inputTokens.toLocaleString()}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Input tokens</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                {tokenData.outputTokens.toLocaleString()}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Output tokens</p>
            </div>
          </div>
        </div>
      )}

      {total === 0 && (
        <p className="muted" style={{ marginBottom: '2rem' }}>
          No attempts logged this session. Submit your working next time to track progress.
        </p>
      )}

      <hr className="divider" />

      <div className="row" style={{ gap: '1rem' }}>
        <button className="primary" onClick={() => navigate('/vault')}>
          Back to vault
        </button>
        <button className="secondary" onClick={() => navigate('/upload')}>
          Upload more papers
        </button>
      </div>
    </div>
  )
}
