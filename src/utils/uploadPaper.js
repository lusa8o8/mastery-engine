import { supabase } from '../api/supabase'

export async function uploadPaper(file, userId, name, assessmentType) {
  const ext = file.name.split('.').pop().toLowerCase()
  const fileType = ext === 'pdf' ? 'pdf' : 'image'
  const fileName = `${userId}/${crypto.randomUUID()}.${ext}`

  const { error: storageError } = await supabase.storage
    .from('papers')
    .upload(fileName, file, { upsert: false })
  if (storageError) throw storageError

  const { data, error: dbError } = await supabase
    .from('papers')
    .insert({
      user_id: userId,
      file_url: `papers/${fileName}`,
      file_type: fileType,
      name: name || null,
      assessment_type: assessmentType || null
    })
    .select()
    .single()
  if (dbError) {
    // Avoid an orphaned private object when its metadata row cannot be created.
    const { error: cleanupError } = await supabase.storage.from('papers').remove([fileName])
    if (cleanupError) console.error('Failed to clean up uploaded paper:', cleanupError)
    throw dbError
  }

  return data
}
