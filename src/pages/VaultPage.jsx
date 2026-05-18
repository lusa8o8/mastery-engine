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
  const [selectedTopic, setSelectedTopic] = useState(null)
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

  useEffect(function () {
    if (vault.length === 0) {
      setSelectedTopic(null)
      return
    }
    const stillExists = vault.some(function (topicData) {
      return topicData.topic === selectedTopic
    })
    if (!selectedTopic || !stillExists) {
      setSelectedTopic(vault[0].topic)
    }
  }, [vault, selectedTopic])

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
    if (!editName.trim()) {
      setEditingPaper(null)
      return
    }
    try {
      await supabase.from('papers').update({ name: editName.trim() }).eq('id', paperId)
      setPapers(function (prev) {
        return prev.map(function (paper) {
          return paper.id === paperId ? { ...paper, name: editName.trim() } : paper
        })
      })
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

  function getOverallCoveragePct() {
    const total = coverage.reduce(function (sum, topic) { return sum + topic.total }, 0)
    const covered = coverage.reduce(function (sum, topic) { return sum + topic.covered }, 0)
    if (total === 0) return 0
    return Math.round((covered / total) * 100)
  }

  function getTopicPct(topicData) {
    const topicCov = getCoverageForTopic(topicData.topic)
    return topicCov ? topicCov.pct : 0
  }

  function getProgressWidth(pct) {
    return Math.max(0, Math.min(100, pct)) + '%'
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

  const selectedTopicData = vault.find(function (topicData) {
    return topicData.topic === selectedTopic
  })

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <h1>Papers</h1>
        <span className="spacer" />
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/home')}>Home</button>
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>Patterns</button>
        <button className="secondary" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/progress')}>Progress</button>
        <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/upload')}>Upload</button>
      </div>

      {papers.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--fg-muted)',
            marginBottom: '0.75rem'
          }}>
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
              return (
                <div key={paper.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {editingPaper === paper.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={function (e) { setEditName(e.target.value) }}
                      onBlur={function () { savePaperName(paper.id) }}
                      onKeyDown={function (e) {
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
                          opacity: 0.65,
                          fontStyle: 'italic'
                        }}>
                          {paper.assessment_type}
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
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : vault.length === 0 ? (
        <p className="muted">
          No questions found. <button className="ghost" onClick={() => navigate('/upload')}>Upload a paper</button>
        </p>
      ) : (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              {vault.length} topic{vault.length !== 1 ? 's' : ''} - {getOverallCoveragePct()}% covered
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '0.75rem'
            }}>
              {vault.map(function (topicData) {
                const pct = getTopicPct(topicData)
                const active = selectedTopic === topicData.topic

                return (
                  <button
                    key={topicData.topic}
                    type="button"
                    className={active ? 'primary' : 'secondary'}
                    onClick={function () { setSelectedTopic(topicData.topic) }}
                    style={{
                      minHeight: 'unset',
                      padding: '0.85rem',
                      textAlign: 'left',
                      display: 'block',
                      lineHeight: 1.35,
                      borderColor: active ? 'var(--fg)' : 'var(--border)'
                    }}
                  >
                    <span style={{
                      display: 'block',
                      color: active ? 'var(--bg)' : 'var(--fg)',
                      fontSize: '0.95rem',
                      marginBottom: '0.4rem'
                    }}>
                      {topicData.topic}
                    </span>
                    <span style={{
                      display: 'block',
                      color: active ? 'var(--bg)' : 'var(--fg-muted)',
                      fontSize: '0.78rem',
                      opacity: active ? 0.85 : 1,
                      marginBottom: '0.55rem'
                    }}>
                      {pct}% covered
                    </span>
                    <span style={{
                      display: 'block',
                      height: '4px',
                      background: active ? 'rgba(255,255,255,0.25)' : 'var(--bg-subtle)',
                      border: active ? '1px solid rgba(255,255,255,0.25)' : '1px solid var(--border)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      marginBottom: '0.5rem'
                    }}>
                      <span style={{
                        display: 'block',
                        height: '100%',
                        width: getProgressWidth(pct),
                        background: active ? 'var(--bg)' : 'var(--fg)'
                      }} />
                    </span>
                    <span style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      color: active ? 'var(--bg)' : 'var(--fg-muted)',
                      fontSize: '0.76rem',
                      opacity: active ? 0.85 : 1
                    }}>
                      <span>{topicData.subtypes.length} sub-topic{topicData.subtypes.length !== 1 ? 's' : ''}</span>
                      <span>Open</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {selectedTopicData && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
              <div className="row" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <p style={{ marginBottom: '0.1rem', fontWeight: 'bold' }}>{selectedTopicData.topic}</p>
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    {getTopicPct(selectedTopicData)}% covered - {selectedTopicData.subtypes.length} sub-topic{selectedTopicData.subtypes.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div>
                {selectedTopicData.subtypes.map(function (st) {
                  const stCov = getCoverageForSubType(selectedTopicData.topic, st.sub_type)
                  const covered = stCov ? stCov.covered : 0
                  const pct = stCov ? stCov.pct : 0

                  return (
                    <div
                      key={st.sub_type}
                      className="row"
                      style={{
                        padding: '0.65rem 0',
                        borderBottom: '1px solid var(--border)',
                        gap: '1rem'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <p style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>{st.sub_type}</p>
                        <div style={{
                          height: '3px',
                          width: '100%',
                          maxWidth: '220px',
                          background: 'var(--bg-subtle)',
                          borderRadius: '2px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            width: getProgressWidth(pct),
                            background: pct === 100 ? 'var(--success)' : 'var(--fg)'
                          }} />
                        </div>
                      </div>
                      <span className="muted" style={{
                        fontSize: '0.82rem',
                        minWidth: '82px',
                        textAlign: 'right'
                      }}>
                        {pct}% covered
                      </span>
                      <button
                        className={covered > 0 ? 'secondary' : 'primary'}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                        onClick={function () { startSession(selectedTopicData.topic, st.sub_type) }}
                      >
                        {covered > 0 ? 'Revisit' : 'Begin'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
