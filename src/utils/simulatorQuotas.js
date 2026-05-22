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
