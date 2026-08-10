import { createHash } from 'node:crypto'
import type { ReviewAnchor, ReviewFinding } from '../../shared/contracts'
import { normalize, type ReviewDocumentFacts } from './entities'
import { buildRequirementLedger } from './requirementLedger'

export function deterministicFindings(
  tender: ReviewDocumentFacts,
  bid: ReviewDocumentFacts,
  bidderName: string
): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  const bidNames = unique([...bid.bidderNames.map((entity) => entity.value), bidderName])
  if (bidNames.length > 1) {
    const tenderEvidence = tender.bidderNames[0]
      ? [
          anchor(
            'tender',
            tender.bidderNames[0].nodeId,
            '招标文件主体',
            tender.bidderNames[0].excerpt
          )
        ]
      : []
    findings.push(
      finding(
        'multiple-bidder-names',
        tenderEvidence.length ? 'error' : 'needs-review',
        `投标文件中发现多个投标单位名称：${bidNames.join('、')}`,
        tenderEvidence,
        bid.bidderNames.map((entity) => anchor('bid', entity.nodeId, entity.value, entity.excerpt)),
        '请确认投标主体并统一替换。'
      )
    )
  }
  const tenderLedger = buildRequirementLedger(tender)
  const bidLedger = buildRequirementLedger(bid)
  if (
    tenderLedger.projectNumber &&
    bidLedger.projectNumber &&
    tenderLedger.projectNumber.normalized !== bidLedger.projectNumber.normalized
  ) {
    findings.push(
      finding(
        'project-mismatch',
        'error',
        `项目编号不一致：招标文件为“${tenderLedger.projectNumber.value}”，投标文件为“${bidLedger.projectNumber.value}”。`,
        [
          anchor(
            'tender',
            tenderLedger.projectNumber.nodeId,
            '项目编号',
            tenderLedger.projectNumber.value
          )
        ],
        [anchor('bid', bidLedger.projectNumber.nodeId, '项目编号', bidLedger.projectNumber.value)],
        '请以招标文件要求为准核对项目编号。'
      )
    )
  }
  compareFixed(
    findings,
    '项目名称',
    tenderLedger.projectName,
    bidLedger.projectName,
    'project-mismatch'
  )
  compareFixed(
    findings,
    '标段名称',
    tenderLedger.sectionName,
    bidLedger.sectionName,
    'project-mismatch'
  )
  compareFixed(findings, '工期/服务期/交货期', tenderLedger.duration, bidLedger.duration)
  compareFixed(findings, '质量标准', tenderLedger.quality, bidLedger.quality)
  if (bid.roleMentions.length > 0) {
    findings.push(
      finding(
        'role-confusion',
        'warning',
        '投标文件中仍出现“招标人/采购人”主体字段，可能发生招投标角色混淆。',
        tender.roleMentions[0]
          ? [
              anchor(
                'tender',
                tender.roleMentions[0].nodeId,
                '招标人主体',
                tender.roleMentions[0].excerpt
              )
            ]
          : [],
        bid.roleMentions
          .slice(0, 5)
          .map((entity) => anchor('bid', entity.nodeId, '疑似招标人字段', entity.excerpt)),
        '请确认投标文件中的主体称谓和盖章对象。'
      )
    )
  }
  addInternalConflicts(findings, '项目编号', bid.projectNumbers)
  addInternalConflicts(findings, '项目名称', bid.projectNames)
  addInternalConflicts(findings, '标段名称', bid.sectionNames)
  addInternalConflicts(findings, '工期/服务期/交货期', bid.durations)
  addInternalConflicts(findings, '质量标准', bid.qualityTerms)
  for (const node of bid.document.nodes) {
    if (!/(?:____+|待填写|请填写|\[\[.+?\]\]|示例(?:文本|单位|公司)?)/u.test(node.text)) continue
    findings.push(
      finding(
        'template-placeholder',
        'warning',
        `投标文件仍包含未替换的空白或示例内容：“${node.text.slice(0, 120)}”。`,
        [],
        [anchor('bid', node.nodeId, '未替换占位内容', node.text)],
        '请在提交前补齐或删除模板占位内容。'
      )
    )
  }
  const tenderRequired = tender.document.nodes.filter((node) =>
    /资格|投标函|报价|承诺/iu.test(node.text)
  )
  const missing = tenderRequired.filter(
    (node) =>
      !bid.document.nodes.some((candidate) =>
        normalize(candidate.text).includes(normalize(node.text).slice(0, 18))
      )
  )
  for (const node of missing.slice(0, 20)) {
    findings.push(
      finding(
        'missing-response',
        'warning',
        `投标文件可能缺少对应章节：“${node.text.slice(0, 120)}”。`,
        [anchor('tender', node.nodeId, '招标要求', node.text)],
        [],
        '请人工确认投标文件是否已响应。'
      )
    )
  }
  return dedupe(findings)
}

