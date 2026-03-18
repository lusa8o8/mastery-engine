import { supabase } from '../api/supabase'

export async function getCoverage(userId, paperId = null) {
  // Get questions (optionally filtered by paper)
  let questionsQuery = supabase
    .from('questions')
    .select('id, topic, sub_type, paper_id')
    .eq('user_id', userId)
    .eq('source', 'extracted')

  if (paperId) {
    questionsQuery = questionsQuery.eq('paper_id', paperId)
  }

  const { data: questions, error: qError } = await questionsQuery
  if (qError) throw qError

  const questionIds = (questions || []).map(q => q.id)

  if (questionIds.length === 0) {
    return []
  }

  // Get correct attempts for these questions
  const { data: attempts, error: aError } = await supabase
    .from('attempts')
    .select('question_id, session_id')
    .eq('is_correct', true)
    .in('question_id', questionIds)

  if (aError) throw aError

  const coveredIds = new Set((attempts || []).map(a => a.question_id))

  // Build coverage map per topic/sub_type
  const topicMap = {}
  for (const q of questions) {
    if (!topicMap[q.topic]) {
      topicMap[q.topic] = { total: 0, covered: 0, subtypes: {} }
    }
    if (!topicMap[q.topic].subtypes[q.sub_type]) {
      topicMap[q.topic].subtypes[q.sub_type] = { total: 0, covered: 0 }
    }
    topicMap[q.topic].total++
    topicMap[q.topic].subtypes[q.sub_type].total++
    if (coveredIds.has(q.id)) {
      topicMap[q.topic].covered++
      topicMap[q.topic].subtypes[q.sub_type].covered++
    }
  }

  return Object.entries(topicMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, data]) => ({
      topic,
      total: data.total,
      covered: data.covered,
      pct: data.total > 0 ? Math.round((data.covered / data.total) * 100) : 0,
      subtypes: Object.entries(data.subtypes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sub_type, s]) => ({
          sub_type,
          total: s.total,
          covered: s.covered,
          pct: s.total > 0 ? Math.round((s.covered / s.total) * 100) : 0
        }))
    }))
}
