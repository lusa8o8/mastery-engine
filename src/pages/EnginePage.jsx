import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getQuestionsForSubType } from '../utils/getQuestions'
import { getSystemPrompt, getUserMessage } from '../utils/enginePrompts'
import { LAYERS, getNextLayer } from '../utils/constants'
import { supabase } from '../api/supabase'
import { logTokens, estimateCost } from '../utils/logTokens'

const ERROR_TYPES = {
  conceptual_gap: 'Conceptual Gap',
  trap_failure: 'Trap Failure',
  careless: 'Careless Error',
  time_pressure: 'Time Pressure',
  recall_failure: 'Recall Failure'
}

const shadeRegion = (regionId, circles, is3Set, w, h, shadeFill, shadeOpacity) => {
  const inSets = []
  const outSets = []
  const count = is3Set ? 3 : 2
  const map3 = {
    A_only: [0], B_only: [1], C_only: [2],
    A_intersect_B: [0, 1], A_intersect_C: [0, 2], B_intersect_C: [1, 2],
    A_intersect_B_intersect_C: [0, 1, 2],
    outside: []
  }
  const map2 = {
    A_only: [0], B_only: [1],
    A_intersect_B: [0, 1],
    outside: []
  }
  const map = is3Set ? map3 : map2
  const ins = map[regionId] || []
  for (let i = 0; i < count; i++) {
    ins.includes(i) ? inSets.push(i) : outSets.push(i)
  }
  if (regionId === 'outside') {
    return {
      html: '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '"/>' +
        circles.map(function (c) { return '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" fill="var(--bg)"/>'; }).join(''),
      extraDefs: ''
    }
  }
  if (inSets.length === 0) return { html: '', extraDefs: '' }
  if (outSets.length === 0) {
    const html = inSets.reduce(function (inner, i) {
      return '<g clip-path="url(#cp' + i + ')">' + inner + '</g>'
    }, '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '"/>')
    return { html: html, extraDefs: '' }
  }
  const maskId = 'mask_' + regionId.replace(/\W/g, '_')
  let maskContent = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="black"/>'
  maskContent += '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="white" ' +
    inSets.map(function (i) { return 'clip-path="url(#cp' + i + ')"'; }).join(' ') + '/>'
  outSets.forEach(function (i) {
    maskContent += '<circle cx="' + circles[i].x + '" cy="' + circles[i].y + '" r="' + circles[i].r + '" fill="black"/>'
  })
  const extraDefs = '<mask id="' + maskId + '">' + maskContent + '</mask>'
  const html = inSets.reduce(function (inner, i) {
    return '<g clip-path="url(#cp' + i + ')">' + inner + '</g>'
  }, '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + shadeFill + '" opacity="' + shadeOpacity + '" mask="url(#' + maskId + ')"/>')
  return { html: html, extraDefs: extraDefs }
}

function renderVennDiagram(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    const sets = Array.isArray(data.sets) ? data.sets : []
    const shaded = Array.isArray(data.shaded) ? data.shaded : []
    const universal = data.universal || 'U'
    const is3Set = sets.length === 3
    const w = 320
    const h = is3Set ? 320 : 240
    const cx = w / 2
    const cy = is3Set ? 130 : h / 2
    const circles = is3Set ? [
      { x: cx - 45, y: cy - 30, r: 75, label: sets[0] },
      { x: cx + 45, y: cy - 30, r: 75, label: sets[1] },
      { x: cx, y: cy + 55, r: 75, label: sets[2] }
    ] : [
      { x: cx - 50, y: cy, r: 85, label: sets[0] },
      { x: cx + 50, y: cy, r: 85, label: sets[1] }
    ]
    const fg = 'var(--fg)'
    const shadeFill = 'var(--border-focus)'
    const shadeOpacity = '0.45'
    const circleStroke = 'var(--border-focus)'
    let clipPaths = ''
    circles.forEach(function (c, i) {
      clipPaths += '<clipPath id="cp' + i + '"><circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '"/></clipPath>'
    })
    let extraDefs = ''
    let shadeLayers = ''
    shaded.forEach(function (regionId) {
      const result = shadeRegion(regionId, circles, is3Set, w, h, shadeFill, shadeOpacity)
      extraDefs += result.extraDefs
      shadeLayers += result.html
    })
    const finalDefs = '<defs>' + clipPaths + extraDefs + '</defs>'
    const circleOutlines = circles.map(function (c) {
      return '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" fill="transparent" stroke="' + circleStroke + '" stroke-width="1.5"/>'
    }).join('')
    const labelOffsets = is3Set
      ? [{ dx: -75, dy: -65 }, { dx: 75, dy: -65 }, { dx: 0, dy: 95 }]
      : [{ dx: -80, dy: 0 }, { dx: 80, dy: 0 }]
    const labels = circles.map(function (c, i) {
      return '<text x="' + (c.x + labelOffsets[i].dx) + '" y="' + (c.y + labelOffsets[i].dy) + '" text-anchor="middle" font-size="13" font-family="Georgia,serif" fill="' + fg + '" font-weight="bold">' + c.label + '</text>'
    }).join('')
    const uLabel = '<text x="8" y="18" font-size="11" font-family="Georgia,serif" fill="' + fg + '" opacity="0.6">' + universal + '</text>'
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" style="display:block;margin:1rem auto;border:1px solid var(--border);border-radius:2px;background:var(--bg)">' +
      finalDefs +
      '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '" rx="2" fill="transparent" stroke="var(--border)" stroke-width="1"/>' +
      shadeLayers +
      circleOutlines +
      labels +
      uLabel +
      '</svg>'
  } catch (e) {
    console.error('Venn error:', e, jsonStr)
    return '<p style="color:var(--error);font-size:0.85rem">Diagram unavailable (' + e.message + ')</p>'
  }
}

function renderMarkdown(text) {
  const codeBlocks = []
  const vennBlocks = []
  let out = text.replace(/```venn\n([\s\S]*?)```/g, function (match, json) {
    vennBlocks.push(json.trim())
    return '%%VENN_' + (vennBlocks.length - 1) + '%%'
  })
  out = out.replace(/```[\s\S]*?```/g, function (match) {
    codeBlocks.push(match)
    return '%%CODE_' + (codeBlocks.length - 1) + '%%'
  })
  out = out
    .replace(/&/g, '&amp;')
    .replace(/<(?!%%)/g, '&lt;')
    .replace(/>/g, '&gt;')
  out = out.replace(/((?:\|.*\|[ \t]*\n?)+)/g, function (tableBlock) {
    const rows = tableBlock.trim().split('\n').filter(function (r) { return r.trim() })
    const isSeparator = function (r) { return /^\|[\s\-:|]+\|$/.test(r.trim()) }
    const parseRow = function (r) {
      return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() })
    }
    let html = '<table style="border-collapse:collapse;width:100%;margin:1rem 0;font-size:0.9rem;overflow-x:auto;display:block">'
    let isHeader = true
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (isSeparator(row)) { isHeader = false; continue }
      const cells = parseRow(row)
      const tag = isHeader ? 'th' : 'td'
      const style = isHeader
        ? 'border:1px solid var(--border);padding:0.4rem 0.6rem;text-align:left;background:var(--bg-subtle)'
        : 'border:1px solid var(--border);padding:0.4rem 0.6rem;text-align:left'
      html += '<tr>' + cells.map(function (c) { return '<' + tag + ' style="' + style + '">' + c + '</' + tag + '>' }).join('') + '</tr>'
      isHeader = false
    }
    html += '</table>'
    return html
  })
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
  out = out.replace(/%%VENN_(\d+)%%/g, function (match, i) {
    return renderVennDiagram(vennBlocks[parseInt(i)])
  })
  out = out.replace(/%%CODE_(\d+)%%/g, function (match, i) {
    const raw = codeBlocks[parseInt(i)]
    const inner = raw.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return '<pre style="font-family:monospace;font-size:0.85rem;background:var(--bg-subtle);border:1px solid var(--border);border-radius:2px;padding:0.75rem;overflow-x:auto;white-space:pre;margin:0.75rem 0">' + inner + '</pre>'
  })
  return out
}

