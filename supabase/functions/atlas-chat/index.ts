import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    // Call Anthropic directly — auth checked via Supabase session
    const { systemPrompt, messages, sessionId, context, userId } = await req.json()

    if (!systemPrompt || !messages) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        messages
      })
    })

    const anthropicData = await anthropicResponse.json()

    if (!anthropicResponse.ok) {
      throw new Error(anthropicData.error?.message || 'Anthropic API error')
    }

    const text = anthropicData.content[0].text
    const usage = anthropicData.usage

    // Log tokens if we have session info
    if (usage && sessionId && userId) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      await supabaseClient.from('token_logs').insert({
        user_id: userId,
        session_id: sessionId,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        model: 'claude-haiku-4-5-20251001',
        context: context || 'engine'
      })
    }

    return new Response(JSON.stringify({ text, usage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
