import { supabase } from '../api/supabase'

export async function getVault(userId, paperId = null) {
  let query = supabase
    .from('questions')
    .select('topic, sub_type, paper_id')
    .eq('user_id', userId)
    .eq('source', 'extracted')

  if (paperId) {
    query = query.eq('paper_id', paperId)
  }

  const { data, error } = await query
  if (error) throw error

  const topicMap = {}
  for (const q of data || []) {
    if (!topicMap[q.topic]) topicMap[q.topic] = {}
    if (!topicMap[q.topic][q.sub_type]) topicMap[q.topic][q.sub_type] = 0
    topicMap[q.topic][q.sub_type]++
  }

  return Object.entries(topicMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, subtypes]) => ({
      topic,
      subtypes: Object.entries(subtypes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sub_type, count]) => ({ sub_type, count }))
    }))
}
