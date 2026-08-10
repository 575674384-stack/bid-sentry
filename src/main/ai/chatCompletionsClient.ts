import {
  AiChatCompletionSchema,
  AiChatMessageSchema,
  type AiChatMessage
} from '../../shared/contracts'
import { normalizeAiBaseUrl } from '../settings/settingsService'

const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_AI_REQUEST_BYTES = 256 * 1024

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
  const messages = AiChatMessageSchema.array().max(32).parse(input.messages)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  const relayAbort = (): void => controller.abort(input.signal?.reason)
  input.signal?.addEventListener('abort', relayAbort, { once: true })
  if (input.signal?.aborted) controller.abort(input.signal.reason)
  try {
    const requestBody = JSON.stringify({
      model: input.model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
    // Character limits alone are not a transport budget: Chinese text and
    // escaped JSON can make a seemingly small prompt much larger on the wire.
    // Refuse an oversized request before touching the configured endpoint.
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_AI_REQUEST_BYTES) {
      throw new Error('ai-request-too-large')
    }
    const response = await fetchImpl(`${normalizeAiBaseUrl(input.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`
      },
      body: requestBody,
      redirect: 'error',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`ai-http-${response.status}`)
    const responseBody = JSON.parse(
      await readResponseText(response, MAX_AI_RESPONSE_BYTES)
    ) as unknown
    const parsed = AiChatCompletionSchema.parse(responseBody)
    const content = parsed.choices[0]?.message.content.trim()
    if (!content) throw new Error('ai-empty-response')
    return content
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', relayAbort)
  }
}

async function readResponseText(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error('ai-response-body-missing')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > limit) throw new Error('ai-response-too-large')
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
