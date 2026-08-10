import { createHash } from 'node:crypto'
import type { DocumentSnapshot, SuggestedField, TemplateCandidate } from '../../shared/contracts'
import { extractFacts, normalize, type ReviewEntity } from '../review/entities'
import { detectTemplateSlots } from './fieldPlan'

/**
 * Deterministic analysis used when no AI endpoint is configured or the AI
 * extraction failed. It only shapes which questions the user is asked and
 * summarizes tender facts; every filled value still comes from the confirmed
 * form or tender evidence in the fill plan.
 */
export interface LocalGenerationExtraction {
  qualificationSummary: string[]
  suggestedFields: SuggestedField[]
}

const MAX_SUMMARY_ENTRIES = 12
const MAX_SUMMARY_ENTRY_CHARS = 300
const MAX_SUGGESTED_FIELDS = 30

export function buildLocalGenerationExtraction(
  document: DocumentSnapshot,
  candidates: readonly TemplateCandidate[]
): LocalGenerationExtraction {
  const facts = extractFacts(document)
  const qualificationSummary: string[] = []
  const appendFacts = (kind: string, entities: readonly ReviewEntity[]): void => {
    const seenValues = new Set<string>()
    for (const entity of entities) {
      if (qualificationSummary.length >= MAX_SUMMARY_ENTRIES) return
      if (seenValues.has(entity.normalized)) continue
      seenValues.add(entity.normalized)
      const excerpt = entity.excerpt.replace(/\s+/gu, ' ').trim()
      qualificationSummary.push(
        `${kind}：${entity.value}（摘自：${excerpt}）`.slice(0, MAX_SUMMARY_ENTRY_CHARS)
      )
    }
  }
  appendFacts('项目名称', facts.projectNames)
  appendFacts('项目编号', facts.projectNumbers)
  appendFacts('标段', facts.sectionNames)
  appendFacts('工期/服务期', facts.durations)
  appendFacts('质量标准', facts.qualityTerms)
  appendFacts('招标人', facts.roleMentions)

  const labels: string[] = []
  const seenLabels = new Set<string>()
  for (const candidate of candidates) {
    for (const label of detectTemplateSlots(document, candidate)) {
      const key = normalize(label)
      if (!key || seenLabels.has(key)) continue
      seenLabels.add(key)
      labels.push(label)
      if (labels.length >= MAX_SUGGESTED_FIELDS) break
    }
    if (labels.length >= MAX_SUGGESTED_FIELDS) break
  }
  const suggestedFields: SuggestedField[] = labels.map((label) => ({
    key: `slot-${createHash('sha256').update(label).digest('hex').slice(0, 12)}`,
    label: label.slice(0, 100),
    required: false
  }))
  return { qualificationSummary, suggestedFields }
}
