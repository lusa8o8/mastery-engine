import { supabase } from '../api/supabase'

export async function getVault(userId) {
  const { data, error } = await supabase
    .from('questions')
    .select('topic, sub_type')
    .eq('user_id', userId)
    .eq('source', 'extracted')

  if (error) throw error

  // Group by topic -> sub_types with counts
  const vault = {}
  for (const row of data) {
    const topic = row.topic || 'Uncategorised'
    const sub = row.sub_type || 'General'
    if (!vault[topic]) vault[topic] = {}
    if (!vault[topic][sub]) vault[topic][sub] = 0
    vault[topic][sub]++
  }

  // Convert to sorted array
  return Object.entries(vault)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, subs]) => ({
      topic,
      subtypes: Object.entries(subs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sub_type, count]) => ({ sub_type, count }))
    }))
}
