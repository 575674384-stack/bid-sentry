import { describe, expect, it } from 'vitest'
import { AiReviewResponseSchema } from '../../src/shared/contracts'
import { requestChatCompletion } from '../../src/main/ai/chatCompletionsClient'
import { buildReviewAiChunks } from '../../src/core/ai/chunking'

describe('AI grounding contracts', () => {
  it('chunks complete document nodes with bounded anchor data', () => {
    const makeDocument = (prefix: string, count: number) => ({
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: `${prefix}.docx`,
      hasTextLayer: true,
      nodes: Array.from({ length: count }, (_, index) => ({
        nodeId: `${prefix}-${index}`,
        kind: 'paragraph' as const,
        text: `${prefix}-${index}-${'文本'.repeat(1200)}`,
        anchor: {
          nodeId: `${prefix}-${index}`,
          kind: 'paragraph' as const,
          label: '段落',
          excerpt: `${prefix}-${index}`,
          digest: 'a'.repeat(64)
        }
      })),
      textLength: count * 2_500
    })
    const chunks = buildReviewAiChunks(makeDocument('tender', 4), makeDocument('bid', 1))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.tender.textLength <= 8_000)).toBe(true)
    expect(chunks.every((chunk) => chunk.bid.textLength <= 8_000)).toBe(true)
    expect(chunks.flatMap((chunk) => chunk.tender.nodes).map((node) => node.nodeId)).toEqual(
      expect.arrayContaining(['tender-0', 'tender-1', 'tender-2', 'tender-3'])
    )
  })

  it('fails closed when a document would require more than 64 AI requests', () => {
    const document = {
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: 'large.docx',
      hasTextLayer: true,
      nodes: Array.from({ length: 65 }, (_, index) => ({
        nodeId: `p-${index}`,
        kind: 'paragraph' as const,
        text: 'x'.repeat(8_000),
        anchor: {
          nodeId: `p-${index}`,
          kind: 'paragraph' as const,
          label: '段落',
          excerpt: 'x',
          digest: 'b'.repeat(64)
        }
      })),
      textLength: 520_000
    }
    expect(() => buildReviewAiChunks(document, document)).toThrow('ai-request-budget-exceeded')
  })

  it('accepts only schema-valid, non-error AI findings', () => {
    const result = AiReviewResponseSchema.safeParse({
      findings: [
        {
          id: 'a'.repeat(24),
          type: 'ai-suggestion',
          severity: 'needs-review',
          confidence: 0.7,
          summary: '需要人工核对',
          tenderEvidence: [
            { document: 'tender', nodeId: 'p-1', label: '要求', excerpt: '示例要求' }
          ],
          bidEvidence: [{ document: 'bid', nodeId: 'p-2', label: '响应', excerpt: '示例响应' }],
          suggestion: '请人工核对。',
          source: 'ai',
          status: 'open'
        }
      ]
    })
    expect(result.success).toBe(true)
    expect(
      AiReviewResponseSchema.safeParse({
        findings: [
          {
            id: 'b'.repeat(24),
            type: 'ai-suggestion',
            severity: 'error',
            confidence: 1,
            summary: 'bad',
            tenderEvidence: [],
            bidEvidence: [],
            suggestion: '',
            source: 'ai',
            status: 'open'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('sends a bounded JSON chat request and returns the content only', async () => {
    const content = '{"findings":[]}'
    const response = await requestChatCompletion(
      {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-key',
        model: 'test',
        timeoutMs: 1000,
        messages: [{ role: 'user', content: 'DATA' }]
      },
      async (_input, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-key')
        expect(String(init?.body)).toContain('DATA')
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200
        })
      }
    )
    expect(response).toBe(content)
  })

  it('rejects an oversized request message before network access', async () => {
    let called = false
    await expect(
      requestChatCompletion(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'secret-key',
          model: 'test',
          timeoutMs: 1000,
          messages: [{ role: 'user', content: 'x'.repeat(24_001) }]
        },
        async () => {
          called = true
          return new Response('{}', { status: 200 })
        }
      )
    ).rejects.toThrow()
    expect(called).toBe(false)
  })

  it('rejects an oversized aggregate request before network access', async () => {
    let called = false
    const messages = Array.from({ length: 32 }, (_, index) => ({
      role: 'user' as const,
      content: `${index}-${'中'.repeat(23_990)}`
    }))
    await expect(
      requestChatCompletion(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'secret-key',
          model: 'test',
          timeoutMs: 1000,
          messages
        },
        async () => {
          called = true
          return new Response('{}', { status: 200 })
        }
      )
    ).rejects.toThrow('ai-request-too-large')
    expect(called).toBe(false)
  })
})
