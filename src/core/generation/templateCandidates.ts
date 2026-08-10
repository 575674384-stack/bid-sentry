import { createHash } from 'node:crypto'
import type { DocumentSnapshot, TemplateCandidate } from '../../shared/contracts'

export function findTemplateCandidates(document: DocumentSnapshot): TemplateCandidate[] {
  const candidates: TemplateCandidate[] = []
  const starts = document.nodes.filter((node) =>
    /投标文件格式|资格审查|资格标|投标文件组成|附件格式|qualification\s+(?:review|template)|tender\s+(?:document\s+)?format/iu.test(
      node.text
    )
  )
  for (const start of starts) {
    const startIndex = document.nodes.findIndex((node) => node.nodeId === start.nodeId)
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
    // reconstruction.  When no explicit heading boundary exists, stop at the
    // detected template page instead of silently copying every later page.
    // DOCX keeps the heading-based section range and therefore preserves a
    // multi-page template section when Word supplies real outline levels.
    // A template range must have an explicit, structural boundary.  Extending
    // an unbounded heading to the end of the tender can disclose unrelated
    // qualification/material sections, so an ambiguous DOCX is rejected and
    // the user is asked to choose or fix the source template.
    if (document.documentType === 'docx' && !end) continue
    let rangeStart = startIndex
    let rangeEnd: number
    if (document.documentType === 'pdf') {
      const page = start.anchor.page
      if (page === undefined) continue
      rangeStart = document.nodes.findIndex((node) => node.anchor.page === page)
      rangeEnd = document.nodes.reduce(
        (last, node, index) => (node.anchor.page === page ? index : last),
        rangeStart
      )
    } else {
      rangeEnd = Math.max(
        startIndex,
        document.nodes.findIndex((node) => node.nodeId === end!.nodeId) - 1
      )
    }
    if (rangeStart < 0 || rangeEnd < rangeStart) continue
    const section = document.nodes.slice(rangeStart, rangeEnd + 1)
    const digest = createHash('sha256')
      .update(`${document.nodes[rangeStart]!.nodeId}|${section.at(-1)?.nodeId ?? start.nodeId}`)
      .digest('hex')
      .slice(0, 24)
    candidates.push({
      candidateId: digest,
      title: start.text.slice(0, 300),
      startNodeId: document.nodes[rangeStart]!.nodeId,
      endNodeId: section.at(-1)?.nodeId ?? start.nodeId,
      ...(document.nodes[rangeStart]!.anchor.page !== undefined
        ? { startPage: document.nodes[rangeStart]!.anchor.page }
        : {}),
      ...(section.at(-1)?.anchor.page !== undefined
        ? { endPage: section.at(-1)!.anchor.page }
        : {}),
      previewText: section
        .map((node) => node.text.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(' ｜ ')
        .slice(0, 1_000),
      sourceType: document.documentType === 'pdf' ? 'pdf-rebuilt' : 'docx-template',
      sectionOutline: section
        .filter((node) => node.kind === 'heading')
        .map((node) => node.text.slice(0, 200))
        .slice(0, 100),
      confidence: document.documentType === 'pdf' ? 0.72 : end ? 0.93 : 0.72,
      reasons: [
        '命中招标文件模板章节关键词',
        ...(document.documentType === 'pdf'
          ? ['仅保留命中的文本层页面，避免把未确认页面带入草稿']
          : ['检测到稳定章节边界'])
      ]
    })
  }
  return candidates.slice(0, 50)
}
