import { z } from 'zod'
import { ReviewFindingSchema } from './review'

export const AiChatMessageSchema = z
  .object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(24_000) })
  .strict()

export const AiReviewResponseSchema = z
  .object({ findings: z.array(ReviewFindingSchema).max(500) })
  .strict()

/**
 * Transport envelope for chat completions. Intentionally NON-strict: real
 * OpenAI-compatible providers always add metadata (id, object, created,
 * model, usage, index, finish_reason, role, …) and rejecting those keys
 * would break every real endpoint. Unknown keys are stripped instead.
 */
export const AiChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().max(2_000_000) }) }))
    .min(1)
    .max(10)
})

export type AiChatMessage = z.infer<typeof AiChatMessageSchema>
export type AiReviewResponse = z.infer<typeof AiReviewResponseSchema>
