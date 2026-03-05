import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getVault } from '../utils/getVault'
import { getCoverage } from '../utils/getCoverage'
import { supabase } from '../api/supabase'

export default function VaultPage() {
  const { user } = useAuth()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [vault, setVault] = useState([])
  const [coverage, setCoverage] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState({})
  const [starting, setStarting] = useState('')

  useEffect(() => {
    if (!user) return
    Promise.all([
      getVault(user.id),
      getCoverage(user.id)
    ])
      .then(([vaultData, coverageData]) => {
        setVault(vaultData)
        const idx = {}
        for (const t of coverageData) {
          idx[t.topic] = t
        }
        setCoverage(idx)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user])

  function toggleTopic(topic) {
    setExpanded(prev => ({ ...prev, [topic]: !prev[topic] }))
  }

  async function startSession(topic, sub_type) {
    const key = `${topic}__${sub_type}`
    setStarting(key)
    try {
      const { data, error } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, topic, current_layer: 'foundation' })
        .select()
        .single()
      if (error) throw error
      const encoded = encodeURIComponent(`${topic}__${sub_type}__${data.id}`)
      navigate(`/engine/${encoded}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setStarting('')
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  if (loading) return <div className="page"><p className="muted">Loading your vault…</p></div>

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: 0 }}>Your papers</h1>
        <span className="spacer" />
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/progress')}>
          Progress
        </button>
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={handleSignOut}>
          Sign out
        </button>
        <button className="secondary" onClick={() => navigate('/upload')}>
          Upload more
        </button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {vault.length === 0 && !error && (
        <div>
          <p className="muted">No questions found.</p>
          <button className="ghost" onClick={() => navigate('/upload')}>Upload a paper to get started</button>
        </div>
      )}

      {vault.map(({ topic, subtypes }) => {
        const cov = coverage[topic]
        return (
          <div key={topic} style={{ marginBottom: '0.25rem' }}>
            <button
              className="ghost"
              onClick={() => toggleTopic(topic)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.75rem 0',
                borderBottom: '1px solid var(--border)',
                fontSize: '1rem',
                color: 'var(--fg)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>{topic}</span>
              <span className="muted" style={{ fontSize: '0.8rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {cov && (
                  <span style={{ color: cov.pct === 100 ? 'var(--success)' : 'var(--fg-muted)' }}>
                    {cov.covered}/{cov.total} covered ({cov.pct}%)
                  </span>
                )}
                <span>{subtypes.length} sub-topic{subtypes.length !== 1 ? 's' : ''} {expanded[topic] ? '↑' : '↓'}</span>
              </span>
            </button>

            {expanded[topic] && (
              <div style={{ paddingLeft: '1rem', paddingTop: '0.5rem', paddingBottom: '0.75rem' }}>
                {subtypes.map(({ sub_type, count }) => {
                  const key = `${topic}__${sub_type}`
                  const subCov = cov?.subtypes?.find(s => s.sub_type === sub_type)
                  return (
                    <div key={sub_type} className="row" style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '0.95rem' }}>{sub_type}</span>
                        {subCov && (
                          <span className="muted" style={{ fontSize: '0.78rem', marginLeft: '0.75rem' }}>
                            {subCov.covered}/{subCov.total} ({subCov.pct}%)
                          </span>
                        )}
                      </div>
                      <button
                        className="primary"
                        style={{ fontSize: '0.85rem', padding: '0.35rem 0.9rem' }}
                        disabled={starting === key}
                        onClick={() => startSession(topic, sub_type)}
                      >
                        {starting === key ? 'Starting…' : subCov?.pct === 100 ? 'Revisit' : 'Begin'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
