import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { topic, subType, layer, questions } = await req.json()

    if (!topic || !subType || !layer || !questions) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const questionList = questions.map((q: any) => q.raw_text).join('\n')
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

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
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

    const anthropicData = await anthropicResponse.json()

    if (!anthropicResponse.ok) {
      throw new Error(anthropicData.error?.message || 'Anthropic API error')
    }

    const text = anthropicData.content[0].text

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