async function askClaude(systemPrompt, messages, userId, sessionId, context) {
  const { data: { session } } = await supabase.auth.getSession()
  
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atlas-chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ systemPrompt, messages, sessionId, context })
    }
  )

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'atlas-chat error')
  if (data.error) throw new Error(data.error)
  return { text: data.text, usage: data.usage }
}

async function generateVariant(topic, subType, layer, previousQuestions) {
  const questionList = previousQuestions.map(function (q) { return q.raw_text }).join('\n')
  const variantPrompt = 'You are a math exam question generator for "' + subType + '" in "' + topic + '".\nStudy these real exam questions carefully:\n' + questionList + '\n\nGenerate ONE new exam-style question that:\n- Matches the difficulty and style of the questions above\n- Tests the same concept but with different numbers or framing\n- For layer "' + layer + '": ' + (layer === 'traps' ? 'includes an examiner trick or trap' : layer === 'pressure' ? 'combines multiple concepts under time pressure' : 'is a clean direct application') + '\n\nReturn ONLY the question text. No explanation. No preamble.'
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

  const currentLayerLabel = LAYERS.find(function (l) { return l.id === currentLayer })?.label || currentLayer
  const nextLayer = getNextLayer(currentLayer)

  useEffect(function () {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(function () {
    if (!user || initialized) return
    setInitialized(true)
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
      setQuestions(qs || [])
      setMessages([{
        role: 'assistant',
        content: 'Welcome back. You are in the ' + currentLayerLabel + ' layer.\n\nSubmit your working or ask Atlas a question to continue.'
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
      const safeQs = qs || []
      setQuestions(safeQs)
      const systemPrompt = getSystemPrompt(topic, subType, 'foundation', safeQs)
      const userMsg = getUserMessage('start', 'foundation')
      const { text: reply, usage } = await askClaude(systemPrompt, [{ role: 'user', content: userMsg }], user.id, sessionId, 'foundation_start')
      if (usage) setSessionCost(function (prev) { return prev + estimateCost(usage.input_tokens, usage.output_tokens) })
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
      ? '[Clarification request] ' + text
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
      if (usage) setSessionCost(function (prev) { return prev + estimateCost(usage.input_tokens, usage.output_tokens) })
      setMessages(function (prev) { return [...prev, { role: 'assistant', content: reply }] })
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
      setVariantCount(function (v) { return v + 1 })
      const variantQuestion = {
        id: 'variant_' + variantCount,
        raw_text: variantText,
        topic: topic,
        sub_type: subType,
        source: 'ai_generated',
        difficulty_hint: currentLayer === 'traps' ? 'advanced' : 'intermediate'
      }
      setQuestions(function (prev) { return [...prev, variantQuestion] })
      const announcement = '[AI Variant #' + (variantCount + 1) + ']\n\n' + variantText
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
      navigate('/summary?session=' + sessionId)
      return
    }
    setLoading(true)
    setError('')
    const newLayer = nextLayer.id
    try {
      await supabase.from('sessions').update({ current_layer: newLayer }).eq('id', sessionId)
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
      if (usage) setSessionCost(function (prev) { return prev + estimateCost(usage.input_tokens, usage.output_tokens) })
      setMessages(function (prev) { return [...prev, { role: 'assistant', content: reply }] })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleEndSession() {
    try {
      await supabase.from('sessions').update({ current_layer: currentLayer }).eq('id', sessionId)
    } catch (e) {
      console.error('Failed to update session:', e)
    }
    navigate('/summary?session=' + sessionId)
  }

  const visibleMessages = messages.filter(function (m) {
    return !m.content.startsWith('Start the') &&
      !m.content.startsWith('I have completed') &&
      !m.content.startsWith('I understand. I am ready') &&
      !m.content.startsWith('[Clarification request]')
  }).map(function (m) {
    if (m.role === 'user') {
      return Object.assign({}, m, {
        content: m.content
          .replace(/\n\nPlease assess it honestly[\s\S]*$/, '')
          .replace(/^Here is my working:\n\n/, '')
          .trim()
      })
    }
    return m
  })

  return (
    <div className="page" style={{ paddingBottom: '16rem' }}>
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.1rem' }}>{subType}</h1>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {topic} · {currentLayerLabel} · Solvd
            {sessionCost > 0 && <span style={{ marginLeft: '1rem' }}>${sessionCost.toFixed(4)}</span>}
          </p>
        </div>
        <span className="spacer" />
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={handleEndSession} disabled={loading}>
          End session
        </button>
        <button className="ghost" onClick={() => navigate('/vault')}>← Vault</button>
      </div>

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

      <div style={{ marginBottom: '1.5rem' }}>
        {visibleMessages.map((m, i) => (
          <div key={i} style={{
            marginBottom: '0',
            padding: '1.25rem 1rem',
            borderLeft: 'none',
            borderBottom: '1px solid var(--border)',
            background: m.role === 'user' ? 'var(--bg-subtle)' : 'transparent',
            borderRadius: '2px'
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
            <div style={{ lineHeight: '1.7' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
          </div>
        ))}
        {loading && (
          <div>
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Atlas</p>
            <p className="muted">Thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showErrorClassifier && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>How did that go?</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => handleErrorClassify(null)}>✓ Got it right</button>
            {Object.entries(ERROR_TYPES).map(([key, label]) => (
              <button key={key} className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => handleErrorClassify(key)}>{label}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '680px', background: 'var(--bg)', borderTop: '1px solid var(--border)', padding: '0.5rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          <button className={inputMode === 'answer' ? 'primary' : 'secondary'} style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }} onClick={() => setInputMode('answer')}>Working</button>
          <button className={inputMode === 'clarify' ? 'primary' : 'secondary'} style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }} onClick={() => setInputMode('clarify')}>Clarify</button>
          <span style={{ flex: 1 }} />
          <button className="secondary" onClick={() => handleSend('next', 'I am ready for the next question.')} disabled={loading} style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}>Next</button>
          <button className="secondary" onClick={handleRequestVariant} disabled={loading} style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', minHeight: '36px' }}>+ Variant</button>
          {nextLayer && (
            <button className="ghost" onClick={handleNextLayer} disabled={loading} style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem', minHeight: '36px' }}>{nextLayer.label} →</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <textarea
            value={inputMode === 'answer' ? answerInput : clarifyInput}
            onChange={e => inputMode === 'answer' ? setAnswerInput(e.target.value) : setClarifyInput(e.target.value)}
            placeholder={inputMode === 'answer' ? 'Paste your working…' : 'Ask anything…'}
            rows={2}
            disabled={loading}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend(inputMode === 'answer' ? 'answer' : 'clarify') }}
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
