import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../api/supabase'
import { getUserTokens } from '../utils/logTokens'

const THEMES = ['paper', 'white', 'dark', 'forest']

export default function HomePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [recentSessions, setRecentSessions] = useState([])
  const [tokenData, setTokenData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [theme, setTheme] = useState(function () {
    return localStorage.getItem('solvd-theme') || 'paper'
  })

  useEffect(function () {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('solvd-theme', theme)
  }, [theme])

  function cycleTheme() {
    setTheme(function (prev) {
      const idx = THEMES.indexOf(prev)
      return THEMES[(idx + 1) % THEMES.length]
    })
  }

  useEffect(function () {
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
      const sessions = (allSessions || []).filter(function (session) {
        if (seen.has(session.topic)) return false
        seen.add(session.topic)
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
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function continueSession(session) {
    if (session.sub_type) {
      const encoded = encodeURIComponent(`${session.topic}__${session.sub_type}__${session.id}`)
      navigate(`/engine/${encoded}`, { state: { resume: true } })
    } else {
      navigate('/vault')
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Solvd</h1>
        <span className="spacer" />
        <button
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            border: '1.5px solid var(--border)',
            background: { paper: '#F5F0E8', white: '#FFFFFF', dark: '#1A1714', forest: '#1A2E1A' }[theme],
            cursor: 'pointer',
            padding: 0,
            minHeight: 'unset',
            flexShrink: 0
          }}
        />
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      <p className="muted" style={{ marginBottom: '1.5rem', fontSize: '0.95rem' }}>
        Atlas is ready. Upload your papers and work through every question - one sub-topic at a time.
      </p>

      <div className="row" style={{ marginBottom: '2.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button className="primary" onClick={() => navigate('/vault')}>
          Start a session
        </button>
        <button className="secondary" onClick={() => navigate('/upload')}>
          Upload papers
        </button>
        <button className="secondary" onClick={() => navigate('/patterns')}>
          Patterns
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
        <div className="row" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: 0 }}>Recent sessions</h2>
          <span className="spacer" />
          {!loading && recentSessions.length > 0 && (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {recentSessions.length} topic{recentSessions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading && <p className="muted">Loading...</p>}

        {!loading && recentSessions.length === 0 && (
          <p className="muted">No sessions yet. Upload a paper and let Atlas guide you through it.</p>
        )}

        {!loading && recentSessions.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '0.75rem'
          }}>
            {recentSessions.map(function (session) {
              return (
                <button
                  key={session.id}
                  type="button"
                  className="secondary"
                  onClick={function () { continueSession(session) }}
                  style={{
                    minHeight: 'unset',
                    padding: '0.85rem',
                    textAlign: 'left',
                    display: 'block',
                    lineHeight: 1.35
                  }}
                >
                  <span style={{
                    display: 'block',
                    fontSize: '0.95rem',
                    marginBottom: '0.35rem',
                    color: 'var(--fg)'
                  }}>
                    {session.topic}
                  </span>
                  {session.sub_type && (
                    <span style={{
                      display: 'block',
                      fontSize: '0.78rem',
                      color: 'var(--fg-muted)',
                      marginBottom: '0.45rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {session.sub_type}
                    </span>
                  )}
                  <span style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    color: 'var(--fg-muted)',
                    fontSize: '0.76rem'
                  }}>
                    <span>{session.current_layer || 'foundation'}</span>
                    <span>{formatDate(session.created_at)}</span>
                  </span>
                  <span style={{
                    display: 'block',
                    borderTop: '1px solid var(--border)',
                    marginTop: '0.65rem',
                    paddingTop: '0.5rem',
                    color: 'var(--fg)',
                    fontSize: '0.8rem'
                  }}>
                    Continue
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
