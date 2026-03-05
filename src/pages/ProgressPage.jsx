import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getCoverage } from '../utils/getCoverage'

export default function ProgressPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [coverage, setCoverage] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    getCoverage(user.id)
      .then(setCoverage)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user])

  const totalQuestions = coverage.reduce((s, t) => s + t.total, 0)
  const totalCovered = coverage.reduce((s, t) => s + t.covered, 0)
  const overallPct = totalQuestions > 0 ? Math.round((totalCovered / totalQuestions) * 100) : 0

  if (loading) return <div className="page"><p className="muted">Loading progress…</p></div>

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: 0 }}>Progress</h1>
        <span className="spacer" />
        <button className="ghost" onClick={() => navigate('/vault')}>← Vault</button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div style={{ marginBottom: '2rem' }}>
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <span>Overall coverage</span>
          <span className="muted" style={{ fontSize: '0.9rem' }}>{totalCovered}/{totalQuestions} questions</span>
        </div>
        <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
          <div style={{
            height: '100%',
            width: `${overallPct}%`,
            background: 'var(--fg)',
            borderRadius: '3px',
            transition: 'width 0.3s'
          }} />
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>{overallPct}% complete</p>
      </div>

      <hr className="divider" />

      {coverage.map(({ topic, total, covered, pct, subtypes }) => (
        <div key={topic} style={{ marginBottom: '1.75rem' }}>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <span style={{ fontWeight: 'bold' }}>{topic}</span>
            <span className="muted" style={{ fontSize: '0.85rem' }}>{covered}/{total} · {pct}%</span>
          </div>
          <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginBottom: '0.75rem' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: pct === 100 ? 'var(--success)' : 'var(--fg)',
              borderRadius: '2px',
              transition: 'width 0.3s'
            }} />
          </div>

          {subtypes.map(({ sub_type, total: stTotal, covered: stCovered, pct: stPct }) => (
            <div key={sub_type} className="row" style={{
              padding: '0.35rem 0',
              paddingLeft: '1rem',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.9rem'
            }}>
              <span style={{ flex: 1, color: stPct === 100 ? 'var(--fg-muted)' : 'var(--fg)' }}>
                {stPct === 100 ? '✓ ' : ''}{sub_type}
              </span>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {stCovered}/{stTotal}
              </span>
            </div>
          ))}
        </div>
      ))}

      {coverage.length === 0 && !error && (
        <p className="muted">No progress yet. Start a session from the vault.</p>
      )}
    </div>
  )
}
