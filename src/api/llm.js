const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const BASE_URL = 'https://api.anthropic.com/v1/messages'

export async function llmCall(systemPrompt, messages) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages
    })
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error?.message || 'LLM request failed')
  }

  const data = await response.json()
  return data.content[0].text
}

export async function llmAsk(systemPrompt, userMessage, context = []) {
  return llmCall(systemPrompt, [...context, { role: 'user', content: userMessage }])
}

export async function llmVision(systemPrompt, imageBase64, mimeType = 'image/jpeg') {
  return llmCall(systemPrompt, [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: 'Extract all math questions from this image exactly as written. Return as JSON array.'
        }
      ]
    }
  ])
}
