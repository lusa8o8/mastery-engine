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

const SONNET_CONTEXTS = ['exam_simulation', 'exam_marking']

const OUTPUT_TOKENS_BY_CONTEXT: Record<string, number> = {
  foundation_start: 2048,
  engine_turn: 2048,
  layer_transition: 2048,
  session_summary: 300,
  pattern_analysis: 2048,
  exam_simulation: 8192,
  exam_marking: 8192
}

const MODEL_PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 }
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const pricing = MODEL_PRICING_USD_PER_M[model] ?? MODEL_PRICING_USD_PER_M['claude-haiku-4-5-20251001']
  const inputCost = inputTokens / 1_000_000 * pricing.input
  const outputCost = outputTokens / 1_000_000 * pricing.output
  return {
    cost: Number((inputCost + outputCost).toFixed(8)),
    inputCostPerM: pricing.input,
    outputCostPerM: pricing.output
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    const user = await requireUser(req, admin)
    const { systemPrompt, messages, sessionId, simulationId, context } = await req.json()

    const supportedContext = typeof context === 'string'
      && Object.prototype.hasOwnProperty.call(OUTPUT_TOKENS_BY_CONTEXT, context)
    if (typeof systemPrompt !== 'string' || !Array.isArray(messages) || !supportedContext) {
      throw new HttpError(400, 'INVALID_REQUEST', 'A supported context, systemPrompt and messages are required.')
    }

    const maxOutputTokens = OUTPUT_TOKENS_BY_CONTEXT[context]
    const estimatedInputTokens = estimateTextTokens({ systemPrompt, messages })
    if (estimatedInputTokens > 120000) {
      throw new HttpError(413, 'MODEL_INPUT_TOO_LARGE', 'This Atlas request is too large to process safely.')
    }

    // A caller may name a session, but only the verified owner can use it for
    // model context or receive usage attributed to it.
    if (sessionId) {
      const { data: ownedSession, error: sessionError } = await admin
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!ownedSession) {
        throw new HttpError(403, 'SESSION_FORBIDDEN', 'This session does not belong to the current student.')
      }
    }

    if (SONNET_CONTEXTS.includes(context)) {
      if (!simulationId) {
        throw new HttpError(400, 'SIMULATION_REQUIRED', 'A claimed simulation is required for this request.')
      }

      const isGeneration = context === 'exam_simulation'
      const requestColumn = isGeneration ? 'generation_requested_at' : 'marking_requested_at'
      const requiredStatus = isGeneration ? 'generating' : 'marking'
      const { data: claimed, error: claimError } = await admin
        .from('exam_simulations')
        .update({ [requestColumn]: new Date().toISOString() })
        .eq('id', simulationId)
        .eq('user_id', user.id)
        .eq('status', requiredStatus)
        .is(requestColumn, null)
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) {
        throw new HttpError(409, 'SIMULATION_ALREADY_CLAIMED', 'This model request was already started or is not ready.')
      }
    }

    const usesSonnet = SONNET_CONTEXTS.includes(context)

    const selectedModel = usesSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

    // Simulator routes already consume their own atomic generation/marking
    // claims. Every other model route reserves token capacity here first.
    let allowanceId: string | null = null
    if (!usesSonnet) {
      allowanceId = await claimModelAllowance(
        admin,
        user.id,
        'atlas_chat',
        estimatedInputTokens,
        maxOutputTokens
      )
    }

    let anthropicResponse: Response
    let anthropicData: any
    try {
      anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: maxOutputTokens,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' }
            }
          ],
          messages,
          ...(!usesSonnet ? {
            tools: [RENDER_VIZ_TOOL],
            tool_choice: { type: 'auto' }
          } : {})
        })
      })

      anthropicData = await anthropicResponse.json()
      if (allowanceId) {
        const usage = anthropicData.usage
        await settleModelAllowance(
          admin,
          allowanceId,
          user.id,
          usage ? 'completed' : 'failed',
          Number(usage?.input_tokens || 0),
          Number(usage?.output_tokens || 0)
        )
      }
    } catch (error) {
      if (allowanceId) {
        await settleModelAllowance(admin, allowanceId, user.id, 'failed').catch(console.error)
      }
      throw error
    }

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
    if (usage) {
      const estimated = estimateCostUsd(selectedModel, usage.input_tokens, usage.output_tokens)
      const { error: logError } = await admin.from('token_logs').insert({
        user_id: user.id,
        session_id: sessionId || null,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        model: selectedModel,
        context: context || 'engine',
        estimated_cost_usd: estimated.cost,
        input_cost_per_m: estimated.inputCostPerM,
        output_cost_per_m: estimated.outputCostPerM,
        cost_currency: 'USD',
        model_call_allowance_id: allowanceId
      })
      if (logError) console.error('Token log failed', logError)
    }

    return new Response(JSON.stringify({ text, viz, usage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return errorResponse(e, corsHeaders)
  }
})
