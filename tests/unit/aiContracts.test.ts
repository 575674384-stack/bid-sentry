import { describe, expect, it } from 'vitest'
import { AiReviewResponseSchema } from '../../src/shared/contracts'
import { requestChatCompletion } from '../../src/main/ai/chatCompletionsClient'

describe('AI grounding contracts', () => {
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
})
