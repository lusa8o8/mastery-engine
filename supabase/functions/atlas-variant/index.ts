import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  createAdminClient,
  errorResponse,
  HttpError,
  requireUser
} from '../_shared/http.ts'
import {
  claimModelAllowance,
  estimateTextTokens,
  settleModelAllowance
} from '../_shared/modelAllowance.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    const user = await requireUser(req, admin)
    const { topic, subType, layer, questions } = await req.json()

    if (!topic || !subType || !layer || !Array.isArray(questions) || questions.length === 0) {
      throw new HttpError(400, 'INVALID_REQUEST', 'topic, subType, layer and questions are required.')
    }

    const questionList = questions
      .slice(0, 50)
      .map((q: any) => String(q.raw_text ?? '').slice(0, 4000))
      .join('\n')
    const variantPrompt = `You are a math exam question generator for "${subType}" in "${topic}".
Study these real exam questions carefully:
${questionList}

Generate ONE new exam-style question that:
- Matches the difficulty and style of the questions above
- Tests the same concept but with different numbers or framing
- For layer "${layer}": ${
  layer === 'traps'
    ? 'includes an examiner trick or trap'
    : layer === 'pressure'
    ? 'combines multiple concepts under time pressure'
    : 'is a clean direct application'
}

Return ONLY the question text. No explanation. No preamble.`

    const reservedInputTokens = estimateTextTokens(variantPrompt)
    if (reservedInputTokens > 50000) {
      throw new HttpError(413, 'MODEL_INPUT_TOO_LARGE', 'These source questions are too large to process safely.')
    }
    const allowanceId = await claimModelAllowance(
      admin,
      user.id,
      'question_variant',
      reservedInputTokens,
      512
    )

    let anthropicResponse: Response
    let anthropicData: any
    try {
      anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: variantPrompt,
          messages: [{ role: 'user', content: 'Generate the question.' }]
        })
      })

      anthropicData = await anthropicResponse.json()
      const usage = anthropicData.usage
      await settleModelAllowance(
        admin,
        allowanceId,
        user.id,
        usage ? 'completed' : 'failed',
        Number(usage?.input_tokens || 0),
        Number(usage?.output_tokens || 0)
      )
    } catch (error) {
      await settleModelAllowance(admin, allowanceId, user.id, 'failed').catch(console.error)
      throw error
    }

    if (!anthropicResponse.ok) {
      throw new Error(anthropicData.error?.message || 'Anthropic API error')
    }

    const text = anthropicData.content[0].text

    const usage = anthropicData.usage
    if (usage) {
      const inputTokens = Number(usage.input_tokens || 0)
      const outputTokens = Number(usage.output_tokens || 0)
      const { error: logError } = await admin.from('token_logs').insert({
        user_id: user.id,
        session_id: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: 'claude-haiku-4-5-20251001',
        context: 'question_variant',
        estimated_cost_usd: Number((inputTokens / 1_000_000 * 0.80 + outputTokens / 1_000_000 * 4.00).toFixed(8)),
        input_cost_per_m: 0.80,
        output_cost_per_m: 4.00,
        cost_currency: 'USD',
        model_call_allowance_id: allowanceId
      })
      if (logError) console.error('Token log failed', logError)
    }

    return new Response(JSON.stringify({ text, usage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return errorResponse(e, corsHeaders)
  }
})
