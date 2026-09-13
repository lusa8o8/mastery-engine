import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  createAdminClient,
  errorResponse,
  HttpError,
  requireUser
} from '../_shared/http.ts'

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

  let admin: ReturnType<typeof createAdminClient> | null = null
  let claimedPaperId: string | null = null

  try {
    admin = createAdminClient()
    const user = await requireUser(req, admin)
    const { paperId } = await req.json()

    if (!paperId) {
      throw new HttpError(400, 'INVALID_REQUEST', 'paperId is required.')
    }

    // Resolve the resource through the verified principal. Never accept a
    // caller-supplied file URL, media type or user ID for service-role writes.
    const { data: paper, error: paperError } = await admin
      .from('papers')
      .select('id, user_id, file_url, file_type, extraction_status')
      .eq('id', paperId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (paperError) throw paperError
    if (!paper) {
      throw new HttpError(404, 'PAPER_NOT_FOUND', 'The paper was not found for this student.')
    }

    if (paper.extraction_status === 'completed') {
      const { count, error: countError } = await admin
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('paper_id', paper.id)
        .eq('user_id', user.id)
      if (countError) throw countError
      return new Response(JSON.stringify({ count: count || 0, metadata: null, reused: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: claimStatus, error: claimError } = await admin.rpc('claim_paper_extraction', {
      p_paper_id: paper.id,
      p_user_id: user.id
    })
    if (claimError) throw claimError
    if (claimStatus !== 'claimed') {
      throw new HttpError(409, 'EXTRACTION_IN_PROGRESS', 'Extraction is already running for this paper.')
    }
    claimedPaperId = paper.id

    const fileUrl = paper.file_url
    const fileType = paper.file_type

    // If fileUrl is a storage path generate a signed URL
    let fetchUrl = fileUrl
    if (!fileUrl.startsWith('http')) {
      const bucket = 'papers'
      const path = fileUrl.replace('papers/', '')
      if (path.split('/')[0] !== user.id) {
        throw new HttpError(403, 'PAPER_PATH_FORBIDDEN', 'The paper file is outside the student storage folder.')
      }
      const { data: signed, error: signError } = await admin.storage
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

    // Save questions
    const rows = questions.map((q: any) => ({
      raw_text: q.raw_text || q.question || q.text || q.content || '',
      topic: q.topic,
      sub_type: q.sub_type,
      difficulty_hint: q.difficulty_hint || null,
      section: q.section || null,
      question_number: q.question_number || null,
      marks: typeof q.marks === 'number' ? q.marks : null
    }))

    const normalizedMetadata = metadata ? {
      instructions: Array.isArray(metadata.instructions) ? metadata.instructions : [],
      time_minutes: metadata.timeMinutes ?? null,
      total_questions: metadata.totalQuestions ?? null,
      attempt_questions: metadata.attemptQuestions ?? null,
      calculators_allowed: metadata.calculatorsAllowed ?? null
    } : null

    const { data: savedCount, error: dbError } = await admin.rpc('complete_paper_extraction', {
      p_paper_id: paper.id,
      p_user_id: user.id,
      p_questions: rows,
      p_metadata: normalizedMetadata
    })
    if (dbError) throw dbError
    claimedPaperId = null

    const inputTokens = Number(questionsData.usage?.input_tokens || 0) + Number(metadataData.usage?.input_tokens || 0)
    const outputTokens = Number(questionsData.usage?.output_tokens || 0) + Number(metadataData.usage?.output_tokens || 0)
    if (inputTokens + outputTokens > 0) {
      const { error: logError } = await admin.from('token_logs').insert({
        user_id: user.id,
        session_id: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: 'claude-haiku-4-5-20251001',
        context: 'paper_extraction',
        estimated_cost_usd: Number((inputTokens / 1_000_000 * 0.80 + outputTokens / 1_000_000 * 4.00).toFixed(8)),
        input_cost_per_m: 0.80,
        output_cost_per_m: 4.00,
        cost_currency: 'USD'
      })
      if (logError) console.error('Token log failed', logError)
    }

    return new Response(JSON.stringify({ count: savedCount, metadata: metadata || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    if (admin && claimedPaperId) {
      const message = e instanceof Error ? e.message.slice(0, 1000) : 'Unknown extraction error'
      const { error: failureError } = await admin
        .from('papers')
        .update({ extraction_status: 'failed', extraction_error: message })
        .eq('id', claimedPaperId)
      if (failureError) console.error('Failed to record extraction failure', failureError)
    }
    return errorResponse(e, corsHeaders)
  }
})
