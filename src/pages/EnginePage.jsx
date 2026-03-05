import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getQuestionsForSubType } from '../utils/getQuestions'
import { getSystemPrompt, getUserMessage } from '../utils/enginePrompts'
import { LAYERS, getNextLayer } from '../utils/constants'
import { supabase } from '../api/supabase'
import { logTokens, estimateCost } from '../utils/logTokens'

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

async function askClaude(systemPrompt, messages, userId, sessionId, context) {
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

  if (data.usage) {
    logTokens({
      userId,
      sessionId,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      model: 'claude-haiku-4-5-20251001',
      context: context || 'engine'
    })
  }

  return { text: data.content[0].text, usage: data.usage }
}

async function generateVariant(topic, subType, layer, previousQuestions) {
  const questionList = previousQuestions.map(q => q.raw_text).join('\n')
  const variantPrompt = `You are a math exam question generator for "${subType}" in "${topic}".
Study these real exam questions carefully:
${questionList}

Generate ONE new exam-style question that:
- Matches the difficulty and style of the questions above
- Tests the same concept but with different numbers or framing
- For layer "${layer}": ${layer === 'traps' ? 'includes an examiner trick or trap' : layer === 'pressure' ? 'combines multiple concepts under time pressure' : 'is a clean direct application'}

Return ONLY the question text. No explanation. No preamble.`

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
      max_tokens: 512,
      system: variantPrompt,
      messages: [{ role: 'user', content: 'Generate the question.' }]
    })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Variant generation failed')
  return data.content[0].text
}

