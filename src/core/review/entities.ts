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
  projectNames: ReviewEntity[]
  projectNumbers: ReviewEntity[]
  sectionNames: ReviewEntity[]
  durations: ReviewEntity[]
  qualityTerms: ReviewEntity[]
  roleMentions: ReviewEntity[]
}

export function extractFacts(document: DocumentSnapshot): ReviewDocumentFacts {
  const text = document.nodes.map((node) => node.text).join('\n')
  const bidderNames = extract(
    text,
    document,
    /(?:投标人|投标单位|供应商|申请人)\s*(?:名称\s*)?(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  const projectNames = extract(
    text,
    document,
    /(?:项目名称|工程名称|采购项目)\s*(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  // The user-confirmed bidder name is a rule baseline, not document evidence.
  // Never manufacture a node anchor for it; only source text can become an
  // evidence anchor shown in a report or sent to the AI grounding validator.
  const projectNumbers = extract(
    text,
    document,
    /(?:项目编号|招标编号|标段编号|项目代码)\s*(?:为\s*|[：:])\s*([A-Za-z0-9\-_/]+)/giu
  )
  const sectionNames = extract(
    text,
    document,
    /(?:标段名称|标段)\s*(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  const durations = extract(
    text,
    document,
    /(?:工期|服务期|交货期|合同期限)\s*(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  const qualityTerms = extract(
    text,
    document,
    /(?:质量标准|质量要求|验收标准)\s*(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  const roleMentions = extract(
    text,
    document,
    /(?:招标人|招标单位|采购人)\s*(?:为\s*|[：:])\s*([^\n,，;；]+)/giu
  )
  return {
    document,
    text,
    bidderNames,
    projectNames,
    projectNumbers,
    sectionNames,
    durations,
    qualityTerms,
    roleMentions
  }
}

function extract(text: string, document: DocumentSnapshot, pattern: RegExp): ReviewEntity[] {
  const result: ReviewEntity[] = []
  const ranges: Array<{ node: DocumentSnapshot['nodes'][number]; start: number; end: number }> = []
  let offset = 0
  for (const node of document.nodes) {
    ranges.push({ node, start: offset, end: offset + node.text.length })
    offset += node.text.length + 1
  }
  for (const match of text.matchAll(pattern)) {
    const rawValue = match[1]
    const value = rawValue?.trim()
    if (!value || match.index === undefined || rawValue === undefined) continue
    const rawOffset = match[0].indexOf(rawValue)
    if (rawOffset < 0) continue
    const leadingWhitespace = rawValue.search(/\S/u)
    if (leadingWhitespace < 0) continue
    const valueStart = match.index + rawOffset + leadingWhitespace
    const range = ranges.find(
      ({ start, end }) => valueStart >= start && valueStart + value.length <= end
    )
    // A value that cannot be located in its concrete source node is not usable
    // evidence.  Global offsets prevent repeated values from anchoring to the
    // first unrelated node that happens to contain the same text.
    if (!range) continue
    const node = range.node
    const valueIndex = valueStart - range.start
    if (node.text.slice(valueIndex, valueIndex + value.length) !== value) continue
    const excerptStart = Math.max(0, valueIndex - 120)
    const excerpt = node.text.slice(excerptStart, excerptStart + 300)
    result.push({
      value,
      normalized: normalize(value),
      nodeId: node.nodeId,
      excerpt
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
