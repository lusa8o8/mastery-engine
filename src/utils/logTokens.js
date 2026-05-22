import { supabase } from '../api/supabase'

const MODEL_PRICING_USD_PER_M = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 }
}

export function estimateCost(inputTokens, outputTokens, model = 'claude-haiku-4-5-20251001') {
  const pricing = MODEL_PRICING_USD_PER_M[model] || MODEL_PRICING_USD_PER_M['claude-haiku-4-5-20251001']
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return parseFloat((inputCost + outputCost).toFixed(6))
}

export async function logTokens({ userId, sessionId, inputTokens, outputTokens, model, context }) {
  const resolvedModel = model || 'claude-haiku-4-5-20251001'
  const pricing = MODEL_PRICING_USD_PER_M[resolvedModel] || MODEL_PRICING_USD_PER_M['claude-haiku-4-5-20251001']
  try {
    await supabase.from('token_logs').insert({
      user_id: userId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: resolvedModel,
      context: context || 'engine',
      estimated_cost_usd: estimateCost(inputTokens, outputTokens, resolvedModel),
      input_cost_per_m: pricing.input,
      output_cost_per_m: pricing.output,
      cost_currency: 'USD'
    })
  } catch (e) {
    console.error('Token log failed:', e)
  }
}

export async function getSessionTokens(sessionId) {
  const { data, error } = await supabase
    .from('token_logs')
    .select('input_tokens, output_tokens, estimated_cost_usd')
    .eq('session_id', sessionId)

  if (error) throw error

  const totals = data.reduce(
    (acc, row) => ({
      input: acc.input + row.input_tokens,
      output: acc.output + row.output_tokens,
      cost: acc.cost + (Number(row.estimated_cost_usd) || 0)
    }),
    { input: 0, output: 0, cost: 0 }
  )

  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    estimatedCost: totals.cost > 0 ? parseFloat(totals.cost.toFixed(6)) : estimateCost(totals.input, totals.output)
  }
}

export async function getUserTokens(userId) {
  const { data, error } = await supabase
    .from('token_logs')
    .select('input_tokens, output_tokens, estimated_cost_usd')
    .eq('user_id', userId)

  if (error) throw error

  const totals = data.reduce(
    (acc, row) => ({
      input: acc.input + row.input_tokens,
      output: acc.output + row.output_tokens,
      cost: acc.cost + (Number(row.estimated_cost_usd) || 0)
    }),
    { input: 0, output: 0, cost: 0 }
  )

  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    estimatedCost: totals.cost > 0 ? parseFloat(totals.cost.toFixed(6)) : estimateCost(totals.input, totals.output)
  }
}
