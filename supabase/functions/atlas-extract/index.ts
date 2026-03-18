import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXTRACT_SYSTEM = `You are a math question extractor.
Given a past paper or tutorial sheet, extract every math question exactly as written.
For each question identify:
- topic: the main math topic (e.g. "Sets", "Functions", "Complex Numbers", "Polynomials")
- sub_type: the specific sub-type (e.g. "Union and Intersection", "Domain and Range", "Modulus")
- difficulty_hint: "basic", "intermediate", or "advanced"

Respond ONLY with a valid JSON array. No preamble. No explanation. No markdown fences.`

function parseQuestions(raw: string) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      const lastBrace = clean.lastIndexOf('},')
      if (lastBrace === -1) throw new Error('No complete objects found')
      const recovered = clean.slice(0, lastBrace + 1) + ']'
      const result = JSON.parse(recovered)
      if (!Array.isArray(result) || result.length === 0) throw new Error('Empty array')
      return result
    } catch {
      throw new Error(`Failed to parse questions. Raw: ${raw.slice(0, 300)}`)
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { paperId, fileUrl, fileType, userId } = await req.json()

    if (!paperId || !fileUrl || !fileType || !userId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch file server-side
    const fileResponse = await fetch(fileUrl)
    if (!fileResponse.ok) throw new Error(`Failed to fetch file: ${fileResponse.status}`)
    const arrayBuffer = await fileResponse.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)
    const mimeType = fileType === 'pdf' ? 'application/pdf' : fileResponse.headers.get('content-type') || 'image/jpeg'

    // Build messages for Claude
    let messages
    if (fileType === 'pdf') {
      messages = [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: 'Extract all math questions. Return only the JSON array.' }
        ]
      }]
    } else {
      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          { type: 'text', text: 'Extract all math questions. Return only the JSON array.' }
        ]
      }]
    }

    // Call Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: EXTRACT_SYSTEM,
        messages
      })
    })

    const anthropicData = await anthropicResponse.json()
    if (!anthropicResponse.ok) {
      throw new Error(anthropicData.error?.message || 'Anthropic API error')
    }

    const raw = anthropicData.content[0].text
    const questions = parseQuestions(raw)

    if (!questions.length) throw new Error('No questions found in document')

    // Save to DB using service role key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const rows = questions.map((q: any) => ({
      paper_id: paperId,
      user_id: userId,
      raw_text: q.raw_text || q.question || q.text || q.content || '',
      topic: q.topic,
      sub_type: q.sub_type,
      source: 'extracted',
      difficulty_hint: q.difficulty_hint
    }))

    const { error: dbError } = await supabaseClient.from('questions').insert(rows)
    if (dbError) throw dbError

    return new Response(JSON.stringify({ count: questions.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
