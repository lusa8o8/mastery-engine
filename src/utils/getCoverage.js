import { supabase } from '../api/supabase'

export async function getCoverage(userId) {
  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('id, topic, sub_type')
    .eq('user_id', userId)
    .eq('source', 'extracted')

  if (qError) throw qError

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)

  const sessionIds = sessions?.map(s => s.id) || []

  const { data: attempts, error: aError } = await supabase
    .from('attempts')
    .select('question_id')
    .eq('is_correct', true)
    .not('question_id', 'is', null)
    .in('session_id', sessionIds)

  if (aError) throw aError

  const coveredIds = new Set(attempts.map(a => a.question_id))

  const coverage = {}
  for (const q of questions) {
    const topic = q.topic || 'Uncategorised'
    const sub = q.sub_type || 'General'
    if (!coverage[topic]) coverage[topic] = {}
    if (!coverage[topic][sub]) coverage[topic][sub] = { total: 0, covered: 0 }
    coverage[topic][sub].total++
    if (coveredIds.has(q.id)) coverage[topic][sub].covered++
  }

  return Object.entries(coverage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, subs]) => {
      const topicTotal = Object.values(subs).reduce((s, v) => s + v.total, 0)
      const topicCovered = Object.values(subs).reduce((s, v) => s + v.covered, 0)
      return {
        topic,
        total: topicTotal,
        covered: topicCovered,
        pct: topicTotal > 0 ? Math.round((topicCovered / topicTotal) * 100) : 0,
        subtypes: Object.entries(subs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([sub_type, { total, covered }]) => ({
            sub_type,
            total,
            covered,
            pct: total > 0 ? Math.round((covered / total) * 100) : 0
          }))
      }
    })
}
