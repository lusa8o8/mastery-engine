import { supabase } from '../api/supabase'

export async function getQuestionsForSubType(userId, topic, subType) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('user_id', userId)
    .eq('topic', topic)
    .eq('sub_type', subType)
  if (error) throw error
  return data || []
}
