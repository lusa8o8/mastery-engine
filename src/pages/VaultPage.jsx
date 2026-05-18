import { useState, useEffect, useRef } from 'react'
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
  const [paperMenuOpen, setPaperMenuOpen] = useState(false)
  const paperMenuRef = useRef(null)

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

  useEffect(function () {
    if (!paperMenuOpen) return

    function handlePointerDown(event) {
      if (!paperMenuRef.current) return
      if (!paperMenuRef.current.contains(event.target)) {
        setPaperMenuOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setPaperMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return function () {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [paperMenuOpen])

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

  function getDisplayPaperName(paper, index) {
    const name = paper.name || ''
    if (/^\d+\.pdf$/i.test(name)) return 'Untitled PDF ' + (index + 1)
    return name || 'Untitled paper ' + (index + 1)
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
  const activePaper = papers.find(function (paper) {
    return paper.id === selectedPaper
  }) || null
  const activePaperIndex = activePaper
    ? papers.findIndex(function (paper) { return paper.id === activePaper.id })
    : -1

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
          <div className="row" style={{ alignItems: 'flex-end', gap: '1rem', marginBottom: '0.75rem' }}>
            <div ref={paperMenuRef} style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
              <label
                htmlFor="paper-filter"
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-muted)',
                  marginBottom: '0.4rem'
                }}
              >
                Paper
              </label>
              <button
                id="paper-filter"
                type="button"
                className="secondary"
                aria-haspopup="listbox"
                aria-expanded={paperMenuOpen}
                onClick={function () { setPaperMenuOpen(function (open) { return !open }) }}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  textAlign: 'left'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activePaper ? getDisplayPaperName(activePaper, activePaperIndex) : 'All papers'}
                </span>
                <span style={{ color: 'var(--fg-muted)', fontSize: '0.8rem' }}>
                  {paperMenuOpen ? 'Close' : 'Select'}
                </span>
              </button>

              {paperMenuOpen && (
                <div
                  role="listbox"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    marginTop: '0.35rem',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    maxHeight: '260px',
                    overflowY: 'auto'
                  }}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedPaper === null}
                    className={selectedPaper === null ? 'primary' : 'ghost'}
                    onClick={function () {
                      setSelectedPaper(null)
                      setPaperMenuOpen(false)
                    }}
                    style={{
                      width: '100%',
                      display: 'block',
                      textAlign: 'left',
                      padding: '0.65rem 0.75rem',
                      borderRadius: 0,
                      minHeight: 'unset'
                    }}
                  >
                    All papers
                  </button>
                  {papers.map(function (paper, index) {
                    const active = selectedPaper === paper.id
                    return (
                      <button
                        key={paper.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={active ? 'primary' : 'ghost'}
                        onClick={function () {
                          setSelectedPaper(paper.id)
                          setPaperMenuOpen(false)
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          textAlign: 'left',
                          padding: '0.65rem 0.75rem',
                          borderTop: '1px solid var(--border)',
                          borderRadius: 0,
                          minHeight: 'unset'
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getDisplayPaperName(paper, index)}
                        </span>
                        {paper.assessment_type && (
                          <span style={{
                            flexShrink: 0,
                            color: active ? 'var(--bg)' : 'var(--fg-muted)',
                            fontSize: '0.75rem',
                            fontStyle: 'italic',
                            opacity: active ? 0.8 : 1
                          }}>
                            {paper.assessment_type}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="muted" style={{ fontSize: '0.9rem', paddingBottom: '0.45rem', whiteSpace: 'nowrap' }}>
              {vault.length} topic{vault.length !== 1 ? 's' : ''} - {getOverallCoveragePct()}% covered
            </div>
          </div>

          {activePaper && (
            <div className="row" style={{
              padding: '0.55rem 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              marginBottom: '1.5rem'
            }}>
              {editingPaper === activePaper.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={function (e) { setEditName(e.target.value) }}
                  onBlur={function () { savePaperName(activePaper.id) }}
                  onKeyDown={function (e) {
                    if (e.key === 'Enter') savePaperName(activePaper.id)
                    if (e.key === 'Escape') setEditingPaper(null)
                  }}
                  style={{ fontSize: '0.85rem', padding: '0.3rem 0.5rem', maxWidth: '260px' }}
                />
              ) : (
                <p style={{ marginBottom: 0, fontSize: '0.9rem' }}>
                  {getDisplayPaperName(activePaper, activePaperIndex)}
                  {activePaper.assessment_type && (
                    <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem', fontStyle: 'italic' }}>
                      {activePaper.assessment_type}
                    </span>
                  )}
                </p>
              )}
              <span className="spacer" />
              <button
                className="ghost"
                style={{ fontSize: '0.8rem' }}
                onClick={function () {
                  setEditingPaper(activePaper.id)
                  setEditName(activePaper.name || '')
                }}
              >
                Rename
              </button>
            </div>
          )}

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
