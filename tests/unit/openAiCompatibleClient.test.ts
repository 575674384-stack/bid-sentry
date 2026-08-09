import { describe, expect, it } from 'vitest'
import { testOpenAiCompatibleConnection } from '../../src/main/ai/openAiCompatibleClient'

const CONNECTION = Object.freeze({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'private-api-key',
  timeoutMs: 100
})

describe('testOpenAiCompatibleConnection', () => {
  it('calls the models endpoint with authorization and returns only safe data', async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.example.com/v1/models')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-api-key')
      return new Response(JSON.stringify({ data: [{ id: 'one' }, { id: 'two' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const result = await testOpenAiCompatibleConnection(CONNECTION, fetchMock)

    expect(result).toMatchObject({ ok: true, status: 'connected', modelCount: 2 })
    expect(JSON.stringify(result)).not.toContain(CONNECTION.apiKey)
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-supported'],
    [429, 'rate-limited'],
    [500, 'server-error']
  ] as const)('maps HTTP %s to %s', async (status, expectedStatus) => {
    const result = await testOpenAiCompatibleConnection(CONNECTION, async () =>
      Promise.resolve(new Response('', { status }))
    )

    expect(result).toMatchObject({ ok: false, status: expectedStatus })
    expect(JSON.stringify(result)).not.toContain(CONNECTION.apiKey)
  })

  it('distinguishes invalid JSON and network failures', async () => {
    const invalid = await testOpenAiCompatibleConnection(CONNECTION, async () =>
      Promise.resolve(new Response('not-json', { status: 200 }))
    )
    const network = await testOpenAiCompatibleConnection(CONNECTION, async () => {
      throw new Error(`request failed with ${CONNECTION.apiKey}`)
    })

    expect(invalid).toMatchObject({ ok: false, status: 'invalid-response' })
    expect(network).toMatchObject({ ok: false, status: 'network-error' })
    expect(JSON.stringify(network)).not.toContain(CONNECTION.apiKey)
  })

  it('aborts a slow request and reports a timeout', async () => {
    const fetchMock: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })

    const result = await testOpenAiCompatibleConnection(
      { ...CONNECTION, timeoutMs: 5 },
      fetchMock
    )

    expect(result).toMatchObject({ ok: false, status: 'timeout' })
  })

  it('caps large response bodies without failing a successful connection', async () => {
    const body = JSON.stringify({ data: Array.from({ length: 2_000 }, (_, id) => ({ id })) })
    const result = await testOpenAiCompatibleConnection(CONNECTION, async () =>
      Promise.resolve(new Response(body, { status: 200 }))
    )

    expect(result).toMatchObject({ ok: true, status: 'connected' })
    expect('modelCount' in result).toBe(false)
  })
})
