import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getPatterns } from '../utils/getPatterns'
import { supabase } from '../api/supabase'

function buildSimulationPrompt(data) {
  const examPapers = data.papers.filter(p => p.assessment_type === 'Past Exam')
  const topTopics = data.topicFrequency.slice(0, 10)
  const favourites = data.topicFrequency
    .flatMap(t => t.subtypes.filter(s => s.isFavourite)
      .map(s => `${t.topic} — ${s.sub_type} (${s.paperCount}/${examPapers.length} papers)`))
  const positions = data.positionPatterns
    .map(p => `${p.position}: ${p.topics.slice(0, 2).map(t => t.topic).join(' / ')}`)

  const hasMarks = data.markPatterns.length > 0
  const avgMarksPerQ = hasMarks
    ? Math.round(data.markPatterns.reduce((s, m) => s + m.totalMarks, 0) / data.positionPatterns.length)
    : 25

  return `You are Atlas, an expert math exam simulator. Generate ONE complete simulated exam paper based on these detected patterns from ${examPapers.length} past exam papers.

DETECTED PAPER STRUCTURE:
- Papers analysed: ${examPapers.map(p => p.name).join(', ')}
- Typical questions per paper: ${data.positionPatterns.length}
- Marks per question: approximately ${avgMarksPerQ}
- Question position patterns: ${positions.join(' | ')}

TOPIC FREQUENCY (most examined first):
${topTopics.map(t => `- ${t.topic}: ${t.count} questions across ${t.paperCount}/${examPapers.length} papers`).join('\n')}

EXAMINER FAVOURITES (appear in multiple papers):
${favourites.slice(0, 12).join('\n') || 'Insufficient data'}

${hasMarks ? `MARK ALLOCATION PATTERNS:\n${data.markPatterns.slice(0, 8).map(m => `- ${m.topic}: avg ${m.avgMarks} marks per question`).join('\n')}` : ''}

INSTRUCTIONS FOR GENERATION:
1. Generate exactly ${Math.min(data.positionPatterns.length, 7)} questions following the detected position patterns
2. Each question must have exactly 3 lettered parts: (a), (b), (c)
3. Each part may have sub-parts (i), (ii) where needed — keep sub-parts minimal, 1-2 per part maximum
4. Assign realistic mark allocations matching the patterns — each question should total approximately ${avgMarksPerQ} marks
5. Follow the topic order detected in position patterns
6. Use the examiner favourite sub-types as the specific question content
7. Write questions at the appropriate difficulty for the course level detected
8. Include realistic mathematical notation and specific values/functions

Respond with ONLY a valid JSON object in exactly this format — no preamble, no explanation:
{
  "title": "Simulated Exam Paper",
  "subtitle": "Based on ${examPapers.length} past paper${examPapers.length !== 1 ? 's' : ''} — For practice only",
  "instructions": ["string", "string"],
  "timeMinutes": number,
  "totalMarks": number,
  "questions": [
    {
      "number": "1",
      "parts": [
        {
          "label": "a",
          "text": "full question text",
          "marks": number,
          "subparts": [
            { "label": "i", "text": "sub-question text", "marks": number }
          ]
        }
      ],
      "totalMarks": number
    }
  ]
}`
}

function renderQuestionText(text) {
  if (!text) return ''

  // Split into segments — detect table blocks vs normal text
  // Tables: lines that start and end with | and have multiple cells
  const lines = text.split('\n')
  const segments = []
  let tableLines = []
  let textLines = []

  function flushText() {
    if (textLines.length > 0) {
      segments.push({ type: 'text', content: textLines.join('\n') })
      textLines = []
    }
  }

  function flushTable() {
    if (tableLines.length > 0) {
      segments.push({ type: 'table', content: tableLines.join('\n') })
      tableLines = []
    }
  }

  function isTableLine(line) {
    const trimmed = line.trim()
    // Must start and end with | and have at least 2 pipe chars total
    const pipes = (trimmed.match(/\|/g) || []).length
    return trimmed.startsWith('|') && trimmed.endsWith('|') && pipes >= 3
  }

  for (const line of lines) {
    if (isTableLine(line)) {
      flushText()
      tableLines.push(line)
    } else {
      flushTable()
      textLines.push(line)
    }
  }
  flushText()
  flushTable()

  // Also handle inline tables on a single line
  // e.g. "| x | 1 | 2 | | P(X=x) | 0.1 | k |"
  const result = segments.map(seg => {
    if (seg.type === 'table') {
      return renderTable(seg.content)
    }
    // Check for inline table pattern in text
    const inlineTablePattern = /(\|(?:[^|\n]+\|){2,})/g
    if (inlineTablePattern.test(seg.content)) {
      // Split text around inline table segments
      return seg.content.replace(
        /(\|(?:[^|\n]+\|){2,}(?:\s*\|(?:[^|\n]+\|){2,})*)/g,
        match => renderTable(match)
      )
    }
    return seg.content
  }).join('')

  return result
}

