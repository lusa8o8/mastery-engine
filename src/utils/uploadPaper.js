import { supabase } from '../api/supabase'

export async function uploadPaper(file, userId, name, assessmentType) {
  const ext = file.name.split('.').pop().toLowerCase()
  const fileType = ext === 'pdf' ? 'pdf' : 'image'
  const fileName = `${userId}/${Date.now()}.${ext}`

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
  if (dbError) throw dbError

  const { data: signedData, error: signedError } = await supabase.storage
    .from('papers')
    .createSignedUrl(fileName, 3600)
  if (signedError) throw signedError

  return { ...data, file_url: signedData.signedUrl }
}
