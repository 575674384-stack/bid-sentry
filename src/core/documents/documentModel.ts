import { createHash } from 'node:crypto'
import {
  DocumentSnapshotSchema,
  type DocumentNode,
  type DocumentSnapshot
} from '../../shared/contracts'

export function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function makeNode(
  kind: DocumentNode['kind'],
  nodeId: string,
  text: string,
  label: string,
  options: {
    level?: number
    page?: number
    bbox?: { x: number; y: number; width: number; height: number }
  } = {}
): DocumentNode {
  const excerpt = text.trim().slice(0, 1_000)
  return {
    nodeId,
    kind,
    text: text.slice(0, 10_000),
    anchor: {
      nodeId,
      kind,
      label,
      excerpt,
      digest: digestText(text),
      ...(options.page !== undefined ? { page: options.page } : {}),
      ...(options.bbox !== undefined ? { bbox: options.bbox } : {})
    },
    ...(options.level !== undefined ? { level: options.level } : {})
  }
}

export function snapshot(
  input: Omit<DocumentSnapshot, 'schemaVersion' | 'textLength'>
): DocumentSnapshot {
  return DocumentSnapshotSchema.parse({
    schemaVersion: 1,
    ...input,
    textLength: input.nodes.reduce((total, node) => total + node.text.length, 0)
  })
}
