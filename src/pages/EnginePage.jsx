import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getQuestionsForSubType } from '../utils/getQuestions'
import { getSystemPrompt, getUserMessage } from '../utils/enginePrompts'
import { LAYERS, getNextLayer } from '../utils/constants'
import { supabase } from '../api/supabase'

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const ERROR_TYPES = {
  conceptual_gap: 'Conceptual Gap',
  trap_failure: 'Trap Failure',
  careless: 'Careless Error',
  time_pressure: 'Time Pressure',
  recall_failure: 'Recall Failure'
}

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\$\$(.+?)\$\$/gs, '<em style="font-style:italic; font-family: Georgia, serif;">$1</em>')
    .replace(/\$(.+?)\$/g, '<em style="font-style:italic; font-family: Georgia, serif;">$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^(\d+)\. (.+)$/gm, '<div style="margin-bottom:0.4rem"><strong>$1.</strong> $2</div>')
    .replace(/^[-•] (.+)$/gm, '<div style="margin-bottom:0.4rem; padding-left:1rem">· $1</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

async function askClaude(systemPrompt, messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages
    })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'API error')
  return data.content[0].text
}

export default function EnginePage() {
  const { topic: encoded } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  // Decode topic__subType__sessionId from URL
  const [topic, subType, sessionId] = decodeURIComponent(encoded).split('__')

  const [currentLayer, setCurrentLayer] = useState('foundation')
  const [messages, setMessages] = useState([]) // { role: 'assistant'|'user', content }
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState([])
  const [showErrorClassifier, setShowErrorClassifier] = useState(false)
  const [pendingAnswer, setPendingAnswer] = useState('')
  const [initialized, setInitialized] = useState(false)
  const bottomRef = useRef(null)

  const currentLayerLabel = LAYERS.find(l => l.id === currentLayer)?.label || currentLayer
  const nextLayer = getNextLayer(currentLayer)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!user || initialized) return
    setInitialized(true)
    loadAndStart()
  }, [user])

  async function loadAndStart() {
    setLoading(true)
    setError('')
    try {
      const qs = await getQuestionsForSubType(user.id, topic, subType)
      setQuestions(qs)
      const systemPrompt = getSystemPrompt(topic, subType, 'foundation', qs)
      const userMsg = getUserMessage('start', 'foundation')
      const reply = await askClaude(systemPrompt, [{ role: 'user', content: userMsg }])
      setMessages([
        { role: 'user', content: userMsg },
        { role: 'assistant', content: reply }
      ])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSend(action = 'answer', content = input) {
    if (!content.trim() && action === 'answer') return
    setLoading(true)
    setError('')

    const userContent = getUserMessage(action, content)
    const newMessages = [...messages, { role: 'user', content: userContent }]
    setMessages(newMessages)
    setInput('')

    if (action === 'answer') {
      setPendingAnswer(content)
      setShowErrorClassifier(false)
    }

    try {
      const systemPrompt = getSystemPrompt(topic, subType, currentLayer, questions)
      const reply = await askClaude(systemPrompt, newMessages)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Show error classifier after answer correction
      if (action === 'answer') {
        setShowErrorClassifier(true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleErrorClassify(errorType) {
    setShowErrorClassifier(false)
    // Log attempt to DB
    try {
      await supabase.from('attempts').insert({
        session_id: sessionId,
        layer: currentLayer,
        user_answer: pendingAnswer,
        is_correct: errorType === null,
        error_type: errorType
      })
    } catch (e) {
      console.error('Failed to log attempt:', e)
    }
    setPendingAnswer('')
  }

  async function handleNextLayer() {
    if (!nextLayer) {
      navigate('/summary')
      return
    }
    setLoading(true)
    setError('')
    const newLayer = nextLayer.id

    // Update session in DB
    try {
      await supabase
        .from('sessions')
        .update({ current_layer: newLayer })
        .eq('id', sessionId)
    } catch (e) {
      console.error('Failed to update session layer:', e)
    }

    setCurrentLayer(newLayer)
    const userMsg = getUserMessage('next_layer', newLayer)
    const newMessages = [...messages, { role: 'user', content: userMsg }]
    setMessages(newMessages)

    try {
      const systemPrompt = getSystemPrompt(topic, subType, newLayer, questions)
      const reply = await askClaude(systemPrompt, newMessages)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ paddingBottom: '12rem' }}>
      {/* Header */}
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.1rem' }}>{subType}</h1>
          <p className="muted" style={{ fontSize: '0.85rem' }}>{topic} · {currentLayerLabel}</p>
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={() => navigate('/vault')}>← Vault</button>
      </div>

      {/* Layer progress */}
      <div className="row" style={{ marginBottom: '2rem', gap: '0.5rem' }}>
        {LAYERS.map(l => (
          <span
            key={l.id}
            style={{
              fontSize: '0.75rem',
              padding: '0.2rem 0.6rem',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              color: l.id === currentLayer ? 'var(--bg)' : 'var(--fg-muted)',
              background: l.id === currentLayer ? 'var(--fg)' : 'transparent'
            }}
          >
            {l.label}
          </span>
        ))}
      </div>

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {/* Conversation */}
      <div style={{ marginBottom: '1.5rem' }}>
        {messages
          .filter(m => !m.content.startsWith('Start the') && !m.content.startsWith('I have completed'))
          .map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: '1.5rem',
                paddingLeft: m.role === 'user' ? '1.5rem' : '0',
                borderLeft: m.role === 'user' ? '2px solid var(--border)' : 'none'
              }}
            >
              <p
                className="muted"
                style={{ fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                {m.role === 'user' ? 'You' : 'Engine'}
              </p>
              <div style={{ lineHeight: '1.7' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
            </div>
          ))}

        {loading && (
          <div>
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Engine
            </p>
            <p className="muted">Thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error classifier */}
      {showErrorClassifier && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>Classify your error (or mark correct):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => handleErrorClassify(null)}>
              ✓ Correct
            </button>
            {Object.entries(ERROR_TYPES).map(([key, label]) => (
              <button
                key={key}
                className="secondary"
                style={{ fontSize: '0.85rem' }}
                onClick={() => handleErrorClassify(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fixed input area */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        padding: '1rem 1.5rem',
        maxWidth: '680px',
        margin: '0 auto',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%'
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste your working here…"
          rows={3}
          disabled={loading}
          onKeyDown={e => {
            if (e.key === 'Enter' && e.ctrlKey) handleSend('answer')
          }}
          style={{ marginBottom: '0.75rem' }}
        />
        <div className="row">
          <button
            className="primary"
            onClick={() => handleSend('answer')}
            disabled={loading || !input.trim()}
          >
            Submit working
          </button>
          <button
            className="secondary"
            onClick={() => handleSend('next', 'I understand. I am ready for the next question.')}
            disabled={loading}
          >
            Next question
          </button>
          {nextLayer && (
            <button
              className="ghost"
              onClick={handleNextLayer}
              disabled={loading}
            >
              Next layer →
            </button>
          )}
          <span className="spacer" />
          <span className="muted" style={{ fontSize: '0.75rem' }}>Ctrl+Enter to submit</span>
        </div>
      </div>
    </div>
  )
}