function compareFixed(
  findings: ReviewFinding[],
  label: string,
  tender:
    | ReviewDocumentFacts['projectNames'][number]
    | ReviewDocumentFacts['projectNumbers'][number]
    | ReviewDocumentFacts['sectionNames'][number]
    | ReviewDocumentFacts['durations'][number]
    | ReviewDocumentFacts['qualityTerms'][number]
    | undefined,
  bid:
    | ReviewDocumentFacts['projectNames'][number]
    | ReviewDocumentFacts['projectNumbers'][number]
    | ReviewDocumentFacts['sectionNames'][number]
    | ReviewDocumentFacts['durations'][number]
    | ReviewDocumentFacts['qualityTerms'][number]
    | undefined,
  type: ReviewFinding['type'] = 'fixed-parameter-mismatch'
): void {
  if (!tender || !bid || tender.normalized === bid.normalized) return
  findings.push(
    finding(
      type,
      'error',
      `${label}不一致：招标文件为“${tender.value}”，投标文件为“${bid.value}”。`,
      [anchor('tender', tender.nodeId, label, tender.excerpt)],
      [anchor('bid', bid.nodeId, label, bid.excerpt)],
      '请确认是否满足招标文件的固定参数。'
    )
  )
}

function addInternalConflicts(
  findings: ReviewFinding[],
  label: string,
  entities: readonly ReviewDocumentFacts['durations'][number][]
): void {
  const uniqueEntities = [
    ...new Map(entities.map((entity) => [entity.normalized, entity])).values()
  ]
  if (uniqueEntities.length < 2) return
  findings.push(
    finding(
      'internal-conflict',
      'needs-review',
      `投标文件内部的${label}出现多个不同值：${uniqueEntities.map((entity) => entity.value).join('、')}。`,
      [],
      uniqueEntities
        .slice(0, 5)
        .map((entity) => anchor('bid', entity.nodeId, label, entity.excerpt)),
      '请人工确认投标文件内部应采用的唯一值。'
    )
  )
}

function finding(
  type: ReviewFinding['type'],
  severity: ReviewFinding['severity'],
  summary: string,
  tenderEvidence: ReviewAnchor[],
  bidEvidence: ReviewAnchor[],
  suggestion: string
): ReviewFinding {
  const id = createHash('sha256')
    .update(`${type}|${summary}|${JSON.stringify(tenderEvidence)}|${JSON.stringify(bidEvidence)}`)
    .digest('hex')
    .slice(0, 24)
  return {
    id,
    type,
    severity,
    confidence: severity === 'error' ? 0.98 : 0.82,
    summary: summary.slice(0, 500),
    tenderEvidence,
    bidEvidence,
    suggestion,
    source: 'deterministic',
    status: 'open'
  }
}

function anchor(
  document: 'tender' | 'bid',
  nodeId: string | undefined,
  label: string,
  excerpt: string
): ReviewAnchor {
  // Readers only emit anchors for concrete nodes. Reject malformed hand-built
  // snapshots instead of inventing a node id and presenting unrelated text as
  // document evidence.
  if (!nodeId) throw new Error('review-anchor-node-missing')
  return { document, nodeId, label, excerpt: excerpt.slice(0, 1_000) }
}

function unique(values: string[]): string[] {
  return [...new Map(values.map((value) => [normalize(value), value])).values()]
}

function dedupe(findings: ReviewFinding[]): ReviewFinding[] {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()]
}
