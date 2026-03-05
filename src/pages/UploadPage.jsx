import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { uploadPaper } from '../utils/uploadPaper'
import { extractAndSave } from '../utils/extractQuestions'

const ACCEPTED = '.pdf,image/jpeg,image/jpg,image/png,image/webp'
const MAX_SIZE_MB = 20

export default function UploadPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])
  const [dragOver, setDragOver] = useState(false)

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

  async function handleUpload() {
    if (!files.length) return
    setUploading(true)
    setResults([])

    const outcomes = []
    for (const file of files) {
      try {
        // Step 1: upload file
        const paper = await uploadPaper(file, user.id)
        // Step 2: extract questions
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

  return (
    <div className="page">
      <h1>Upload</h1>
      <p className="muted" style={{ marginBottom: '2rem' }}>
        Upload past papers or tutorial sheets. PDF and images accepted. Max 20MB per file.
      </p>

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

      {files.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          {files.map(f => {
            const result = results.find(r => r.name === f.name)
            return (
              <div key={f.name} className="row" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: '0.9rem' }}>{f.name}</span>
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
