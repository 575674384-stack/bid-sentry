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
    findings.push(
      finding(
        'multiple-bidder-names',
        'error',
        `投标文件中发现多个投标单位名称：${bidNames.join('、')}`,
        anchors(tender, tender.document.nodes[0]?.nodeId, '招标文件'),
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
  compareFixed(findings, '工期/服务期/交货期', tenderLedger.duration, bidLedger.duration)
  compareFixed(findings, '质量标准', tenderLedger.quality, bidLedger.quality)
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
    | ReviewDocumentFacts['durations'][number]
    | ReviewDocumentFacts['qualityTerms'][number]
    | undefined,
  bid:
    | ReviewDocumentFacts['durations'][number]
    | ReviewDocumentFacts['qualityTerms'][number]
    | undefined
): void {
  if (!tender || !bid || tender.normalized === bid.normalized) return
  findings.push(
    finding(
      'fixed-parameter-mismatch',
      'error',
      `${label}不一致：招标文件为“${tender.value}”，投标文件为“${bid.value}”。`,
      [anchor('tender', tender.nodeId, label, tender.excerpt)],
      [anchor('bid', bid.nodeId, label, bid.excerpt)],
      '请确认是否满足招标文件的固定参数。'
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
  return { document, nodeId: nodeId ?? 'p-0', label, excerpt: excerpt.slice(0, 1_000) }
}

function anchors(
  tender: ReviewDocumentFacts,
  nodeId: string | undefined,
  label: string
): ReviewAnchor[] {
  return [
    anchor(
      'tender',
      nodeId,
      label,
      tender.document.nodes.find((node) => node.nodeId === nodeId)?.text ?? '招标文件'
    )
  ]
}

function unique(values: string[]): string[] {
  return [...new Map(values.map((value) => [normalize(value), value])).values()]
}

function dedupe(findings: ReviewFinding[]): ReviewFinding[] {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()]
}
