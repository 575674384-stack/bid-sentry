import { AiChatCompletionSchema, type AiChatMessage } from '../../shared/contracts'
import { normalizeAiBaseUrl } from '../settings/settingsService'

export interface ChatCompletionsInput {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  messages: readonly AiChatMessage[]
  signal?: AbortSignal
}

export async function requestChatCompletion(
  input: ChatCompletionsInput,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  const relayAbort = (): void => controller.abort(input.signal?.reason)
  input.signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const response = await fetchImpl(`${normalizeAiBaseUrl(input.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      redirect: 'error',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`ai-http-${response.status}`)
    const body = await response.json()
    const parsed = AiChatCompletionSchema.parse(body)
    const content = parsed.choices[0]?.message.content.trim()
    if (!content) throw new Error('ai-empty-response')
    return content
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', relayAbort)
  }
}
