import { supabase } from '../api/supabase'

export async function extractAndSave(paper) {
  // Extraction can begin after a long upload or an idle browser session. Force a
  // refresh here so the Edge Function never receives a stale cached access token.
  const { data: { session }, error: sessionError } = await supabase.auth.refreshSession()
  if (sessionError || !session?.access_token) {
    throw new Error('Your session has expired. Please sign in again and retry extraction.')
  }

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
