const TOGETHER_API_KEY = import.meta.env.VITE_TOGETHER_API_KEY
const BASE_URL = 'https://api.together.xyz/v1'

const TEXT_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
const VISION_MODEL = 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo'

export async function togetherCall({ systemPrompt, messages, vision = false }) {
  const model = vision ? VISION_MODEL : TEXT_MODEL
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOGETHER_API_KEY}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
    })
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error?.message || 'Together AI request failed')
  }
  const data = await response.json()
  return data.choices[0].message.content
}

export async function togetherAsk(systemPrompt, userMessage, context = []) {
  return togetherCall({
    systemPrompt,
    messages: [...context, { role: 'user', content: userMessage }]
  })
}

export async function togetherVision(systemPrompt, imageBase64, mimeType = 'image/jpeg') {
  return togetherCall({
    vision: true,
    systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: 'Extract all math questions from this image exactly as written.' }
        ]
      }
    ]
  })
}
