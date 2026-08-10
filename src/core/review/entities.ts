import type { DocumentSnapshot } from '../../shared/contracts'

export interface ReviewEntity {
  value: string
  normalized: string
  nodeId: string
  excerpt: string
}

export interface ReviewDocumentFacts {
  document: DocumentSnapshot
  text: string
  bidderNames: ReviewEntity[]
  projectNumbers: ReviewEntity[]
  durations: ReviewEntity[]
  qualityTerms: ReviewEntity[]
}

export function extractFacts(
  document: DocumentSnapshot,
  preferredBidder?: string
): ReviewDocumentFacts {
  const text = document.nodes.map((node) => node.text).join('\n')
  const bidderNames = extract(
    text,
    document,
    /(?:投标人|投标单位|供应商|申请人)\s*(?:名称|：|:)\s*([^\n,，;；]+)/giu
  )
  if (
    preferredBidder &&
    !bidderNames.some((entity) => normalize(entity.value) === normalize(preferredBidder))
  ) {
    bidderNames.unshift({
      value: preferredBidder,
      normalized: normalize(preferredBidder),
      nodeId: document.nodes[0]?.nodeId ?? 'p-0',
      excerpt: document.nodes[0]?.text.slice(0, 300) ?? preferredBidder
    })
  }
  const projectNumbers = extract(
    text,
    document,
    /(?:项目编号|招标编号|标段编号|项目代码)\s*(?:为|：|:)\s*([A-Za-z0-9\-_/]+)/giu
  )
  const durations = extract(
    text,
    document,
    /(?:工期|服务期|交货期|合同期限)\s*(?:为|：|:)\s*([^\n,，;；]+)/giu
  )
  const qualityTerms = extract(
    text,
    document,
    /(?:质量标准|质量要求|验收标准)\s*(?:为|：|:)\s*([^\n,，;；]+)/giu
  )
  return { document, text, bidderNames, projectNumbers, durations, qualityTerms }
}

function extract(text: string, document: DocumentSnapshot, pattern: RegExp): ReviewEntity[] {
  const result: ReviewEntity[] = []
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.trim()
    if (!value) continue
    const node =
      document.nodes.find((candidate) => candidate.text.includes(value)) ?? document.nodes[0]
    if (!node) continue
    result.push({
      value,
      normalized: normalize(value),
      nodeId: node.nodeId,
      excerpt: node.text.slice(0, 300)
    })
  }
  return result
}

export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[（(]/gu, '(')
    .replace(/[）)]/gu, ')')
    .toLocaleLowerCase()
}
