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
  // Step 1: protect code blocks
  const codeBlocks = []
  let out = text.replace(/```[\s\S]*?```/g, match => {
    codeBlocks.push(match)
    return `%%CODE_${codeBlocks.length - 1}%%`
  })

  // Step 2: escape HTML in non-code, non-table text
  out = out
    .replace(/&/g, '&amp;')
    .replace(/<(?!%%)/g, '&lt;')
    .replace(/>/g, '&gt;')

  // Step 3: convert markdown tables to HTML
  out = out.replace(/((?:\|.*\|[ \t]*\n?)+)/g, tableBlock => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim())
    const isSeparator = r => /^\|[\s\-:|]+\|$/.test(r.trim())
    const parseRow = r =>
      r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

    let html = '<table style="border-collapse:collapse;width:100%;margin:1rem 0;font-size:0.9rem;overflow-x:auto;display:block">'
    let isHeader = true
    for (const row of rows) {
      if (isSeparator(row)) { isHeader = false; continue }
      const cells = parseRow(row)
      const tag = isHeader ? 'th' : 'td'
      const style = isHeader
        ? 'border:1px solid var(--border);padding:0.4rem 0.6rem;text-align:left;background:var(--bg-subtle)'
        : 'border:1px solid var(--border);padding:0.4rem 0.6rem;text-align:left'
      html += '<tr>' + cells.map(c => `<${tag} style="${style}">${c}</${tag}>`).join('') + '</tr>'
      isHeader = false
    }
    html += '</table>'
    return html
  })

  // Step 4: standard markdown
  out = out
    .replace(/\$\$(.+?)\$\$/gs, '<em style="font-style:italic;font-family:Georgia,serif">$1</em>')
    .replace(/\$(.+?)\$/g, '<em style="font-style:italic;font-family:Georgia,serif">$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^(\d+)\. (.+)$/gm, '<div style="margin-bottom:0.4rem"><strong>$1.</strong> $2</div>')
    .replace(/^[-•] (.+)$/gm, '<div style="margin-bottom:0.4rem;padding-left:1rem">· $1</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')

  // Step 5: restore code blocks
  out = out.replace(/%%CODE_(\d+)%%/g, (_, i) => {
    const raw = codeBlocks[parseInt(i)]
    const inner = raw.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return `<pre style="font-family:monospace;font-size:0.85rem;background:var(--bg-subtle);border:1px solid var(--border);border-radius:2px;padding:0.75rem;overflow-x:auto;white-space:pre;margin:0.75rem 0">${inner}</pre>`
  })

  return out
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
    // If session already has a layer beyond foundation, it's a resumed session
    // Load questions silently without calling Claude
    const isResume = sessionId && window.history.state?.resume
    if (isResume) {
      loadQuestionsOnly()
    } else {
      loadAndStart()
    }
  }, [user])

  async function loadQuestionsOnly() {
    setLoading(true)
    setError('')
    try {
      const qs = await getQuestionsForSubType(user.id, topic, subType)
      setQuestions(qs)
      setMessages([{
        role: 'assistant',
        content: `Welcome back. You are in the ${currentLayerLabel} layer.\n\nSubmit your working or ask Atlas a question to continue.`
      }])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

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
            marginBottom: '0',
            padding: '1.25rem 1rem',
            borderLeft: 'none',
            borderBottom: '1px solid var(--border)',
            background: m.role === 'user' ? 'var(--bg-subtle)' : 'transparent',
            borderRadius: '2px',
          }}>
            <p style={{
              fontSize: '0.7rem',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: m.role === 'user' ? 'var(--fg-muted)' : 'var(--fg)',
              fontWeight: m.role === 'assistant' ? 'bold' : 'normal'
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
      <div className="engine-input-bar" style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '680px',
        background: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        padding: '0.5rem 1rem'
      }}>
        {/* Single row: mode toggle + action buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          <button
            className={inputMode === 'answer' ? 'primary' : 'secondary'}
            style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}
            onClick={() => setInputMode('answer')}
          >
            Working
          </button>
          <button
            className={inputMode === 'clarify' ? 'primary' : 'secondary'}
            style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}
            onClick={() => setInputMode('clarify')}
          >
            Clarify
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="secondary"
            onClick={() => handleSend('next', 'I am ready for the next question.')}
            disabled={loading}
            style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}
          >
            Next
          </button>
          <button
            className="secondary"
            onClick={handleRequestVariant}
            disabled={loading}
            style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}
          >
            + Variant
          </button>
          {nextLayer && (
            <button
              className="ghost"
              onClick={handleNextLayer}
              disabled={loading}
              style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem', minHeight: '36px' }}
            >
              {nextLayer.label} →
            </button>
          )}
        </div>

        {/* Textarea + submit in one row */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <textarea
            value={inputMode === 'answer' ? answerInput : clarifyInput}
            onChange={e => inputMode === 'answer'
              ? setAnswerInput(e.target.value)
              : setClarifyInput(e.target.value)
            }
            placeholder={inputMode === 'answer' ? 'Paste your working…' : 'Ask anything…'}
            rows={2}
            disabled={loading}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.ctrlKey) handleSend(inputMode === 'answer' ? 'answer' : 'clarify')
            }}
            style={{ flex: 1, marginBottom: 0, minHeight: '60px' }}
          />
          <button
            className="primary"
            onClick={() => handleSend(inputMode === 'answer' ? 'answer' : 'clarify')}
            disabled={loading || !(inputMode === 'answer' ? answerInput.trim() : clarifyInput.trim())}
            style={{ minHeight: '60px', padding: '0 1rem', whiteSpace: 'nowrap' }}
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
