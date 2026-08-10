import type { ReviewDocumentFacts } from './entities'

export interface RequirementLedger {
  projectNumber?: ReviewDocumentFacts['projectNumbers'][number]
  duration?: ReviewDocumentFacts['durations'][number]
  quality?: ReviewDocumentFacts['qualityTerms'][number]
}

export function buildRequirementLedger(facts: ReviewDocumentFacts): RequirementLedger {
  return {
    ...(facts.projectNumbers[0] ? { projectNumber: facts.projectNumbers[0] } : {}),
    ...(facts.durations[0] ? { duration: facts.durations[0] } : {}),
    ...(facts.qualityTerms[0] ? { quality: facts.qualityTerms[0] } : {})
  }
}
