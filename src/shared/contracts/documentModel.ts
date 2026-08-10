import { z } from 'zod'

export const SourceAnchorSchema = z
  .object({
    nodeId: z.string().regex(/^[a-z0-9-]{1,200}$/u),
    kind: z.enum(['paragraph', 'heading', 'table', 'cell', 'header', 'footer', 'page']),
    label: z.string().trim().min(1).max(300),
    page: z.number().int().positive().optional(),
    bbox: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().nonnegative().finite(),
        height: z.number().nonnegative().finite()
      })
      .strict()
      .optional(),
    excerpt: z.string().max(1_000),
    digest: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()

export const DocumentNodeSchema = z
  .object({
    nodeId: z.string().regex(/^[a-z0-9-]{1,200}$/u),
    kind: z.enum(['paragraph', 'heading', 'table', 'cell', 'header', 'footer', 'page']),
    text: z.string().max(10_000),
    level: z.number().int().min(0).max(9).optional(),
    anchor: SourceAnchorSchema
  })
  .strict()

export const DocumentSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentType: z.enum(['docx', 'pdf']),
    displayName: z.string().trim().min(1).max(255),
    nodes: z.array(DocumentNodeSchema).max(100_000),
    textLength: z.number().int().nonnegative().max(5_000_000),
    hasTextLayer: z.boolean()
  })
  .strict()

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>
export type DocumentNode = z.infer<typeof DocumentNodeSchema>
export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>
