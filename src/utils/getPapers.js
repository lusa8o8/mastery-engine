import { supabase } from '../api/supabase'

function extractFileName(fileUrl) {
  try {
    const decoded = decodeURIComponent(fileUrl)
    const parts = decoded.split('/')
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
    .select('id, file_url, file_type, uploaded_at')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })

  if (error) throw error

  return (data || []).map(p => ({
    id: p.id,
    name: extractFileName(p.file_url),
    file_type: p.file_type,
    uploaded_at: p.uploaded_at
  }))
}
