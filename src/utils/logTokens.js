import { supabase } from '../api/supabase'

const INPUT_COST_PER_M = 0.80
const OUTPUT_COST_PER_M = 4.00

export function estimateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_M
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_M
  return parseFloat((inputCost + outputCost).toFixed(6))
}

export async function logTokens({ userId, sessionId, inputTokens, outputTokens, model, context }) {
  try {
    await supabase.from('token_logs').insert({
      user_id: userId,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: model || 'claude-haiku-4-5-20251001',
      context: context || 'engine'
    })
  } catch (e) {
    console.error('Token log failed:', e)
  }
}

export async function getSessionTokens(sessionId) {
  const { data, error } = await supabase
    .from('token_logs')
    .select('input_tokens, output_tokens')
    .eq('session_id', sessionId)

  if (error) throw error

  const totals = data.reduce(
    (acc, row) => ({
      input: acc.input + row.input_tokens,
      output: acc.output + row.output_tokens
    }),
    { input: 0, output: 0 }
  )

  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    estimatedCost: estimateCost(totals.input, totals.output)
  }
}

export async function getUserTokens(userId) {
  const { data, error } = await supabase
    .from('token_logs')
    .select('input_tokens, output_tokens')
    .eq('user_id', userId)

  if (error) throw error

  const totals = data.reduce(
    (acc, row) => ({
      input: acc.input + row.input_tokens,
      output: acc.output + row.output_tokens
    }),
    { input: 0, output: 0 }
  )

  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    estimatedCost: estimateCost(totals.input, totals.output)
  }
}