export default function EnginePage() {
  const { topic: encoded } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [topic, subType, sessionId] = decodeURIComponent(encoded).split('__')

  const [currentLayer, setCurrentLayer] = useState('foundation')
  const [messages, setMessages] = useState([])
  const [answerInput, setAnswerInput] = useState('')
  const [clarifyInput, setClarifyInput] = useState('')
  const [inputMode, setInputMode] = useState('answer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState([])
  const [showErrorClassifier, setShowErrorClassifier] = useState(false)
  const [pendingAnswer, setPendingAnswer] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [variantCount, setVariantCount] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
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
      const { text: reply, usage } = await askClaude(systemPrompt, [{ role: 'user', content: userMsg }], user.id, sessionId, 'foundation_start')
      if (usage) setSessionCost(prev => prev + estimateCost(usage.input_tokens, usage.output_tokens))
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

  async function handleSend(action, content) {
    const text = content || (inputMode === 'clarify' ? clarifyInput : answerInput)
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setShowErrorClassifier(false)

    const userContent = action === 'clarify'
      ? `[Clarification request] ${text}`
      : getUserMessage(action || 'answer', text)

    const newMessages = [...messages, { role: 'user', content: userContent }]
    setMessages(newMessages)

    if (action !== 'clarify' && action !== 'next') {
      setPendingAnswer(text)
    }

    if (inputMode === 'clarify') setClarifyInput('')
    else setAnswerInput('')

    try {
      const systemPrompt = getSystemPrompt(topic, subType, currentLayer, questions)
      const trimmedMessages = newMessages.slice(-6)
      const { text: reply, usage } = await askClaude(systemPrompt, trimmedMessages, user.id, sessionId, 'engine_turn')
      if (usage) setSessionCost(prev => prev + estimateCost(usage.input_tokens, usage.output_tokens))
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      if (action !== 'clarify' && action !== 'next') {
        setShowErrorClassifier(true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestVariant() {
    setLoading(true)
    setError('')
    try {
      const variantText = await generateVariant(topic, subType, currentLayer, questions)
      setVariantCount(v => v + 1)
      const variantQuestion = {
        id: `variant_${variantCount}`,
        raw_text: variantText,
        topic,
        sub_type: subType,
        source: 'ai_generated',
        difficulty_hint: currentLayer === 'traps' ? 'advanced' : 'intermediate'
      }
      setQuestions(prev => [...prev, variantQuestion])

      const announcement = `[AI Variant #${variantCount + 1}]\n\n${variantText}`
      const newMessages = [...messages, { role: 'assistant', content: announcement }]
      setMessages(newMessages)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleErrorClassify(errorType) {
    setShowErrorClassifier(false)
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
      navigate(`/summary?session=${sessionId}`)
      return
    }
    setLoading(true)
    setError('')
    const newLayer = nextLayer.id

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
      const trimmedMessages = newMessages.slice(-6)
      const { text: reply, usage } = await askClaude(systemPrompt, trimmedMessages, user.id, sessionId, 'layer_transition')
      if (usage) setSessionCost(prev => prev + estimateCost(usage.input_tokens, usage.output_tokens))
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleEndSession() {
    try {
      await supabase
        .from('sessions')
        .update({ current_layer: currentLayer })
        .eq('id', sessionId)
    } catch (e) {
      console.error('Failed to update session:', e)
    }
    navigate(`/summary?session=${sessionId}`)
  }

  const visibleMessages = messages.filter(m =>
    !m.content.startsWith('Start the') &&
    !m.content.startsWith('I have completed')
  )

  return (
    <div className="page" style={{ paddingBottom: '16rem' }}>
      {/* Header */}
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.1rem' }}>{subType}</h1>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {topic} · {currentLayerLabel} · Solvd
            {sessionCost > 0 && <span style={{ marginLeft: '1rem' }}>${sessionCost.toFixed(4)}</span>}
          </p>
        </div>
        <span className="spacer" />
        <button
          className="secondary"
          style={{ fontSize: '0.85rem' }}
          onClick={handleEndSession}
          disabled={loading}
        >
          End session
        </button>
        <button className="ghost" onClick={() => navigate('/vault')}>← Vault</button>
      </div>

      {/* Layer progress */}
      <div className="row" style={{ marginBottom: '2rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        {LAYERS.map(l => (
          <span key={l.id} style={{
            fontSize: '0.75rem',
            padding: '0.2rem 0.6rem',
            border: '1px solid var(--border)',
            borderRadius: '2px',
            color: l.id === currentLayer ? 'var(--bg)' : 'var(--fg-muted)',
            background: l.id === currentLayer ? 'var(--fg)' : 'transparent'
          }}>
            {l.label}
          </span>
        ))}
      </div>

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {/* Conversation */}
      <div style={{ marginBottom: '1.5rem' }}>
        {visibleMessages.map((m, i) => (
          <div key={i} style={{
            marginBottom: '1.5rem',
            paddingLeft: m.role === 'user' ? '1.5rem' : '0',
            borderLeft: m.role === 'user' ? '2px solid var(--border)' : 'none'
          }}>
            <p className="muted" style={{
              fontSize: '0.75rem',
              marginBottom: '0.35rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              {m.role === 'user' ? 'You' : 'Atlas'}
            </p>
            <div
              style={{ lineHeight: '1.7' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
            />
          </div>
        ))}

        {loading && (
          <div>
            <p className="muted" style={{
              fontSize: '0.75rem',
              marginBottom: '0.35rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>Atlas</p>
            <p className="muted">Thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error classifier */}
      {showErrorClassifier && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)'
        }}>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            How did that go?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="secondary" style={{ fontSize: '0.85rem' }}
              onClick={() => handleErrorClassify(null)}>
              ✓ Got it right
            </button>
            {Object.entries(ERROR_TYPES).map(([key, label]) => (
              <button key={key} className="secondary" style={{ fontSize: '0.85rem' }}
                onClick={() => handleErrorClassify(key)}>
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
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '680px',
        background: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        padding: '1rem 1.5rem'
      }}>
        {/* Input mode toggle */}
        <div className="row" style={{ marginBottom: '0.75rem', gap: '0.5rem' }}>
          <button
            className={inputMode === 'answer' ? 'primary' : 'secondary'}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
            onClick={() => setInputMode('answer')}
          >
            Submit working
          </button>
          <button
            className={inputMode === 'clarify' ? 'primary' : 'secondary'}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
            onClick={() => setInputMode('clarify')}
          >
            Ask clarification
          </button>
        </div>

        {inputMode === 'answer' ? (
          <>
            <textarea
              value={answerInput}
              onChange={e => setAnswerInput(e.target.value)}
              placeholder="Paste your working here…"
              rows={3}
              disabled={loading}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend('answer') }}
              style={{ marginBottom: '0.75rem' }}
            />
            <div className="row">
              <button className="primary" onClick={() => handleSend('answer')}
                disabled={loading || !answerInput.trim()}>
                Submit
              </button>
              <button className="secondary" onClick={() => handleSend('next', 'I am ready for the next question.')}
                disabled={loading}>
                Next question
              </button>
              <button className="secondary" onClick={handleRequestVariant}
                disabled={loading}>
                + AI variant
              </button>
              {nextLayer && (
                <button className="ghost" onClick={handleNextLayer} disabled={loading}>
                  {nextLayer.label} →
                </button>
              )}
              <span className="spacer" />
              <span className="muted" style={{ fontSize: '0.75rem' }}>Ctrl+Enter</span>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={clarifyInput}
              onChange={e => setClarifyInput(e.target.value)}
              placeholder="Ask anything about this topic or question…"
              rows={3}
              disabled={loading}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend('clarify') }}
              style={{ marginBottom: '0.75rem' }}
            />
            <div className="row">
              <button className="primary" onClick={() => handleSend('clarify')}
                disabled={loading || !clarifyInput.trim()}>
                Ask
              </button>
              <span className="spacer" />
              <span className="muted" style={{ fontSize: '0.75rem' }}>Ctrl+Enter</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
