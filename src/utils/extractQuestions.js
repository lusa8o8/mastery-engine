import { supabase } from '../api/supabase'
import { llmCall } from '../api/llm'

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const EXTRACT_SYSTEM = `You are a math question extractor. 
Given a past paper or tutorial sheet, extract every math question exactly as written.
For each question, identify:
- topic: the main math topic (e.g. "Sets", "Functions", "Complex Numbers", "Polynomials")
- sub_type: the specific sub-type (e.g. "Union and Intersection", "Domain and Range", "Modulus")
- difficulty_hint: "basic", "intermediate", or "advanced"

Respond ONLY with a valid JSON array. No preamble. No explanation. No markdown.
Example format:
[
  {
    "raw_text": "If A = {1,2,3} and B = {2,3,4}, find A union B.",
    "topic": "Sets",
    "sub_type": "Union and Intersection",
    "difficulty_hint": "basic"
  }
]`

async function fetchFileAsBase64(fileUrl) {
  const response = await fetch(fileUrl)
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

async function extractFromImage(base64, mimeType) {
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
      max_tokens: 4096,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            },
            {
              type: 'text',
              text: 'Extract all math questions from this document. Return only the JSON array.'
            }
          ]
        }
      ]
    })
  })
  const data = await response.json()
  return data.content[0].text
}

async function extractFromPDF(base64) {
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
      max_tokens: 4096,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 }
            },
            {
              type: 'text',
              text: 'Extract all math questions from this document. Return only the JSON array.'
            }
          ]
        }
      ]
    })
  })
  const data = await response.json()
  return data.content[0].text
}

function parseQuestions(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return []
  }
}

export async function extractAndSave(paper) {
  // Fetch file as base64
  const { base64, mimeType } = await fetchFileAsBase64(paper.file_url)

  // Extract based on file type
  let raw
  if (paper.file_type === 'pdf') {
    raw = await extractFromPDF(base64)
  } else {
    raw = await extractFromImage(base64, mimeType)
  }

  const questions = parseQuestions(raw)
  if (!questions.length) throw new Error('No questions extracted')

  // Save to database
  const rows = questions.map(q => ({
    paper_id: paper.id,
    user_id: paper.user_id,
    raw_text: q.raw_text,
    topic: q.topic,
    sub_type: q.sub_type,
    source: 'extracted',
    difficulty_hint: q.difficulty_hint
  }))

  const { error } = await supabase.from('questions').insert(rows)
  if (error) throw error

  return questions.length
}
