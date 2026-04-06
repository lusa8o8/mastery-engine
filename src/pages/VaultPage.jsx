import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getVault } from '../utils/getVault'
import { getCoverage } from '../utils/getCoverage'
import { getPapers } from '../utils/getPapers'
import { supabase } from '../api/supabase'

export default function VaultPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [papers, setPapers] = useState([])
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [vault, setVault] = useState([])
  const [coverage, setCoverage] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingPaper, setEditingPaper] = useState(null)
  const [editName, setEditName] = useState('')

  useEffect(function () {
    if (!user) return
    loadPapers()
  }, [user])

  useEffect(function () {
    if (!user) return
    loadVaultData(selectedPaper)
  }, [user, selectedPaper])

  async function loadPapers() {
    try {
      const data = await getPapers(user.id)
      setPapers(data)
    } catch (e) {
      console.error('Failed to load papers:', e)
    }
  }

  async function loadVaultData(paperId) {
    setLoading(true)
    setError('')
    try {
      const [vaultData, coverageData] = await Promise.all([
        getVault(user.id, paperId),
        getCoverage(user.id, paperId)
      ])
      setVault(vaultData)
      setCoverage(coverageData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function savePaperName(paperId) {
    if (!editName.trim()) { setEditingPaper(null); return }
    try {
      await supabase.from('papers').update({ name: editName.trim() }).eq('id', paperId)
      setPapers(prev => prev.map(p => p.id === paperId ? { ...p, name: editName.trim() } : p))
    } catch (e) {
      console.error('Failed to rename paper:', e)
    }
    setEditingPaper(null)
  }

  function getCoverageForTopic(topic) {
    return coverage.find(function (c) { return c.topic === topic }) || null
  }

  function getCoverageForSubType(topic, subType) {
    const topicCov = getCoverageForTopic(topic)
    if (!topicCov) return null
    return topicCov.subtypes.find(function (s) { return s.sub_type === subType }) || null
  }

  function toggleExpanded(topic) {
    setExpanded(function (prev) {
      return { ...prev, [topic]: !prev[topic] }
    })
  }

  async function startSession(topic, subType) {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: user.id,
          topic,
          sub_type: subType,
          current_layer: 'foundation'
        })
        .select()
        .single()
      if (error) throw error
      const encoded = encodeURIComponent(`${topic}__${subType}__${data.id}`)
      navigate(`/engine/${encoded}`)
    } catch (e) {
      setError(e.message)
    }
  }

  // Compute per-paper coverage summary
  function getPaperCoverage(paperId) {
    // This is computed from the full vault/coverage when that paper is selected
    // For the paper selector we show it from the current selected state
    if (selectedPaper !== paperId) return null
    const total = coverage.reduce(function (sum, t) { return sum + t.total }, 0)
    const covered = coverage.reduce(function (sum, t) { return sum + t.covered }, 0)
    if (total === 0) return null
    return { total, covered, pct: Math.round((covered / total) * 100) }
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <h1>Papers</h1>
        <span className="spacer" />
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/home')}>← Home</button>
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>Patterns</button>
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/progress')}>Progress</button>
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/upload')}>Upload</button>
      </div>

      {/* Paper selector */}
      {papers.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
            Filter by paper
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={selectedPaper === null ? 'primary' : 'secondary'}
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
              onClick={function () { setSelectedPaper(null) }}
            >
              All papers
            </button>
            {papers.map(function (paper) {
              const cov = getPaperCoverage(paper.id)
              return (
                <div key={paper.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {editingPaper === paper.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => savePaperName(paper.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') savePaperName(paper.id)
                    if (e.key === 'Escape') setEditingPaper(null)
                  }}
                  style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', width: '160px' }}
                />
              ) : (
                <button
                  className={selectedPaper === paper.id ? 'primary' : 'secondary'}
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                  onClick={function () { setSelectedPaper(paper.id) }}
                >
                  {paper.name}
                  {paper.assessment_type && (
                    <span style={{
                      marginLeft: '0.4rem',
                      fontSize: '0.7rem',
                      opacity: 0.6,
                      fontStyle: 'italic'
                    }}>
                      {paper.assessment_type}
                    </span>
                  )}
                  {cov ? (
                    <span style={{ marginLeft: '0.5rem', opacity: 0.75 }}>
                      {cov.covered}/{cov.total} ({cov.pct}%)
                    </span>
                  ) : (
                    <span style={{ marginLeft: '0.5rem', opacity: 0.5 }}>
                      {paper.question_count}q
                    </span>
                  )}
                </button>
              )}
              <button
                className="ghost"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', minHeight: 'unset', opacity: 0.6 }}
                title="Rename"
                onClick={function (e) {
                  e.stopPropagation()
                  setEditingPaper(paper.id)
                  setEditName(paper.name)
                }}
              >
                ✎
              </button>
            </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : vault.length === 0 ? (
        <p className="muted">No questions found. <button className="ghost" onClick={() => navigate('/upload')}>Upload a paper</button></p>
      ) : (
        <div>
          {vault.map(function (topicData) {
            const topicCov = getCoverageForTopic(topicData.topic)
            const isExpanded = expanded[topicData.topic]
            const totalQuestions = topicData.subtypes.reduce(function (s, st) { return s + st.count }, 0)

            return (
              <div key={topicData.topic} style={{ borderBottom: '1px solid var(--border)' }}>
                <div
                  className="row"
                  style={{ padding: '1rem 0', cursor: 'pointer' }}
                  onClick={function () { toggleExpanded(topicData.topic) }}
                >
                  <div>
                    <p style={{ marginBottom: '0.1rem' }}>{topicData.topic}</p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      {topicCov
                        ? `${topicCov.covered}/${topicCov.total} covered (${topicCov.pct}%)`
                        : `0/${totalQuestions} covered (0%)`
                      }
                    </p>
                  </div>
                  <span className="spacer" />
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    {topicData.subtypes.length} sub-topic{topicData.subtypes.length !== 1 ? 's' : ''} {isExpanded ? '↑' : '↓'}
                  </p>
                </div>

                {isExpanded && (
                  <div style={{ paddingBottom: '1rem' }}>
                    {topicData.subtypes.map(function (st) {
                      const stCov = getCoverageForSubType(topicData.topic, st.sub_type)
                      const covered = stCov ? stCov.covered : 0
                      const pct = stCov ? stCov.pct : 0

                      return (
                        <div key={st.sub_type} className="row" style={{
                          padding: '0.6rem 0 0.6rem 1rem',
                          borderTop: '1px solid var(--border)'
                        }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>{st.sub_type}</p>
                            <p className="muted" style={{ fontSize: '0.75rem' }}>
                              {covered}/{st.count} covered ({pct}%)
                            </p>
                          </div>
                          <button
                            className={covered > 0 ? 'secondary' : 'primary'}
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                            onClick={function (e) {
                              e.stopPropagation()
                              startSession(topicData.topic, st.sub_type)
                            }}
                          >
                            {covered > 0 ? 'Revisit' : 'Begin'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
