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

  // Get signed URL (valid for 1 hour — enough for extraction)
  const { data: signedData, error: signedError } = await supabase.storage
    .from('papers')
    .createSignedUrl(fileName, 3600)

  if (signedError) throw signedError

  // Save record to papers table
  const { data, error: dbError } = await supabase
    .from('papers')
    .insert({
      user_id: userId,
      file_url: signedData.signedUrl,
      file_type: fileType
    })
    .select()
    .single()

  if (dbError) throw dbError
  return data
}
