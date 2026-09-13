import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('foundational migration recreates legacy tables and tenant policies', async () => {
  const sql = await read('supabase/migrations/202605200000_create_foundational_schema.sql')
  for (const table of ['papers', 'questions', 'sessions', 'messages', 'attempts', 'token_logs']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }
  assert.match(sql, /sessions\.id = messages\.session_id/i)
  assert.match(sql, /sessions\.user_id = \(select auth\.uid\(\)\)/i)
})

test('paper storage is private, bounded and scoped to the JWT user folder', async () => {
  const sql = await read('supabase/migrations/202605200000_create_foundational_schema.sql')
  assert.match(sql, /20971520/)
  for (const mime of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
    assert.match(sql, new RegExp(mime.replace('/', '\\/')))
  }
  assert.match(sql, /bucket_id = 'papers'/)
  assert.match(sql, /split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text/)
  assert.doesNotMatch(sql, /create policy[^;]+using\s*\(true\)/is)
})

test('every model boundary requires a verified user and emits structured errors', async () => {
  const config = await read('supabase/config.toml')
  for (const name of ['atlas-chat', 'atlas-extract', 'atlas-variant']) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = true`))
    const source = await read(`supabase/functions/${name}/index.ts`)
    assert.match(source, /requireUser\(req/)
    assert.match(source, /errorResponse\(e, corsHeaders\)/)
  }

  const chat = await read('supabase/functions/atlas-chat/index.ts')
  const extract = await read('supabase/functions/atlas-extract/index.ts')
  assert.doesNotMatch(chat, /\{[^}]*userId[^}]*\}\s*=\s*await req\.json\(\)/s)
  assert.doesNotMatch(extract, /\{[^}]*(userId|fileUrl|fileType)[^}]*\}\s*=\s*await req\.json\(\)/s)
  assert.match(extract, /\.eq\('user_id', user\.id\)/)
})

test('browser has no Anthropic key path and tutor resume loads durable state', async () => {
  const envExample = await read('.env.example')
  const engine = await read('src/pages/EnginePage.jsx')
  assert.doesNotMatch(envExample, /VITE_ANTHROPIC_API_KEY/)
  assert.doesNotMatch(engine, /userId\s*[,}]/)
  assert.doesNotMatch(engine, /content:\s*input\.trim\(\)/)
  assert.match(engine, /\.select\('current_layer, current_question_id'\)/)
  assert.match(engine, /\.from\('messages'\)[\s\S]+\.order\('created_at', \{ ascending: true \}\)/)
})

test('simulator quota claims are transactional and model calls consume a claim once', async () => {
  const quotaSql = await read('supabase/migrations/202609130001_add_transactional_simulator_quotas.sql')
  const simulator = await read('src/pages/SimulatePage.jsx')
  const chat = await read('supabase/functions/atlas-chat/index.ts')

  assert.match(quotaSql, /create or replace function public\.claim_exam_generation/i)
  assert.match(quotaSql, /create or replace function public\.claim_exam_marking/i)
  assert.match(quotaSql, /pg_advisory_xact_lock/i)
  assert.match(quotaSql, /drop policy if exists "Users can create their exam simulations"/)
  assert.match(simulator, /\.rpc\('claim_exam_generation'/)
  assert.match(simulator, /\.rpc\('claim_exam_marking'/)
  assert.doesNotMatch(simulator, /\.from\('exam_simulations'\)\s*\.insert\(/)
  assert.match(chat, /SIMULATION_ALREADY_CLAIMED/)
  assert.match(chat, /generation_requested_at/)
  assert.match(chat, /marking_requested_at/)
  assert.match(quotaSql, /revoke insert, update, delete on public\.token_logs from authenticated/i)
})

test('non-simulator model calls reserve server-owned token allowance', async () => {
  const allowanceSql = await read('supabase/migrations/202609130004_add_model_call_allowances.sql')
  const allowanceHelper = await read('supabase/functions/_shared/modelAllowance.ts')
  const chat = await read('supabase/functions/atlas-chat/index.ts')
  const variant = await read('supabase/functions/atlas-variant/index.ts')
  const extract = await read('supabase/functions/atlas-extract/index.ts')

  assert.match(allowanceSql, /create table if not exists public\.model_call_allowances/i)
  assert.match(allowanceSql, /create or replace function public\.claim_model_allowance/i)
  assert.match(allowanceSql, /create or replace function public\.settle_model_allowance/i)
  assert.match(allowanceSql, /pg_advisory_xact_lock/i)
  assert.match(allowanceSql, /created_at >= now\(\) - interval '30 days'/i)
  assert.match(allowanceSql, /revoke all on function public\.claim_model_allowance[^;]+authenticated/i)
  assert.match(allowanceSql, /grant execute on function public\.claim_model_allowance[^;]+service_role/i)

  assert.match(allowanceHelper, /MODEL_ALLOWANCE_EXHAUSTED/)
  for (const source of [chat, variant, extract]) {
    assert.match(source, /claimModelAllowance\(/)
    assert.match(source, /settleModelAllowance\(/)
  }

  assert.match(chat, /OUTPUT_TOKENS_BY_CONTEXT/)
  assert.match(chat, /max_tokens: maxOutputTokens/)
  assert.doesNotMatch(chat, /body\.maxTokens|maxTokens\s*\|\|/)
  assert.match(variant, /'question_variant'/)
  assert.match(extract, /'paper_extraction'/)
})

test('tutor question IDs and extraction retries are durable', async () => {
  const questionSql = await read('supabase/migrations/202609130002_add_session_current_question.sql')
  const extractionSql = await read('supabase/migrations/202609130003_add_paper_extraction_state.sql')
  const prompts = await read('src/utils/enginePrompts.js')
  const engine = await read('src/pages/EnginePage.jsx')
  const extract = await read('supabase/functions/atlas-extract/index.ts')
  const upload = await read('src/utils/uploadPaper.js')
  const tokenClient = await read('src/utils/logTokens.js')

  assert.match(questionSql, /current_question_id uuid/i)
  assert.match(questionSql, /references public\.questions\(id\) on delete set null/i)
  assert.match(engine, /question_id: currentQuestion\?\.id \|\| null/)
  assert.match(engine, /current_question_id: question\?\.id \|\| null/)
  assert.match(prompts, /CURRENT STUDENT QUESTION/)

  assert.match(extractionSql, /extraction_status in \('pending', 'processing', 'completed', 'failed'\)/)
  assert.match(extractionSql, /create or replace function public\.claim_paper_extraction/i)
  assert.match(extractionSql, /interval '15 minutes'/)
  assert.match(extractionSql, /create or replace function public\.complete_paper_extraction/i)
  assert.match(extractionSql, /delete from public\.questions where paper_id = p_paper_id/i)
  assert.match(extract, /EXTRACTION_IN_PROGRESS/)
  assert.match(extract, /\.rpc\('complete_paper_extraction'/)
  assert.match(upload, /crypto\.randomUUID\(\)/)
  assert.match(upload, /\.remove\(\[fileName\]\)/)
  assert.doesNotMatch(upload, /createSignedUrl/)
  assert.doesNotMatch(tokenClient, /from\('token_logs'\)\.insert/)
  assert.match(extract, /context: 'paper_extraction'/)
})
