import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate('/home')
      } else {
        await signUp(email, password)
        setMessage('Check your email to confirm your account, then log in.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-narrow">
      <h1>Solvd</h1>
      <p className="muted" style={{ marginBottom: '2rem' }}>
        {mode === 'login' ? 'Sign in to continue.' : 'Create an account to begin.'}
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} />
        </div>
        {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}
        {message && <p style={{ color: 'var(--success)', fontSize: '0.9rem', marginBottom: '1rem' }}>{message}</p>}
        <button type="submit" className="primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <hr className="divider" />
      <p className="muted" style={{ textAlign: 'center' }}>
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button className="ghost" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
      <p className="muted" style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.78rem' }}>
        Powered by Anthropic
      </p>
    </div>
  )
}
