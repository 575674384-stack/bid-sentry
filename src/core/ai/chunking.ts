import type { DocumentSnapshot } from '../../shared/contracts'

export const MAX_REVIEW_CHUNK_CHARS = 8_000
export const MAX_REVIEW_REQUESTS = 64

export interface ReviewDocumentChunk {
  index: number
  nodes: Array<{ nodeId: string; text: string }>
  textLength: number
}

export interface ReviewAiChunk {
  index: number
  tender: ReviewDocumentChunk
  bid: ReviewDocumentChunk
}

/**
 * Split both documents at node boundaries so every AI request carries only
 * the anchors that the model is allowed to cite. A node larger than the
 * budget is clipped at a deterministic boundary; it remains review-only and
 * can never be treated as complete evidence unless the excerpt is present in
 * the original node during grounding validation.
 */
export function buildReviewAiChunks(
  tender: DocumentSnapshot,
  bid: DocumentSnapshot,
  maxChars = MAX_REVIEW_CHUNK_CHARS
): ReviewAiChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1_000 || maxChars > 24_000) {
    throw new Error('ai-chunk-budget-invalid')
  }
  const tenderChunks = chunkDocument(tender, maxChars)
  const bidChunks = chunkDocument(bid, maxChars)
  const count = Math.max(tenderChunks.length, bidChunks.length)
  if (count === 0) return []
  if (count > MAX_REVIEW_REQUESTS) throw new Error('ai-request-budget-exceeded')
  const empty = (index: number): ReviewDocumentChunk => ({ index, nodes: [], textLength: 0 })
  return Array.from({ length: count }, (_, index) => ({
    index,
    tender: tenderChunks[index] ?? empty(index),
    bid: bidChunks[index] ?? empty(index)
  }))
}

function chunkDocument(document: DocumentSnapshot, maxChars: number): ReviewDocumentChunk[] {
  const chunks: ReviewDocumentChunk[] = []
  let current: ReviewDocumentChunk = { index: 0, nodes: [], textLength: 0 }
  for (const node of document.nodes) {
    if (!node.text) continue
    let offset = 0
    do {
      const available = maxChars - current.textLength - node.nodeId.length - 2
      if (current.nodes.length > 0 && available <= 0) {
        chunks.push(current)
        current = { index: chunks.length, nodes: [], textLength: 0 }
        continue
      }
      const text = node.text.slice(offset, offset + Math.max(1, available))
      current.nodes.push({ nodeId: node.nodeId, text })
      current.textLength += text.length + node.nodeId.length + 2
      offset += text.length
      if (offset < node.text.length) {
        chunks.push(current)
        current = { index: chunks.length, nodes: [], textLength: 0 }
      }
    } while (offset < node.text.length)
  }
  if (current.nodes.length > 0) chunks.push(current)
  return chunks
}
