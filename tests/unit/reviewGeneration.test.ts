import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { readDocumentSnapshot } from '../../src/core/documents/documentReader'
import { extractFacts } from '../../src/core/review/entities'
import { deterministicFindings } from '../../src/core/review/rules'
import { findTemplateCandidates } from '../../src/core/generation/templateCandidates'
import { createFillPlan } from '../../src/core/generation/fieldPlan'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

const dirs: string[] = []
afterEach(async () =>
  Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
)

describe('review and generation domain rules', () => {
  it('reports conflicting bidder names with evidence anchors', () => {
    const tender = extractFacts({
      schemaVersion: 1,
      documentType: 'docx',
      displayName: 'tender.docx',
      hasTextLayer: true,
      nodes: [
        {
          nodeId: 'p-0',
          kind: 'paragraph',
          text: '项目编号：ABC-01',
          anchor: {
            nodeId: 'p-0',
            kind: 'paragraph',
            label: '段落',
            excerpt: '项目编号：ABC-01',
            digest: 'a'.repeat(64)
          }
        }
      ],
      textLength: 14
    })
    const bid = extractFacts(
      {
        schemaVersion: 1,
        documentType: 'docx',
        displayName: 'bid.docx',
        hasTextLayer: true,
        nodes: [
          {
            nodeId: 'p-0',
            kind: 'paragraph',
            text: '投标人名称：甲公司\n投标单位名称：乙公司',
            anchor: {
              nodeId: 'p-0',
              kind: 'paragraph',
              label: '段落',
              excerpt: '投标人名称：甲公司',
              digest: 'b'.repeat(64)
            }
          }
        ],
        textLength: 22
      },
      '甲公司'
    )
    const findings = deterministicFindings(tender, bid, '甲公司')
    expect(findings).toContainEqual(
      expect.objectContaining({ type: 'multiple-bidder-names', severity: 'error' })
    )
    expect(findings[0]?.bidEvidence.length).toBeGreaterThan(0)
  })

  it('recognizes a template candidate and keeps user values in a traceable plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-'))
    dirs.push(directory)
    const inputPath = join(directory, 'template.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const snapshot = await readDocumentSnapshot(inputPath, 'docx')
    const candidates = findTemplateCandidates(snapshot)
    expect(candidates.length).toBeGreaterThan(0)
    const plan = createFillPlan(
      snapshot,
      candidates[0]!,
      {
        bidderName: '示例公司',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: ''
      },
      input.sha256
    )
    expect(plan.inputSha256).toBe(input.sha256)
    expect(
      plan.actions.every((action) => action.source !== 'tender-fixed' || action.evidenceNodeId)
    ).toBe(true)
    expect((await stat(inputPath)).size).toBe(input.size)
    expect((await readFile(inputPath)).byteLength).toBe(input.size)
  })
})
