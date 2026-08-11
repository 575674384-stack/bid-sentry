import { createHash } from 'node:crypto'
import type { DocumentSnapshot, DocumentNode, TemplateCandidate } from '../../shared/contracts'
import { countFillableSlots } from './fieldPlan'

const TEMPLATE_TITLE_PATTERN =
  /投标文件格式|招标投标[^，。；\n]{0,12}文件格式|资格(?:预|送|后)?审|资格标|投标文件组成|附件格式|qualification\s+(?:review|template)|tender\s+(?:document\s+)?format/iu

/**
 * Find user-confirmable qualification template sections. DOCX candidates are
 * anchored on heading nodes only — keyword hits inside body content or table
 * cells never define a range. Every hit yields a tight candidate (up to the
 * next same-or-higher heading); when no such boundary exists or the tight
 * range is empty, a loose candidate extending to the document end is offered
 * instead, always labelled so the user reviews the extra coverage.
 */
export function findTemplateCandidates(document: DocumentSnapshot): TemplateCandidate[] {
  const candidates: TemplateCandidate[] = []
  const seenRanges = new Set<string>()
  const bodyNodes = document.nodes.filter(
    (node) => node.kind !== 'header' && node.kind !== 'footer'
  )
  // DOCX ranges only start at headings — body/cell keyword hits never define a
  // structural range. PDF has no reliable outline, so any text-layer node may
  // start a single-page candidate (the page boundary keeps it contained).
  const starts = document.nodes.filter(
    (node) =>
      (document.documentType === 'pdf' || node.kind === 'heading') &&
      TEMPLATE_TITLE_PATTERN.test(node.text)
  )
  for (const start of starts) {
    const startIndex = document.nodes.findIndex((node) => node.nodeId === start.nodeId)
    if (startIndex < 0) continue
    const end = document.nodes
      .slice(startIndex + 1)
      .find(
        (node) =>
          node.kind === 'heading' &&
          node.level !== undefined &&
          start.level !== undefined &&
          node.level <= start.level
      )
    // A PDF page is the strongest stable anchor available without OCR/layout
    // reconstruction, so PDF candidates always stay within the hit page.
    if (document.documentType === 'pdf') {
      const page = start.anchor.page
      if (page === undefined) continue
      const rangeStart = document.nodes.findIndex((node) => node.anchor.page === page)
      const rangeEnd = document.nodes.reduce(
        (last, node, index) => (node.anchor.page === page ? index : last),
        rangeStart
      )
      pushCandidate(document, candidates, seenRanges, start, rangeStart, rangeEnd, 'tight')
      continue
    }
    const tightEnd = end
      ? Math.max(startIndex, document.nodes.findIndex((node) => node.nodeId === end.nodeId) - 1)
      : -1
    const tightNonEmpty =
      tightEnd >= startIndex ? countNonEmpty(document.nodes.slice(startIndex, tightEnd + 1)) : 0
    // A tight range of one or two nodes is just the section divider page, not
    // the template set — offer the loose remainder-of-document range instead
    // so the user can pick the useful one.
    if (end && tightNonEmpty > 2) {
      pushCandidate(document, candidates, seenRanges, start, startIndex, tightEnd, 'tight')
      continue
    }
    // No reliable structural boundary (or a near-empty tight range): offer the
    // remainder of the document as an explicitly-labelled loose candidate.
    const looseEnd = lastBodyNodeIndex(document, bodyNodes)
    if (
      looseEnd > startIndex &&
      countNonEmpty(document.nodes.slice(startIndex, looseEnd + 1)) >= 2
    ) {
      pushCandidate(document, candidates, seenRanges, start, startIndex, looseEnd, 'loose')
    }
  }
  return rankAndPruneCandidates(document, candidates).slice(0, 50)
}

/**
 * Rank candidates by how much they can actually fill, and drop fragment
 * candidates that are fully contained in a strictly richer one — a cover-page
 * range with zero slots next to a full template-set range is a trap, not a
 * choice. The user still makes the final selection explicitly.
 */
function rankAndPruneCandidates(
  document: DocumentSnapshot,
  candidates: TemplateCandidate[]
): TemplateCandidate[] {
  const indexed = candidates.map((candidate) => ({
    candidate,
    start: document.nodes.findIndex((node) => node.nodeId === candidate.startNodeId),
    end: document.nodes.findIndex((node) => node.nodeId === candidate.endNodeId),
    slots: countFillableSlots(document, candidate)
  }))
  const kept = indexed.filter((entry) => {
    if (entry.start < 0 || entry.end < entry.start) return false
    return !indexed.some(
      (other) =>
        other !== entry &&
        other.start >= 0 &&
        other.start <= entry.start &&
        other.end >= entry.end &&
        other.slots > entry.slots
    )
  })
  return kept
    .sort((left, right) => right.slots - left.slots || left.start - right.start)
    .map((entry) => ({ ...entry.candidate, fillableSlots: entry.slots }))
}

function pushCandidate(
  document: DocumentSnapshot,
  candidates: TemplateCandidate[],
  seenRanges: Set<string>,
  start: DocumentNode,
  rangeStart: number,
  rangeEnd: number,
  rangeKind: 'tight' | 'loose'
): void {
  if (rangeStart < 0 || rangeEnd < rangeStart) return
  const firstNode = document.nodes[rangeStart]
  const lastNode = document.nodes[rangeEnd]
  if (!firstNode || !lastNode) return
  const rangeKey = `${firstNode.nodeId}→${lastNode.nodeId}`
  if (seenRanges.has(rangeKey)) return
  seenRanges.add(rangeKey)
  const section = document.nodes.slice(rangeStart, rangeEnd + 1)
  const digest = createHash('sha256')
    .update(`${firstNode.nodeId}|${lastNode.nodeId}`)
    .digest('hex')
    .slice(0, 24)
  candidates.push({
    candidateId: digest,
    title: start.text.trim().slice(0, 300),
    startNodeId: firstNode.nodeId,
    endNodeId: lastNode.nodeId,
    ...(firstNode.anchor.page !== undefined ? { startPage: firstNode.anchor.page } : {}),
    ...(lastNode.anchor.page !== undefined ? { endPage: lastNode.anchor.page } : {}),
    previewText: section
      .map((node) => node.text.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' ｜ ')
      .slice(0, 1_000),
    sourceType: document.documentType === 'pdf' ? 'pdf-rebuilt' : 'docx-template',
    sectionOutline: section
      .filter((node) => node.kind === 'heading')
      .map((node) => node.text.trim().slice(0, 200))
      .filter((text) => text.length > 0)
      .slice(0, 100),
    confidence: document.documentType === 'pdf' ? 0.72 : rangeKind === 'tight' ? 0.93 : 0.66,
    reasons: [
      '命中招标文件模板章节关键词',
      ...(document.documentType === 'pdf'
        ? ['仅保留命中的文本层页面，避免把未确认页面带入草稿']
        : rangeKind === 'tight'
          ? ['检测到稳定章节边界']
          : ['章节边界不明确，范围延伸至文档末尾，请人工核对预览内容'])
    ]
  })
}

function countNonEmpty(nodes: readonly DocumentNode[]): number {
  return nodes.filter((node) => node.text.trim().length > 0).length
}

function lastBodyNodeIndex(document: DocumentSnapshot, bodyNodes: readonly DocumentNode[]): number {
  const last = bodyNodes.at(-1)
  if (!last) return -1
  return document.nodes.findIndex((node) => node.nodeId === last.nodeId)
}
