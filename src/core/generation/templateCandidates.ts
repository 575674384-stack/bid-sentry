import { createHash } from 'node:crypto'
import type { DocumentSnapshot, TemplateCandidate } from '../../shared/contracts'

export function findTemplateCandidates(document: DocumentSnapshot): TemplateCandidate[] {
  const candidates: TemplateCandidate[] = []
  const starts = document.nodes.filter((node) =>
    /投标文件格式|资格审查|资格标|投标文件组成|附件格式/iu.test(node.text)
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
    const endIndex = end
      ? document.nodes.findIndex((node) => node.nodeId === end.nodeId)
      : document.nodes.length - 1
    const section = document.nodes.slice(startIndex, endIndex + 1)
    const digest = createHash('sha256')
      .update(`${start.nodeId}|${end?.nodeId ?? section.at(-1)?.nodeId ?? start.nodeId}`)
      .digest('hex')
      .slice(0, 24)
    candidates.push({
      candidateId: digest,
      title: start.text.slice(0, 300),
      startNodeId: start.nodeId,
      endNodeId: end?.nodeId ?? section.at(-1)?.nodeId ?? start.nodeId,
      sourceType: document.documentType === 'pdf' ? 'pdf-rebuilt' : 'docx-template',
      sectionOutline: section
        .filter((node) => node.kind === 'heading')
        .map((node) => node.text.slice(0, 200))
        .slice(0, 100),
      confidence: end ? 0.93 : 0.72,
      reasons: [
        '命中招标文件模板章节关键词',
        ...(end ? ['检测到稳定章节边界'] : ['未检测到下一个同级标题，边界延伸至文档末尾'])
      ]
    })
  }
  if (!candidates.length) {
    const first = document.nodes[0]
    const last = document.nodes.at(-1)
    if (first && last) {
      candidates.push({
        candidateId: createHash('sha256')
          .update(`${first.nodeId}|${last.nodeId}`)
          .digest('hex')
          .slice(0, 24),
        title: '整份文档（未检测到明确模板章节）',
        startNodeId: first.nodeId,
        endNodeId: last.nodeId,
        sourceType: document.documentType === 'pdf' ? 'pdf-rebuilt' : 'docx-template',
        sectionOutline: [],
        confidence: 0.35,
        reasons: ['未命中标准模板关键词，必须由用户确认范围']
      })
    }
  }
  return candidates.slice(0, 50)
}
