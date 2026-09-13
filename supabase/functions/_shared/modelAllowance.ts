import { createAdminClient, HttpError } from './http.ts'

type AdminClient = ReturnType<typeof createAdminClient>

export function estimateTextTokens(value: unknown) {
  // A conservative tokenizer-independent reservation. Provider usage remains
  // the source of truth once the call settles.
  return Math.ceil(JSON.stringify(value ?? '').length / 3)
}

export async function claimModelAllowance(
  admin: AdminClient,
  userId: string,
  route: 'atlas_chat' | 'question_variant' | 'paper_extraction',
  reservedInputTokens: number,
  reservedOutputTokens: number
) {
  const { data, error } = await admin.rpc('claim_model_allowance', {
    p_user_id: userId,
    p_route: route,
    p_reserved_input_tokens: Math.max(0, Math.ceil(reservedInputTokens)),
    p_reserved_output_tokens: Math.max(1, Math.ceil(reservedOutputTokens))
  })
  if (error) throw error
  if (!data?.ok) {
    const code = data?.error_code || 'MODEL_ALLOWANCE_DENIED'
    const status = code === 'MODEL_ALLOWANCE_EXHAUSTED' ? 429 : 503
    throw new HttpError(status, code, code === 'MODEL_ALLOWANCE_EXHAUSTED'
      ? 'Your current Atlas model allowance has been reached. Please try again after it refreshes.'
      : 'Atlas could not verify the model allowance for this request.')
  }
  return String(data.allowance_id)
}

export async function settleModelAllowance(
  admin: AdminClient,
  allowanceId: string,
  userId: string,
  status: 'completed' | 'failed',
  inputTokens = 0,
  outputTokens = 0
) {
  const { data, error } = await admin.rpc('settle_model_allowance', {
    p_allowance_id: allowanceId,
    p_user_id: userId,
    p_status: status,
    p_actual_input_tokens: Math.max(0, Math.ceil(inputTokens)),
    p_actual_output_tokens: Math.max(0, Math.ceil(outputTokens))
  })
  if (error) throw error
  if (data !== true) throw new Error('Model allowance could not be settled.')
}
