import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export class HttpError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, 'SERVER_MISCONFIGURED', 'Server configuration is incomplete.')
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export async function requireUser(req: Request, admin = createAdminClient()) {
  const header = req.headers.get('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'A valid student session is required.')
  }

  const { data, error } = await admin.auth.getUser(match[1])
  if (error || !data.user) {
    throw new HttpError(401, 'AUTH_INVALID', 'The student session is invalid or expired.')
  }
  return data.user
}

export function errorResponse(error: unknown, corsHeaders: Record<string, string>) {
  const known = error instanceof HttpError
  const status = known ? error.status : 500
  const code = known ? error.code : 'INTERNAL_ERROR'
  const message = known ? error.message : 'The request could not be completed.'

  if (!known) console.error(error)

  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
