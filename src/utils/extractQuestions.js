import { supabase } from '../api/supabase'

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const EXTRACT_SYSTEM = `You are a math question extractor. 
Given a past paper or tutorial sheet, extract every math question exactly as written.
For each question identify:
- topic: the main math topic (e.g. "Sets", "Functions", "Complex Numbers", "Polynomials")
- sub_type: the specific sub-type (e.g. "Union and Intersection", "Domain and Range", "Modulus")
- difficulty_hint: "basic", "intermediate", or "advanced"

Respond ONLY with a valid JSON array. No preamble. No explanation. No markdown fences.`

async function fetchFileAsBase64(fileUrl) {
  const response = await fetch(fileUrl)
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1]
      resolve({ base64, mimeType: blob.type })
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function callClaude(messages) {
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
      max_tokens: 8192,
      system: EXTRACT_SYSTEM,
      messages
    })
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || `API error ${response.status}`)
  }

  if (!data.content || !data.content[0]) {
    throw new Error(`Unexpected API response: ${JSON.stringify(data)}`)
  }

  return data.content[0].text
}

function parseQuestions(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    // Try to recover truncated JSON by finding last complete object
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      const lastBrace = clean.lastIndexOf('},')
      if (lastBrace === -1) throw new Error('No complete objects found')
      const recovered = clean.slice(0, lastBrace + 1) + ']'
      const result = JSON.parse(recovered)
      if (!Array.isArray(result) || result.length === 0) throw new Error('Empty array')
      return result
    } catch {
      throw new Error(`Failed to parse questions. Raw response: ${raw.slice(0, 300)}`)
    }
  }
}

export async function extractAndSave(paper) {
  const { base64, mimeType } = await fetchFileAsBase64(paper.file_url)

  let messages
  if (paper.file_type === 'pdf') {
    messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: 'Extract all math questions. Return only the JSON array.' }
        ]
      }
    ]
  } else {
    messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          { type: 'text', text: 'Extract all math questions. Return only the JSON array.' }
        ]
      }
    ]
  }

  const raw = await callClaude(messages)
  const questions = parseQuestions(raw)

  if (!questions.length) throw new Error('No questions found in document')

  const rows = questions.map(q => ({
    paper_id: paper.id,
    user_id: paper.user_id,
    raw_text: q.raw_text || q.question || q.text || q.content || '',
    topic: q.topic,
    sub_type: q.sub_type,
    source: 'extracted',
    difficulty_hint: q.difficulty_hint
  }))

  const { error } = await supabase.from('questions').insert(rows)
  if (error) throw error

  return questions.length
}
