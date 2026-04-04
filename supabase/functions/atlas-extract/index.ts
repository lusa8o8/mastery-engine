import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXTRACT_SYSTEM = `You are a math question extractor for past papers and tutorial sheets.

Extract every math question exactly as written. For each question return a JSON object with these fields:

- raw_text: the full question text exactly as written
- topic: the main math topic (e.g. "Sets", "Functions", "Complex Numbers", "Polynomials", "Quadratic Functions")
- sub_type: the specific sub-type (e.g. "Union and Intersection", "Domain and Range", "Modulus", "Completing the Square")
- difficulty_hint: "basic", "intermediate", or "advanced"
- section: the section letter or name if present on the paper (e.g. "A", "B", "C")  null if not present
- question_number: the question number exactly as printed (e.g. "1", "2", "3a", "4b(ii)")  null if not clear
- marks: the integer mark allocation for this question if printed on the paper (e.g. 3, 5, 10)  null if not shown

IMPORTANT RULES:
- Extract ALL questions including sub-parts (a, b, c) as separate entries
- For sub-parts, question_number should be "1a", "1b", "2a(i)", "2a(ii)" etc.
- marks should be an integer only  if the paper shows "[3]" or "(3 marks)" extract 3
- If marks are not shown anywhere on the paper, use null  never guess
- section should only be set if the paper explicitly labels sections (e.g. "SECTION A")
- For images, do your best  marks and question numbers may be harder to read
- topic and sub_type are always required  never null
- raw_text must be the complete question including any given information

Respond ONLY with a valid JSON array. No preamble. No explanation. No markdown fences.`

const METADATA_SYSTEM = `You are a math exam paper metadata extractor.

Read the paper and extract the exam instructions and metadata. Return a JSON object with exactly these fields:

- instructions: array of strings  the exact instructions printed on the paper (e.g. ["Attempt any 5 questions", "Show all working", "Calculators are NOT allowed"])
- timeMinutes: integer  the time allowed in minutes (e.g. 180 for 3 hours)  null if not stated
- totalQuestions: integer  total number of questions on the paper  null if not clear
- attemptQuestions: integer  number of questions the student must attempt (e.g. 5 if "attempt any 5")  null if all questions must be attempted
- calculatorsAllowed: boolean  true if calculators are permitted, false if not  null if not stated

RULES:
- instructions must be extracted EXACTLY as written on the paper  do not paraphrase
- If the paper says "Calculators are NOT allowed" set calculatorsAllowed to false
- If the paper says "Calculators are permitted" set calculatorsAllowed to true
- timeMinutes should be in minutes  convert hours to minutes (3 hours = 180)
- Return null for any field not clearly stated on the paper

Respond ONLY with a valid JSON object. No preamble. No explanation. No markdown fences.`

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

function parseMetadata(raw: string) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return null
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

    // If fileUrl is a storage path generate a signed URL
    let fetchUrl = fileUrl
    if (!fileUrl.startsWith('http')) {
      const bucket = 'papers'
      const path = fileUrl.replace('papers/', '')
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, 3600)
      if (signError) throw new Error('Failed to generate signed URL: ' + signError.message)
      fetchUrl = signed.signedUrl
    }

    // Fetch file server-side
    const fileResponse = await fetch(fetchUrl)
    if (!fileResponse.ok) throw new Error(`Failed to fetch file: ${fileResponse.status}`)
    const arrayBuffer = await fileResponse.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)
    const mimeType = fileType === 'pdf' ? 'application/pdf' : fileResponse.headers.get('content-type') || 'image/jpeg'

    // Build file content block
    const fileContent = fileType === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }

    const anthropicHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01'
    }

    // Call 1: Extract questions
    const questionsResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: EXTRACT_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            fileContent,
            { type: 'text', text: 'Extract all math questions with their section, question number, and mark allocation where visible. Return only the JSON array.' }
          ]
        }]
      })
    })

    const questionsData = await questionsResponse.json()
    if (!questionsResponse.ok) {
      throw new Error(questionsData.error?.message || 'Anthropic API error on questions')
    }

    const raw = questionsData.content[0].text
    const questions = parseQuestions(raw)
    if (!questions.length) throw new Error('No questions found in document')

    // Call 2: Extract paper metadata
    const metadataResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: METADATA_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            fileContent,
            { type: 'text', text: 'Extract the exam instructions and metadata from this paper. Return only the JSON object.' }
          ]
        }]
      })
    })

    const metadataData = await metadataResponse.json()
    const metadata = metadataData.ok !== false
      ? parseMetadata(metadataData.content?.[0]?.text || '')
      : null

    // Save to DB using service role key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Save questions
    const rows = questions.map((q: any) => ({
      paper_id: paperId,
      user_id: userId,
      raw_text: q.raw_text || q.question || q.text || q.content || '',
      topic: q.topic,
      sub_type: q.sub_type,
      source: 'extracted',
      difficulty_hint: q.difficulty_hint || null,
      section: q.section || null,
      question_number: q.question_number || null,
      marks: typeof q.marks === 'number' ? q.marks : null
    }))

    const { error: dbError } = await supabaseClient.from('questions').insert(rows)
    if (dbError) throw dbError

    // Save metadata to papers table if extracted
    if (metadata) {
      await supabaseClient.from('papers').update({
        instructions: metadata.instructions || null,
        time_minutes: metadata.timeMinutes || null,
        total_questions: metadata.totalQuestions || null,
        attempt_questions: metadata.attemptQuestions || null,
        calculators_allowed: metadata.calculatorsAllowed ?? null
      }).eq('id', paperId)
    }

    return new Response(JSON.stringify({ count: questions.length, metadata: metadata || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