function renderTable(tableText) {
  const rows = tableText.trim().split('\n').filter(r => r.trim())
  const isSeparator = r => /^\|[\s\-:|]+\|$/.test(r.trim())
  const parseRow = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

  // Handle single-line table (all rows concatenated)
  const allRows = rows.length === 1
    ? tableText.trim().split(/\|\s*\|/).map(r => '|' + r + '|').filter(r => r.trim() !== '||')
    : rows

  let html = '<table style="border-collapse:collapse;margin:0.5rem 0;font-size:0.85rem">'
  let isHeader = true
  for (const row of allRows) {
    if (!row.trim()) continue
    if (isSeparator(row)) { isHeader = false; continue }
    const cells = parseRow(row)
    if (cells.length < 2) continue
    const tag = isHeader ? 'th' : 'td'
    const style = isHeader
      ? 'border:1px solid var(--border);padding:0.3rem 0.6rem;text-align:center;background:var(--bg-subtle)'
      : 'border:1px solid var(--border);padding:0.3rem 0.6rem;text-align:center'
    html += '<tr>' + cells.map(c => `<${tag} style="${style}">${c}</${tag}>`).join('') + '</tr>'
    isHeader = false
  }
  html += '</table>'
  return html
}

export default function SimulatePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [patterns, setPatterns] = useState(null)
  const [exam, setExam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('brief') // brief | exam

  useEffect(function () {
    if (!user) return
    loadPatterns()
  }, [user])

  async function loadPatterns() {
    setLoading(true)
    try {
      const data = await getPatterns(user.id)
      if (data.confidence < 70) {
        navigate('/patterns')
        return
      }
      setPatterns(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function generateExam() {
    if (!patterns) return
    setGenerating(true)
    setError('')

    try {
      const prompt = buildSimulationPrompt(patterns)
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
          body: JSON.stringify({
            systemPrompt: 'You are Atlas, an expert math exam generator. You generate realistic exam papers in valid JSON format only. Never include text outside the JSON object.',
            messages: [{ role: 'user', content: prompt }],
            context: 'exam_simulation',
            maxTokens: 8192
          })
        }
      )

      const result = await response.json()
      if (result.error) throw new Error(result.error)

      const raw = result.text.replace(/```json|```/g, '').trim()
      const examData = JSON.parse(raw)
      setExam(examData)
      setView('exam')
    } catch (e) {
      setError('Failed to generate exam: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  if (loading) return (
    <div className="page">
      <p className="muted">Loading pattern data…</p>
    </div>
  )

  if (error) return (
    <div className="page">
      <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>
      <button className="secondary" onClick={() => navigate('/patterns')}>← Back to Patterns</button>
    </div>
  )

  // Brief view
  if (view === 'brief' && patterns) {
    const examPapers = patterns.papers.filter(p => p.assessment_type === 'Past Exam')
    const topTopics = patterns.topicFrequency.slice(0, 6)

    return (
      <div className="page">
        <div className="row" style={{ marginBottom: '1.5rem' }}>
          <h1>Exam Simulator</h1>
          <span className="spacer" />
          <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>
            ← Patterns
          </button>
        </div>

        <p className="muted" style={{ marginBottom: '2rem', fontSize: '0.9rem' }}>
          Atlas will generate a full simulated exam based on patterns detected from {examPapers.length} past paper{examPapers.length !== 1 ? 's' : ''}.
        </p>

        {/* Pattern summary */}
        <div style={{
          padding: '1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: '1.5rem'
        }}>
          <p style={{
            fontSize: '0.75rem', textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem'
          }}>
            Based on
          </p>
          {examPapers.map(p => (
            <p key={p.id} style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>· {p.name}</p>
          ))}
        </div>

        <div style={{
          padding: '1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: '1.5rem'
        }}>
          <p style={{
            fontSize: '0.75rem', textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem'
          }}>
            Likely topics
          </p>
          {topTopics.map(t => (
            <div key={t.topic} className="row" style={{
              padding: '0.3rem 0',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.85rem'
            }}>
              <span>{t.topic}</span>
              <span className="spacer" />
              <span className="muted">{t.paperCount}/{examPapers.length} papers</span>
            </div>
          ))}
        </div>

        <div style={{
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: '2rem',
          fontSize: '0.85rem',
          color: 'var(--fg-muted)'
        }}>
          ⚠ This simulation is for practice only. It is not a prediction of your actual exam.
          Questions are generated based on historical patterns and may not reflect the exact format of future papers.
        </div>

        <button
          className="primary"
          onClick={generateExam}
          disabled={generating}
          style={{ width: '100%', padding: '0.75rem' }}
        >
          {generating ? 'Atlas is generating your exam…' : 'Generate simulated exam'}
        </button>
      </div>
    )
  }

  // Exam view
  if (view === 'exam' && exam) {
    return (
      <>
        {/* Screen controls — hidden on print */}
        <div className="no-print" style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          padding: '0.75rem 1.5rem',
          display: 'flex', gap: '0.75rem', alignItems: 'center',
          zIndex: 100
        }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Simulated Exam</span>
          <span className="spacer" />
          <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => { setView('brief'); setExam(null) }}>
            Regenerate
          </button>
          <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>
            ← Patterns
          </button>
          <button className="primary" style={{ fontSize: '0.85rem' }} onClick={handlePrint}>
            Print / Save PDF
          </button>
        </div>

        {/* Exam paper */}
        <div className="exam-paper" style={{
          maxWidth: '680px',
          margin: '0 auto',
          padding: '5rem 2rem 4rem',
          fontFamily: 'Georgia, serif'
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '2rem', borderBottom: '2px solid var(--fg)', paddingBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.25rem', color: 'var(--fg-muted)' }}>Solvd · Practice Paper</p>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{exam.title}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>{exam.subtitle}</p>
            {exam.timeMinutes && (
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Time Allowed: {Math.floor(exam.timeMinutes / 60)} hour{Math.floor(exam.timeMinutes / 60) !== 1 ? 's' : ''}
                {exam.timeMinutes % 60 > 0 ? ` ${exam.timeMinutes % 60} minutes` : ''}
              </p>
            )}
          </div>

          {/* Instructions */}
          {exam.instructions && exam.instructions.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Instructions:</p>
              {exam.instructions.map((inst, i) => (
                <p key={i} style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>{i + 1}. {inst}</p>
              ))}
            </div>
          )}

          <hr style={{ borderColor: 'var(--border)', marginBottom: '2rem' }} />

          {/* Questions */}
          {(exam.questions || []).map((q, qi) => (
            <div key={qi} style={{ marginBottom: '2.5rem' }}>
              <div className="row" style={{ marginBottom: '0.75rem' }}>
                <p style={{ fontWeight: 'bold', fontSize: '1rem' }}>Question {q.number}.</p>
                <span className="spacer" />
                {q.totalMarks && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>[{q.totalMarks} marks]</p>
                )}
              </div>

              {(q.parts || []).map((part, pi) => (
                <div key={pi} style={{ marginBottom: '1rem', paddingLeft: '1rem' }}>
                  <div className="row" style={{ marginBottom: '0.4rem', alignItems: 'flex-start' }}>
                    <p style={{ fontSize: '0.95rem', flex: 1 }}>
                      <strong>({part.label})</strong>{' '}
                      <span dangerouslySetInnerHTML={{ __html: renderQuestionText(part.text) }} />
                    </p>
                    {part.marks && !part.subparts?.length && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginLeft: '1rem', whiteSpace: 'nowrap' }}>
                        [{part.marks}]
                      </span>
                    )}
                  </div>

                  {(part.subparts || []).map((sub, si) => (
                    <div key={si} className="row" style={{
                      paddingLeft: '1.5rem',
                      marginBottom: '0.4rem',
                      alignItems: 'flex-start'
                    }}>
                      <p style={{ fontSize: '0.9rem', flex: 1 }}>
                        <strong>{sub.label}.</strong>{' '}
                        <span dangerouslySetInnerHTML={{ __html: renderQuestionText(sub.text) }} />
                      </p>
                      {sub.marks && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginLeft: '1rem', whiteSpace: 'nowrap' }}>
                          [{sub.marks}]
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* Footer */}
          <div style={{
            marginTop: '3rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--fg-muted)'
          }}>
            Generated by Solvd · solvd.trymyapp.uk · For practice only — not a prediction
          </div>
        </div>

        {/* Print styles */}
        <style>{`
          @media print {
            .no-print { display: none !important; }
            body { background: white !important; color: black !important; }
            .exam-paper { padding: 2rem !important; max-width: 100% !important; }
          }
        `}</style>
      </>
    )
  }

  return null
}
