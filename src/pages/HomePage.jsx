import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../api/supabase'
import { getUserTokens } from '../utils/logTokens'

const THEMES = ['paper', 'white', 'dark', 'forest']
const THEME_LABELS = { paper: '📄', white: '⬜', dark: '⬛', forest: '🌲' }

export default function HomePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [recentSessions, setRecentSessions] = useState([])
  const [tokenData, setTokenData] = useState(null)
  const [loading, setLoading] = useState(true)
  const THEMES = ['paper', 'white', 'dark', 'forest']

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('solvd-theme') || 'paper'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('solvd-theme', theme)
  }, [theme])

  function cycleTheme() {
    setTheme(prev => {
      const idx = THEMES.indexOf(prev)
      const next = THEMES[(idx + 1) % THEMES.length]
      return next
    })
  }

  useEffect(() => {
    if (!user) return
    loadHome()
  }, [user])

  async function loadHome() {
    setLoading(true)
    try {
      const { data: allSessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const seen = new Set()
      const sessions = (allSessions || []).filter(s => {
        if (seen.has(s.topic)) return false
        seen.add(s.topic)
        return true
      }).slice(0, 5)

      setRecentSessions(sessions)

      const tokens = await getUserTokens(user.id)
      setTokenData(tokens)
    } catch (e) {
      console.error('Home load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Solvd</h1>
        <span className="spacer" />
        <button
          className="ghost"
          style={{ fontSize: '1rem', minHeight: 'unset', padding: '0 0.25rem' }}
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
        >
          {THEME_LABELS[theme]}
        </button>
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      <p className="muted" style={{ marginBottom: '1.5rem', fontSize: '0.95rem' }}>
        Atlas is ready. Upload your papers and work through every question — one sub-topic at a time.
      </p>
      <div className="row" style={{ marginBottom: '2.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button className="primary" onClick={() => navigate('/vault')}>
          Start a session
        </button>
        <button className="secondary" onClick={() => navigate('/upload')}>
          Upload papers
        </button>
        <button className="secondary" onClick={() => navigate('/progress')}>
          Progress
        </button>
      </div>

      <hr className="divider" />

      {tokenData && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Total usage</h2>
          <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                {tokenData.totalTokens.toLocaleString()}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Tokens used</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', fontWeight: 'normal', lineHeight: 1 }}>
                ${tokenData.estimatedCost.toFixed(4)}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Estimated cost</p>
            </div>
          </div>
        </div>
      )}

      <hr className="divider" />

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Recent sessions</h2>

        {loading && <p className="muted">Loading…</p>}

        {!loading && recentSessions.length === 0 && (
          <p className="muted">No sessions yet. Upload a paper and let Atlas guide you through it.</p>
        )}

        {recentSessions.map(s => (
          <div
            key={s.id}
            className="row"
            style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.95rem', marginBottom: '0.1rem' }}>{s.topic}</p>
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                {s.current_layer} · {formatDate(s.created_at)}
              </p>
            </div>
            <button
              className="ghost"
              style={{ fontSize: '0.85rem' }}
              onClick={() => {
                if (s.sub_type) {
                  const encoded = encodeURIComponent(`${s.topic}__${s.sub_type}__${s.id}`)
                  navigate(`/engine/${encoded}`)
                } else {
                  navigate('/vault')
                }
              }}
            >
              Continue →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
