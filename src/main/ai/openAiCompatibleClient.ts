import {
  AiConnectionTestResultSchema,
  type AiConnectionTestResult
} from '../../shared/contracts/settings'

export interface OpenAiConnectionInput {
  baseUrl: string
  apiKey: string
  timeoutMs: number
}

type FetchImplementation = typeof fetch

const STATUS_MESSAGES = Object.freeze({
  unauthorized: 'API Key 无效或未获得授权。',
  forbidden: '当前 API Key 无权访问模型列表。',
  'not-supported': '该接口未提供 OpenAI 兼容的 /models 端点。',
  'rate-limited': '接口请求过于频繁或账户额度受限。',
  'server-error': 'AI 服务暂时不可用。',
  timeout: '连接 AI 接口超时。',
  'network-error': '无法连接到 AI 接口，请检查地址和网络。',
  'invalid-response': 'AI 接口返回了无法识别的响应。'
} as const)

export async function testOpenAiCompatibleConnection(
  input: OpenAiConnectionInput,
  fetchImplementation: FetchImplementation = fetch
): Promise<AiConnectionTestResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)

  try {
    const response = await fetchImplementation(`${input.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`
      },
      redirect: 'error',
      signal: controller.signal
    })

    if (!response.ok) {
      return failureForStatus(response.status)
    }

    const body = await readLimitedBody(response, 4_096)
    if (!body.complete) {
      return AiConnectionTestResultSchema.parse({
        schemaVersion: 1,
        ok: true,
        status: 'connected',
        message: '连接成功；模型列表较大，未完整读取。'
      })
    }

    try {
      const payload = JSON.parse(body.text) as { data?: unknown }
      const modelCount = Array.isArray(payload.data) ? payload.data.length : undefined
      return AiConnectionTestResultSchema.parse({
        schemaVersion: 1,
        ok: true,
        status: 'connected',
        message: 'AI 接口连接成功。',
        ...(modelCount === undefined ? {} : { modelCount })
      })
    } catch {
      return failure('invalid-response')
    }
  } catch {
    return controller.signal.aborted ? failure('timeout') : failure('network-error')
  } finally {
    clearTimeout(timeout)
  }
}

function failureForStatus(status: number): AiConnectionTestResult {
  if (status === 401) return failure('unauthorized')
  if (status === 403) return failure('forbidden')
  if (status === 404) return failure('not-supported')
  if (status === 429) return failure('rate-limited')
  return failure('server-error')
}

function failure(status: keyof typeof STATUS_MESSAGES): AiConnectionTestResult {
  return AiConnectionTestResultSchema.parse({
    schemaVersion: 1,
    ok: false,
    status,
    message: STATUS_MESSAGES[status]
  })
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number
): Promise<{ text: string; complete: boolean }> {
  if (!response.body) {
    return { text: '', complete: true }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue

    const remaining = maximumBytes - totalBytes
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining))
      await reader.cancel()
      return { text: decodeChunks(chunks), complete: false }
    }

    chunks.push(value)
    totalBytes += value.byteLength
  }

  return { text: decodeChunks(chunks), complete: true }
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const joined = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(joined)
}
