import { z } from 'zod'
import { ReviewFindingSchema } from './review'

export const AiChatMessageSchema = z
  .object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(24_000) })
  .strict()

export const AiReviewResponseSchema = z
  .object({ findings: z.array(ReviewFindingSchema).max(500) })
  .strict()

export const AiChatCompletionSchema = z
  .object({
    choices: z
      .array(
        z.object({ message: z.object({ content: z.string().max(2_000_000) }).strict() }).strict()
      )
      .min(1)
      .max(10)
  })
  .strict()

export type AiChatMessage = z.infer<typeof AiChatMessageSchema>
export type AiReviewResponse = z.infer<typeof AiReviewResponseSchema>
