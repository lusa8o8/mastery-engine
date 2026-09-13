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
        paperId: paper.id
      })
    }
  )

  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'atlas-extract error')

  return data.count
}
