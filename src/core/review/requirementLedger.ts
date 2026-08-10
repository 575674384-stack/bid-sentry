import type { ReviewDocumentFacts } from './entities'

export interface RequirementLedger {
  projectName?: ReviewDocumentFacts['projectNames'][number]
  projectNumber?: ReviewDocumentFacts['projectNumbers'][number]
  sectionName?: ReviewDocumentFacts['sectionNames'][number]
  duration?: ReviewDocumentFacts['durations'][number]
  quality?: ReviewDocumentFacts['qualityTerms'][number]
}

export function buildRequirementLedger(facts: ReviewDocumentFacts): RequirementLedger {
  return {
    ...(facts.projectNames[0] ? { projectName: facts.projectNames[0] } : {}),
    ...(facts.projectNumbers[0] ? { projectNumber: facts.projectNumbers[0] } : {}),
    ...(facts.sectionNames[0] ? { sectionName: facts.sectionNames[0] } : {}),
    ...(facts.durations[0] ? { duration: facts.durations[0] } : {}),
    ...(facts.qualityTerms[0] ? { quality: facts.qualityTerms[0] } : {})
  }
}
