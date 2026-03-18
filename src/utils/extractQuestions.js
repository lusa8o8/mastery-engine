import { supabase } from '../api/supabase'

export async function extractAndSave(paper) {
  const { data: { session } } = await supabase.auth.getSession()

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atlas-extract`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        paperId: paper.id,
        fileUrl: paper.file_url,
        fileType: paper.file_type,
        userId: paper.user_id
      })
    }
  )

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'atlas-extract error')
  if (data.error) throw new Error(data.error)

  return data.count
}
