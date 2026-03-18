# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
Math mastery web app. React + Vite, Supabase (auth + DB + storage),
Claude API via Supabase Edge Functions, Vercel hosting.

## Local path
C:\Users\Lusa\mastery-engine

## Strict mode rules
- Discovery and diagnosis before any code is written
- No shortcuts, no one-shotting complex changes
- Show changed sections verbatim after every edit
- One concern at a time
- Always push after confirming changes

## Current task
Moving Anthropic API calls from browser to Supabase Edge Functions.
- atlas-chat — done
- atlas-variant — done, testing
- atlas-extract — done

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

For Supabase edge functions (Deno runtime):
```bash
supabase functions serve        # Serve all edge functions locally
supabase functions deploy <name> # Deploy a specific function
```

## Architecture

**Solvd / Mastery Engine** is a React + Supabase application for AI-guided exam prep. Users upload past papers, Claude extracts questions, and then guides learners through 6 progressive layers.

### Tech Stack
- **Frontend**: React 18, React Router DOM, Vite 7
- **Backend**: Supabase (Postgres, Auth, Storage)
- **Edge Functions**: Supabase Edge Functions (Deno/TypeScript) in `supabase/functions/`
- **AI**: Anthropic Claude API (`claude-haiku-4-5-20251001`)
- **Deployment**: Vercel (SPA rewrites via `vercel.json`)

### Frontend (`src/`)

| Path | Role |
|------|------|
| `src/api/supabase.js` | Supabase client init |
| `src/api/llm.js` | Direct browser calls to Claude (uses `anthropic-dangerous-direct-browser-access`) |
| `src/hooks/useAuth.js` | Auth state (sign up/in/out, session) |
| `src/pages/EnginePage.jsx` | Core tutoring UI — 6-layer session loop |
| `src/pages/UploadPage.jsx` | PDF/image upload → Claude vision extraction |
| `src/utils/constants.js` | `LAYERS` enum and `ERROR_TYPES` |
| `src/utils/enginePrompts.js` | System prompts per learning layer |
| `src/utils/logTokens.js` | Token usage tracking (cost: $0.80/M input, $4.00/M output) |

### Edge Functions (`supabase/functions/`)

- **`atlas-chat/`** — Main chat endpoint: authenticates via Supabase session, calls Claude, logs tokens to `token_logs` table.
- **`atlas-variant/`** — Generates exam-style question variants for a given topic/layer.

Both functions are CORS-enabled and require `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` as environment secrets.

### The 6 Learning Layers

Defined in `src/utils/constants.js` as `LAYERS`:
1. **foundation** — Conceptual intro + worked example
2. **drills** — Pure application practice
3. **patterns** — Examiner pattern recognition
4. **traps** — Common exam tricks
5. **pressure** — Time-constrained multi-concept
6. **recall** — Retention check

### Database Tables (key)
- `sessions` — Learning sessions (user_id, topic, sub_type, current_layer)
- `questions` — Extracted exam questions (linked to papers)
- `papers` — Uploaded documents (stored in Supabase Storage)
- `token_logs` — Claude API token usage per session

### Environment Variables

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_ANTHROPIC_API_KEY      # for direct browser API calls
ANTHROPIC_API_KEY            # for edge functions
SUPABASE_URL                 # for edge functions
SUPABASE_SERVICE_ROLE_KEY    # for edge functions
```

### Theming

Four themes (`paper`, `white`, `dark`, `forest`) stored in `localStorage`. CSS custom properties handle colors; `paper` (beige) is the default. Typography uses Georgia/Charter serif.
