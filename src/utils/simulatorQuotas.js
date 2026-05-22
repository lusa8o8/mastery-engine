import { supabase } from '../api/supabase'

export const SIMULATOR_QUOTAS = {
  free: {
    label: 'Free',
    storedPapers: 1,
    generatedPapersPerMonth: 1,
    markedAttemptsPerMonth: 1
  },
  premium: {
    label: 'Premium',
    storedPapers: 5,
    generatedPapersPerMonth: 3,
    markedAttemptsPerMonth: 3
  },
  pro: {
    label: 'Pro',
    storedPapers: 20,
    generatedPapersPerMonth: 10,
    markedAttemptsPerMonth: 10
  }
}

export function getQuotaForTier(planTier) {
  return SIMULATOR_QUOTAS[planTier] || SIMULATOR_QUOTAS.free
}

export function getQuotaWindowStartIso() {
  const start = new Date()
  start.setDate(start.getDate() - 30)
  return start.toISOString()
}

export function getNextQuotaResetDate(oldestUsageDate) {
  const reset = oldestUsageDate ? new Date(oldestUsageDate) : new Date()
  reset.setDate(reset.getDate() + 30)
  return reset
}

export function formatQuotaResetDate(date = getNextQuotaResetDate()) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export async function getUserPlanTier(userId) {
  if (!userId) return 'free'

  const { data, error } = await supabase
    .from('user_entitlements')
    .select('plan_tier')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data?.plan_tier || 'free'
}

export async function getUserSimulatorQuota(userId) {
  const tier = await getUserPlanTier(userId)
  return {
    tier,
    ...getQuotaForTier(tier)
  }
}

export async function getUserSimulatorQuotaStatus(userId) {
  const quota = await getUserSimulatorQuota(userId)
  const windowStart = getQuotaWindowStartIso()

  const { data, error } = await supabase
    .from('exam_simulations')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .neq('status', 'failed')
    .order('created_at', { ascending: true })

  if (error) throw error

  const usedGenerations = data?.length || 0
  return {
    ...quota,
    usedGenerations,
    remainingGenerations: Math.max(0, quota.generatedPapersPerMonth - usedGenerations),
    nextResetDate: getNextQuotaResetDate(data?.[0]?.created_at)
  }
}
