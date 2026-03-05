import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getVault } from '../utils/getVault'
import { supabase } from '../api/supabase'

export default function VaultPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [vault, setVault] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState({})
  const [starting, setStarting] = useState('')

  useEffect(() => {
    if (!user) return
    getVault(user.id)
      .then(setVault)
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
        .insert({
          user_id: user.id,
          topic,
          current_layer: 'foundation'
        })
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

  if (loading) return (
    <div className="page">
      <p className="muted">Loading your vault…</p>
    </div>
  )

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: 0 }}>Your vault</h1>
        <span className="spacer" />
        <button className="secondary" onClick={() => navigate('/upload')}>
          Upload more
        </button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {vault.length === 0 && !error && (
        <div>
          <p className="muted">No questions found.</p>
          <button className="ghost" onClick={() => navigate('/upload')}>
            Upload a paper to get started
          </button>
        </div>
      )}

      {vault.map(({ topic, subtypes }) => (
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
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {subtypes.length} sub-topic{subtypes.length !== 1 ? 's' : ''} &nbsp;
              {expanded[topic] ? '↑' : '↓'}
            </span>
          </button>

          {expanded[topic] && (
            <div style={{ paddingLeft: '1rem', paddingTop: '0.5rem', paddingBottom: '0.75rem' }}>
              {subtypes.map(({ sub_type, count }) => {
                const key = `${topic}__${sub_type}`
                return (
                  <div
                    key={sub_type}
                    className="row"
                    style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}
                  >
                    <span style={{ flex: 1, fontSize: '0.95rem' }}>{sub_type}</span>
                    <span className="muted" style={{ fontSize: '0.8rem', marginRight: '1.5rem' }}>
                      {count} question{count !== 1 ? 's' : ''}
                    </span>
                    <button
                      className="primary"
                      style={{ fontSize: '0.85rem', padding: '0.35rem 0.9rem' }}
                      disabled={starting === key}
                      onClick={() => startSession(topic, sub_type)}
                    >
                      {starting === key ? 'Starting…' : 'Begin'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
