import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  buildGoogleOAuthRedirectUrl,
  hasOAuthCallbackError,
  locationToReturnPath,
  sanitizeAuthReturnPath
} from '../utils/authRedirect'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingAction, setPendingAction] = useState('')

  const { user, loading: authLoading, signIn, signUp, signInWithGoogle } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const googleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true'

  const returnPath = useMemo(() => {
    const requestedPath = new URLSearchParams(location.search).get('next')
    return location.state?.from
      ? locationToReturnPath(location.state.from)
      : sanitizeAuthReturnPath(requestedPath)
  }, [location.search, location.state])

  useEffect(() => {
    if (!authLoading && user) navigate(returnPath, { replace: true })
  }, [authLoading, navigate, returnPath, user])

  useEffect(() => {
    if (hasOAuthCallbackError(location.search, location.hash)) {
      // Provider details can be inconsistent or overly technical. Keep the
      // message actionable and leave password sign-in available.
      setError('Google sign-in was not completed. Please try again or use email and password.')
    }
  }, [location.hash, location.search])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setPendingAction('password')
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate(returnPath, { replace: true })
      } else {
        await signUp(email, password)
        setMessage('Check your email to confirm your account, then log in.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setPendingAction('')
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    setMessage('')
    setPendingAction('google')
    try {
      const redirectTo = buildGoogleOAuthRedirectUrl(window.location.origin, returnPath)
      await signInWithGoogle(redirectTo)
    } catch (err) {
      setError(err.message || 'Google sign-in could not be started. Please use email and password.')
      setPendingAction('')
    }
  }

  return (
    <div className="page-narrow">
      <h1>Solvd</h1>
      <p className="muted" style={{ marginBottom: '2rem' }}>
        {mode === 'login' ? 'Sign in to continue.' : 'Create an account to begin.'}
      </p>
      {error && <p className="error-text" role="alert" style={{ marginBottom: '1rem' }}>{error}</p>}
      {message && <p role="status" style={{ color: 'var(--success)', fontSize: '0.9rem', marginBottom: '1rem' }}>{message}</p>}
      {googleAuthEnabled && (
        <>
          <button
            type="button"
            className="secondary"
            disabled={Boolean(pendingAction)}
            onClick={handleGoogleSignIn}
            style={{ width: '100%' }}
          >
            {pendingAction === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="auth-divider" aria-hidden="true"><span>or continue with email</span></div>
        </>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} />
        </div>
        <button type="submit" className="primary" disabled={Boolean(pendingAction)} style={{ width: '100%' }}>
          {pendingAction === 'password' ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <hr className="divider" />
      <p className="muted" style={{ textAlign: 'center' }}>
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button type="button" className="ghost" disabled={Boolean(pendingAction)} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
      <p className="muted" style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.78rem' }}>
        Powered by Anthropic
      </p>
    </div>
  )
}
