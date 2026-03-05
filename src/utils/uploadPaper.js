import { supabase } from '../api/supabase'

export async function uploadPaper(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase()
  const fileType = ext === 'pdf' ? 'pdf' : 'image'
  const fileName = `${userId}/${Date.now()}.${ext}`

  // Upload to Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('papers')
    .upload(fileName, file, { upsert: false })

  if (storageError) throw storageError

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('papers')
    .getPublicUrl(fileName)

  // Save record to papers table
  const { data, error: dbError } = await supabase
    .from('papers')
    .insert({
      user_id: userId,
      file_url: urlData.publicUrl,
      file_type: fileType
    })
    .select()
    .single()

  if (dbError) throw dbError
  return data
}
