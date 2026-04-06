import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RENDER_VIZ_TOOL = {
  name: 'render_visualization',
  description: 'Render a mathematical visualization for the student. Use this whenever a diagram, graph, number line, or chart would help explain a concept or show a solution.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['function_plot', 'histogram', 'number_line', 'set_diagram'],
        description: 'The type of visualization to render'
      },
      sets: { type: 'array', items: { type: 'string' }, description: 'Set labels for Venn diagrams e.g. ["A","B"] or ["A","B","C"]' },
      universal: { type: 'string', description: 'Universal set label e.g. "U"' },
      shaded: { type: 'array', items: { type: 'string' }, description: 'Regions to shade. 2-set: A_only, B_only, A_intersect_B, outside. 3-set adds C_only, A_intersect_C, B_intersect_C, A_intersect_B_intersect_C' },
      functions: {
        type: 'array',
        description: 'Functions to plot',
        items: {
          type: 'object',
          properties: {
            expr: { type: 'string', description: 'JavaScript math expression using ** for powers e.g. x**2' },
            label: { type: 'string', description: 'Display label e.g. f(x) = x²' },
            color: { type: 'string', description: 'Hex color e.g. #8b7355' }
          }
        }
      },
      xRange: { type: 'array', items: { type: 'number' }, description: 'X axis range e.g. [-5, 5]' },
      yRange: { type: 'array', items: { type: 'number' }, description: 'Y axis range e.g. [-2, 25]' },
      data: {
        type: 'array',
        description: 'Bar chart data',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'number' }
          }
        }
      },
      title: { type: 'string', description: 'Chart title' },
      xLabel: { type: 'string', description: 'X axis label' },
      yLabel: { type: 'string', description: 'Y axis label' },
      min: { type: 'number', description: 'Number line minimum value' },
      max: { type: 'number', description: 'Number line maximum value' },
      label: { type: 'string', description: 'Number line label' },
      intervals: {
        type: 'array',
        description: 'Intervals to highlight on number line',
        items: {
          type: 'object',
          properties: {
            from: { type: 'number' },
            to: { type: 'number' },
            openLeft: { type: 'boolean', description: 'true = hollow circle at from (excluded)' },
            openRight: { type: 'boolean', description: 'true = hollow circle at to (excluded)' }
          }
        }
      },
      points: {
        type: 'array',
        description: 'Individual points on number line',
        items: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            label: { type: 'string' },
            open: { type: 'boolean', description: 'true = hollow circle (excluded)' }
          }
        }
      }
    },
    required: ['type']
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const { systemPrompt, messages, sessionId, context, userId, maxTokens } = await req.json()
    const body = { systemPrompt, messages, sessionId, context, userId, maxTokens }

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
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: body.context === 'exam_simulation'
          ? 'claude-sonnet-4-6'
          : 'claude-haiku-4-5-20251001',
        max_tokens: body.maxTokens || 2048,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages,
        ...(body.context !== 'exam_simulation' ? {
          tools: [RENDER_VIZ_TOOL],
          tool_choice: { type: 'auto' }
        } : {})
      })
    })

    const anthropicData = await anthropicResponse.json()

    if (!anthropicResponse.ok) {
      throw new Error(anthropicData.error?.message || 'Anthropic API error')
    }

    // Extract text and tool use from content blocks
    let text = ''
    let viz = null

    for (const block of anthropicData.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use' && block.name === 'render_visualization') {
        viz = block.input
      }
    }

    const usage = anthropicData.usage

    // Log tokens server-side
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
        model: body.context === 'exam_simulation' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
        context: context || 'engine'
      })
    }

    return new Response(JSON.stringify({ text, viz, usage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
