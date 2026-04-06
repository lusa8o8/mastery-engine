import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function LandingPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) navigate('/home', { replace: true })
  }, [user, loading])

  if (loading) return null

  return (
    <div className="page" style={{ maxWidth: '640px' }}>
      {/* Header */}
      <div className="row" style={{ marginBottom: '4rem' }}>
        <h1 style={{ marginBottom: 0, fontSize: '1.2rem' }}>Solvd</h1>
        <span className="spacer" />
        <button className="ghost" style={{ fontSize: '0.85rem' }}
          onClick={() => navigate('/auth')}>
          Sign in
        </button>
      </div>

      {/* Hero */}
      <div style={{ marginBottom: '3.5rem' }}>
        <h2 style={{
          fontSize: 'clamp(1.8rem, 5vw, 2.8rem)',
          lineHeight: 1.2,
          marginBottom: '1.25rem',
          fontWeight: 'normal'
        }}>
          Master every exam question your lecturer has ever set.
        </h2>
        <p style={{
          fontSize: '1.05rem',
          color: 'var(--fg-muted)',
          lineHeight: 1.7,
          marginBottom: '2rem',
          maxWidth: '480px'
        }}>
          Upload your past papers. Atlas teaches you every sub-topic,
          one question at a time — until exam day feels like revision.
        </p>
        <button
          className="primary"
          style={{ fontSize: '1rem', padding: '0.65rem 1.5rem' }}
          onClick={() => navigate('/auth')}
        >
          Get Started
        </button>
      </div>

      <hr className="divider" />

      {/* How it works */}
      <div style={{ marginBottom: '3rem', marginTop: '2.5rem' }}>
        <p style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--fg-muted)',
          marginBottom: '1.5rem'
        }}>
          How it works
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {[
            { n: '1', title: 'Upload your papers', body: 'Past exams, mock papers, tutorial sheets — Atlas reads them all and extracts every question.' },
            { n: '2', title: 'Learn with Atlas', body: 'Work through every sub-topic with a tutor that explains the why behind every step, not just the answer.' },
            { n: '3', title: 'Simulate your exam', body: 'Once Atlas knows your examiner\'s patterns, it generates a full practice paper tailored to what\'s likely to come up.' }
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: '1.25rem' }}>
              <span style={{
                fontSize: '0.8rem',
                color: 'var(--fg-muted)',
                minWidth: '1.2rem',
                paddingTop: '0.15rem'
              }}>
                {step.n}.
              </span>
              <div>
                <p style={{ marginBottom: '0.2rem', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  {step.title}
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <hr className="divider" />

      {/* Credibility */}
      <div style={{ marginTop: '2.5rem', marginBottom: '4rem' }}>
        <p style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--fg-muted)',
          marginBottom: '0.75rem'
        }}>
          Built for
        </p>
        <p style={{ fontSize: '0.95rem', color: 'var(--fg-muted)', lineHeight: 1.8 }}>
          O Level · IGCSE · A Level · IB · ZIMSEC · WAEC · NECO
        </p>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--border)',
        paddingTop: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.8rem',
        color: 'var(--fg-muted)'
      }}>
        <span>Solvd · solvd.trymyapp.uk</span>
        <span>Powered by Anthropic</span>
      </div>
    </div>
  )
}
