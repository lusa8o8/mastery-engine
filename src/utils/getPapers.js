import { supabase } from '../api/supabase'

function extractFileName(fileUrl) {
  try {
    // Remove query string first (handles signed URLs with ?token=...)
    const urlWithoutQuery = fileUrl.split('?')[0]
    const parts = urlWithoutQuery.split('/')
    const raw = parts[parts.length - 1]
    // Remove UUID prefix if present (format: uuid_filename.ext)
    const withoutUuid = raw.replace(/^[0-9a-f-]{36}_/i, '')
    return withoutUuid || raw
  } catch {
    return 'Untitled paper'
  }
}

export async function getPapers(userId) {
  const { data, error } = await supabase
    .from('papers')
    .select(`
      id,
      name,
      file_url,
      file_type,
      assessment_type,
      uploaded_at,
      questions(id)
    `)
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })

  if (error) throw error

  return (data || [])
    .filter(function(p) { return p.questions && p.questions.length > 0 })
    .map(function(p) {
      return {
        id: p.id,
        name: p.name || extractFileName(p.file_url),
        file_type: p.file_type,
        assessment_type: p.assessment_type || null,
        uploaded_at: p.uploaded_at,
        question_count: p.questions.length
      }
    })
}
