import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { uploadPaper } from '../utils/uploadPaper'
import { extractAndSave } from '../utils/extractQuestions'
import { supabase } from '../api/supabase'

const ACCEPTED = '.pdf,image/jpeg,image/jpg,image/png,image/webp'
const MAX_SIZE_MB = 20

const ASSESSMENT_TYPES = [
  'Past Exam',
  'Mock Exam',
  'Class Test',
  'Quiz',
  'Tutorial Sheet',
  'Assignment'
]

export default function UploadPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [paperName, setPaperName] = useState('')
  const [assessmentType, setAssessmentType] = useState('')

  function handleFiles(incoming) {
    const valid = Array.from(incoming).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase()
      const okType = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)
      const okSize = f.size <= MAX_SIZE_MB * 1024 * 1024
      return okType && okSize
    })
    setFiles(prev => {
      const names = prev.map(f => f.name)
      const deduped = valid.filter(f => !names.includes(f.name))
      return [...prev, ...deduped]
    })
  }

  function removeFile(name) {
    setFiles(prev => prev.filter(f => f.name !== name))
  }

  async function checkDuplicates(filesToCheck) {
    try {
      const { data: existingPapers } = await supabase
        .from('papers')
        .select('name, file_url')
        .eq('user_id', user.id)
      if (!existingPapers || existingPapers.length === 0) return []
      const duplicates = []
      for (const file of filesToCheck) {
        const isDuplicate = existingPapers.some(p => {
          const storageName = p.file_url
            .split('?')[0]
            .split('/')
            .pop()
            .toLowerCase()
          const uploadName = file.name.toLowerCase()
          return storageName === uploadName || p.name === paperName.trim()
        })
        if (isDuplicate) duplicates.push(file.name)
      }
      return duplicates
    } catch {
      return []
    }
  }

  function getNameForFile(file, index) {
    if (!paperName.trim()) return null
    if (files.length === 1) return paperName.trim()
    return `${paperName.trim()} ${index + 1}`
  }

  async function handleUpload() {
    if (!files.length) return
    if (!paperName.trim()) {
      document.getElementById('paper-name-input').focus()
      return
    }
    if (!assessmentType) {
      document.getElementById('assessment-type-select').focus()
      return
    }
    setUploading(true)
    setResults([])

    const duplicates = await checkDuplicates(files)
    if (duplicates.length > 0) {
      setUploading(false)
      setResults(files.map(f => ({
        name: f.name,
        status: duplicates.includes(f.name) ? 'duplicate' : 'pending'
      })))
      return
    }

    const outcomes = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const name = getNameForFile(file, i)
      try {
        const paper = await uploadPaper(file, user.id, name, assessmentType)
        const count = await extractAndSave(paper)
        outcomes.push({ name: file.name, status: 'done', count })
      } catch (err) {
        outcomes.push({ name: file.name, status: 'error', error: err.message })
      }
    }

    setResults(outcomes)
    setUploading(false)

    const allDone = outcomes.every(o => o.status === 'done')
    if (allDone) setTimeout(() => navigate('/vault'), 1500)
  }

  const isBatch = files.length > 1

  return (
    <div className="page">
      <h1>Upload</h1>
      <p className="muted" style={{ marginBottom: '2rem' }}>
        Upload past papers or tutorial sheets. PDF and images accepted. Max 20MB per file.
      </p>

      {/* Name input */}
      <div className="field" style={{ marginBottom: '1.5rem' }}>
        <label className="label" htmlFor="paper-name-input">
          {isBatch ? 'Batch name' : 'Paper name'} <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <input
          id="paper-name-input"
          type="text"
          value={paperName}
          onChange={e => setPaperName(e.target.value)}
          placeholder={isBatch ? 'e.g. 2024 Past Papers (will become "2024 Past Papers 1", "2024 Past Papers 2"…)' : 'e.g. T_Sheet_1 or 2024 Mock Paper'}
          disabled={uploading}
          style={{ width: '100%' }}
        />
        {isBatch && paperName.trim() && (
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
            Files will be named: {files.slice(0, 3).map((_, i) => `"${paperName.trim()} ${i + 1}"`).join(', ')}{files.length > 3 ? '…' : ''}
          </p>
        )}
      </div>

      <div className="field" style={{ marginBottom: '1.5rem' }}>
        <label className="label">
          Assessment type <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
          {ASSESSMENT_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={assessmentType === t ? 'primary' : 'secondary'}
              style={{ fontSize: '0.85rem', padding: '0.3rem 0.75rem' }}
              disabled={uploading}
              onClick={() => setAssessmentType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {!assessmentType && (
          <p id="assessment-type-select" style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            Select an assessment type above
          </p>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        style={{
          border: `1px ${dragOver ? 'solid' : 'dashed'} var(--${dragOver ? 'fg' : 'border'})`,
          borderRadius: 'var(--radius)',
          padding: '2rem',
          textAlign: 'center',
          marginBottom: '1.5rem',
          cursor: 'pointer',
          transition: 'border-color 0.15s'
        }}
        onClick={() => document.getElementById('file-input').click()}
      >
        <p className="muted">Drag files here or click to browse</p>
        <input
          id="file-input"
          type="file"
          accept={ACCEPTED}
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          {files.map((f, i) => {
            const result = results.find(r => r.name === f.name)
            const assignedName = getNameForFile(f, i)
            return (
              <div key={f.name} className="row" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '0.9rem' }}>
                    {assignedName || f.name}
                  </span>
                  {assignedName && assignedName !== f.name && (
                    <span className="muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                      ({f.name})
                    </span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: '0.8rem', marginRight: '1rem' }}>
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
                {uploading && !result && (
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Processing…</span>
                )}
                {result?.status === 'done' && (
                  <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>
                    {result.count} questions extracted
                  </span>
                )}
                {result?.status === 'error' && (
                  <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>Failed</span>
                )}
                {result?.status === 'duplicate' && (
                  <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>
                    Already uploaded — remove to skip
                  </span>
                )}
                {!result && !uploading && (
                  <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => removeFile(f.name)}>
                    Remove
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {results.some(r => r.status === 'error') && (
        <div style={{ marginBottom: '1rem' }}>
          {results.filter(r => r.status === 'error').map(r => (
            <p key={r.name} className="error-text">{r.name}: {r.error}</p>
          ))}
        </div>
      )}

      <div className="row">
        <button
          className="primary"
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
        >
          {uploading ? 'Extracting questions…' : `Upload ${files.length > 0 ? `(${files.length})` : ''}`}
        </button>
        <button className="ghost" onClick={() => navigate('/vault')} disabled={uploading}>
          Skip for now
        </button>
      </div>
    </div>
  )
}
