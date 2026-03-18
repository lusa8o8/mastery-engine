import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getPatterns } from '../utils/getPatterns'
import { supabase } from '../api/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'

function ConfidenceMeter({ score, level }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)' }}>
          Pattern confidence
        </p>
        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: level.color }}>
          {score}%
        </span>
      </div>
      <div style={{
        height: '8px',
        background: 'var(--bg-subtle)',
        borderRadius: '4px',
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${score}%`,
          background: level.color,
          borderRadius: '4px',
          transition: 'width 0.6s ease'
        }} />
      </div>
      <p style={{ fontSize: '0.8rem', color: level.color, marginTop: '0.35rem' }}>
        {level.label}
      </p>
    </div>
  )
}

function BreakdownItem({ label, score, tip }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '0.85rem' }}>{label}</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>{score}%</span>
      </div>
      <div style={{
        height: '4px',
        background: 'var(--bg-subtle)',
        borderRadius: '2px',
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${score}%`,
          background: score >= 70 ? 'var(--fg)' : score >= 40 ? '#c4913a' : 'var(--error)',
          borderRadius: '2px',
          transition: 'width 0.6s ease'
        }} />
      </div>
      {tip && (
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.2rem' }}>
          → {tip}
        </p>
      )}
    </div>
  )
}

export default function PatternsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [narrative, setNarrative] = useState('')
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(function () {
    if (!user) return
    loadPatterns()
  }, [user])

  async function loadPatterns() {
    setLoading(true)
    setError('')
    try {
      const result = await getPatterns(user.id)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadNarrative() {
    if (!data || data.confidence < 40) return
    setNarrativeLoading(true)
    setNarrative('')

    const examPapers = data.papers.filter(p => p.assessment_type === 'Past Exam')
    const topFavourites = data.topicFrequency
      .flatMap(t => t.subtypes.filter(s => s.isFavourite).map(s => `${t.topic} — ${s.sub_type}`))
      .slice(0, 10)
      .join('\n')

    const topPositions = data.positionPatterns
      .map(p => `${p.position}: ${p.topics[0]?.topic || 'Unknown'}`)
      .join(', ')

    const prompt = `You are Atlas, an expert math exam coach. Analyse these exam patterns for ${examPapers.length} past exam papers and write a focused 3-paragraph examiner pattern report.

TOPIC FREQUENCY DATA:
${data.topicFrequency.map(t => `${t.topic}: appeared in ${t.paperCount}/${examPapers.length} papers, ${t.count} questions total`).join('\n')}

EXAMINER FAVOURITES (appear in 2+ papers):
${topFavourites || 'Insufficient data'}

QUESTION POSITION PATTERNS:
${topPositions || 'Insufficient data'}

${data.markPatterns.length > 0 ? `MARK ALLOCATION:\n${data.markPatterns.map(m => `${m.topic}: avg ${m.avgMarks} marks per question`).join('\n')}` : ''}

Write exactly 3 paragraphs:
1. "What this examiner always tests" — topics that appear every year, their typical question formats
2. "Paper structure and examiner preferences" — how the paper is organised, what position topics appear in
3. "Your highest-value focus areas" — specific sub-topics worth the most marks or appearing most frequently

Be direct, specific, and actionable. Write for a student preparing for this exact exam. No preamble.`

    try {
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
            systemPrompt: 'You are Atlas, an expert math exam pattern analyst. Write clear, direct exam preparation advice.',
            messages: [{ role: 'user', content: prompt }],
            context: 'pattern_analysis'
          })
        }
      )
      const result = await response.json()
      if (result.error) throw new Error(result.error)
      setNarrative(result.text)
    } catch (e) {
      setNarrative('Could not generate analysis. Try again.')
    } finally {
      setNarrativeLoading(false)
    }
  }

  function renderMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
  }

  if (loading) return (
    <div className="page">
      <p className="muted">Loading patterns…</p>
    </div>
  )

  if (error) return (
    <div className="page">
      <p className="error-text">{error}</p>
    </div>
  )

  const examPapers = data?.papers.filter(p => p.assessment_type === 'Past Exam') || []

  return (
    <div className="page">
      {/* Header */}
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <h1>Patterns</h1>
        <span className="spacer" />
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/vault')}>← Vault</button>
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/home')}>Home</button>
      </div>

      {/* Exam papers context */}
      <p className="muted" style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
        Analysing {examPapers.length} Past Exam paper{examPapers.length !== 1 ? 's' : ''}.
        {examPapers.length > 0 && (
          <span> ({examPapers.map(p => p.name).join(', ')})</span>
        )}
      </p>

      {/* Confidence meter */}
      {data && (
        <ConfidenceMeter score={data.confidence} level={data.confidenceLevel} />
      )}

      {/* Insufficient data state */}
      {data && data.confidence < 40 && (
        <div style={{
          padding: '1.5rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: '2rem'
        }}>
          <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>Not enough data for pattern analysis</p>
          {data.breakdown && (
            <div>
              <BreakdownItem {...data.breakdown.papers} />
              <BreakdownItem {...data.breakdown.marks} />
              <BreakdownItem {...data.breakdown.structure} />
              <BreakdownItem {...data.breakdown.breadth} />
            </div>
          )}
          <button className="primary" style={{ marginTop: '1rem' }} onClick={() => navigate('/upload')}>
            Upload more papers
          </button>
        </div>
      )}

      {/* Main content — only show if confidence >= 40 */}
      {data && data.confidence >= 40 && (
        <div>
          {/* Confidence breakdown */}
          <div style={{ marginBottom: '2rem' }}>
            <p style={{
              fontSize: '0.75rem', textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem'
            }}>
              Confidence breakdown
            </p>
            <BreakdownItem {...data.breakdown.papers} />
            <BreakdownItem {...data.breakdown.marks} />
            <BreakdownItem {...data.breakdown.structure} />
            <BreakdownItem {...data.breakdown.breadth} />
          </div>

          <div className="divider" />

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', marginTop: '1.5rem' }}>
            {['overview', 'favourites', 'structure', 'atlas'].map(tab => (
              <button
                key={tab}
                className={activeTab === tab ? 'primary' : 'secondary'}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem', textTransform: 'capitalize' }}
                onClick={() => {
                  setActiveTab(tab)
                  if (tab === 'atlas' && !narrative && !narrativeLoading) loadNarrative()
                }}
              >
                {tab === 'atlas' ? 'Atlas Analysis' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <div>
              <p style={{
                fontSize: '0.75rem', textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '1rem'
              }}>
                Topic frequency across {examPapers.length} exam paper{examPapers.length !== 1 ? 's' : ''}
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={data.topicFrequency.slice(0, 10).map(t => ({
                    topic: t.topic.length > 12 ? t.topic.slice(0, 12) + '…' : t.topic,
                    questions: t.count,
                    papers: t.paperCount
                  }))}
                  margin={{ top: 5, right: 10, left: 0, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="topic"
                    tick={{ fontSize: 10, fill: 'var(--fg-muted)' }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '2px',
                      fontSize: '0.85rem'
                    }}
                    formatter={(value, name) => [value, name === 'questions' ? 'Questions' : 'Papers']}
                  />
                  <Bar dataKey="questions" radius={[2, 2, 0, 0]}>
                    {data.topicFrequency.slice(0, 10).map((t, i) => (
                      <Cell
                        key={i}
                        fill={t.paperCount >= examPapers.length ? 'var(--fg)' : 'var(--border-focus)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.5rem' }}>
                Darker bars = appeared in every exam paper
              </p>
            </div>
          )}

          {/* Favourites tab */}
          {activeTab === 'favourites' && (
            <div>
              <p style={{
                fontSize: '0.75rem', textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '1rem'
              }}>
                Examiner favourites — sub-topics appearing in 2+ papers
              </p>
              {data.topicFrequency.map(t => {
                const favs = t.subtypes.filter(s => s.isFavourite)
                if (!favs.length) return null
                return (
                  <div key={t.topic} style={{ marginBottom: '1.5rem' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{t.topic}</p>
                    {favs.map(s => (
                      <div key={s.sub_type} className="row" style={{
                        padding: '0.4rem 0',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '0.85rem'
                      }}>
                        <span>{s.sub_type}</span>
                        <span className="spacer" />
                        <span className="muted">{s.paperCount}/{examPapers.length} papers · {s.count}q</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/* Structure tab */}
          {activeTab === 'structure' && (
            <div>
              <p style={{
                fontSize: '0.75rem', textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '1rem'
              }}>
                Question position patterns
              </p>
              {data.positionPatterns.map(p => (
                <div key={p.position} style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)'
                }}>
                  <p style={{ fontWeight: 'bold', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                    {p.position}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {p.topics.slice(0, 3).map((t, i) => (
                      <span key={i} style={{
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '2px',
                        background: i === 0 ? 'var(--bg-subtle)' : 'transparent',
                        color: i === 0 ? 'var(--fg)' : 'var(--fg-muted)'
                      }}>
                        {t.topic}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {data.markPatterns.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <p style={{
                    fontSize: '0.75rem', textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '1rem'
                  }}>
                    Mark allocation by topic
                  </p>
                  {data.markPatterns.slice(0, 8).map(m => (
                    <div key={m.topic} className="row" style={{
                      padding: '0.4rem 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '0.85rem'
                    }}>
                      <span>{m.topic}</span>
                      <span className="spacer" />
                      <span className="muted">{m.totalMarks} total · avg {m.avgMarks}/q</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Atlas Analysis tab */}
          {activeTab === 'atlas' && (
            <div>
              {narrativeLoading && (
                <p className="muted">Atlas is analysing the patterns…</p>
              )}
              {narrative && (
                <div
                  style={{ lineHeight: '1.8' }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(narrative) }}
                />
              )}
              {!narrative && !narrativeLoading && (
                <div>
                  <p className="muted" style={{ marginBottom: '1rem' }}>
                    Atlas will read the pattern data and write a focused exam preparation analysis.
                  </p>
                  <button className="primary" onClick={loadNarrative}>
                    Generate Atlas Analysis
                  </button>
                </div>
              )}
              {narrative && (
                <button
                  className="ghost"
                  style={{ marginTop: '1.5rem', fontSize: '0.85rem' }}
                  onClick={() => { setNarrative(''); loadNarrative() }}
                >
                  Regenerate
                </button>
              )}
            </div>
          )}

          {/* Exam simulation CTA */}
          <div style={{
            marginTop: '2.5rem',
            padding: '1.25rem',
            border: `1px solid ${data.confidence >= 70 ? 'var(--border-focus)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            opacity: data.confidence >= 70 ? 1 : 0.5
          }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.35rem' }}>Exam Simulator</p>
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {data.confidence >= 70
                ? 'Generate a full simulated exam paper based on detected examiner patterns.'
                : `Reach 70% confidence to unlock. Currently at ${data.confidence}%. Upload more Past Exam PDFs to increase confidence.`
              }
            </p>
            <button
              className="primary"
              disabled={data.confidence < 70}
              onClick={() => navigate('/simulate')}
            >
              {data.confidence >= 70 ? 'Simulate exam →' : `Locked — ${70 - data.confidence}% more needed`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
