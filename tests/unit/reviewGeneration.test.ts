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
import { applyFieldAction } from '../../src/core/generation/docx'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

const dirs: string[] = []
afterEach(async () =>
  Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
)

describe('review and generation domain rules', () => {
  it('anchors extracted values inside the concrete source excerpt', () => {
    const text = `${'前置内容 '.repeat(80)}投标人名称：甲公司`
    const facts = extractFacts({
      schemaVersion: 1,
      documentType: 'docx',
      displayName: 'bid.docx',
      hasTextLayer: true,
      nodes: [
        {
          nodeId: 'p-0',
          kind: 'paragraph',
          text,
          anchor: {
            nodeId: 'p-0',
            kind: 'paragraph',
            label: '段落',
            excerpt: text.slice(0, 1_000),
            digest: 'a'.repeat(64)
          }
        }
      ],
      textLength: text.length
    })
    expect(facts.bidderNames[0]?.excerpt).toContain('甲公司')
  })

  it('anchors repeated values to the matched node occurrence', () => {
    const facts = extractFacts({
      schemaVersion: 1,
      documentType: 'docx',
      displayName: 'bid.docx',
      hasTextLayer: true,
      nodes: [
        {
          nodeId: 'p-0',
          kind: 'paragraph',
          text: '说明：甲公司曾参与类似项目。',
          anchor: {
            nodeId: 'p-0',
            kind: 'paragraph',
            label: '段落',
            excerpt: '说明：甲公司曾参与类似项目。',
            digest: 'a'.repeat(64)
          }
        },
        {
          nodeId: 'p-1',
          kind: 'paragraph',
          text: '投标人名称：甲公司',
          anchor: {
            nodeId: 'p-1',
            kind: 'paragraph',
            label: '段落',
            excerpt: '投标人名称：甲公司',
            digest: 'b'.repeat(64)
          }
        }
      ],
      textLength: 35
    })
    expect(facts.bidderNames[0]?.nodeId).toBe('p-1')
  })

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
    const bid = extractFacts({
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
    })
    const findings = deterministicFindings(tender, bid, '甲公司')
    expect(findings).toContainEqual(
      expect.objectContaining({ type: 'multiple-bidder-names', severity: 'needs-review' })
    )
    expect(findings[0]?.bidEvidence.length).toBeGreaterThan(0)
  })

  it('recognizes a template candidate and keeps user values in a traceable plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-'))
    dirs.push(directory)
    const inputPath = join(directory, 'template.docx')
    await writeDocxFixture(inputPath, { qualificationTemplate: true })
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
        compilationDate: '',
        extraFields: []
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

  it('does not place a form value into a merely similar generic node', () => {
    const snapshot = {
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: 'template.docx',
      hasTextLayer: true,
      nodes: [
        {
          nodeId: 'p-0',
          kind: 'paragraph' as const,
          text: '投标人名称：________________',
          anchor: {
            nodeId: 'p-0',
            kind: 'paragraph' as const,
            label: '段落',
            excerpt: '投标人名称：________________',
            digest: 'a'.repeat(64)
          }
        }
      ],
      textLength: 16
    }
    const plan = createFillPlan(
      snapshot,
      {
        candidateId: 'c'.repeat(24),
        title: '资格审查投标文件格式',
        startNodeId: 'p-0',
        endNodeId: 'p-0',
        sourceType: 'docx-template',
        sectionOutline: ['资格审查投标文件格式'],
        confidence: 0.9,
        reasons: ['synthetic']
      },
      {
        bidderName: '示例单位',
        unifiedSocialCreditCode: '',
        address: '不应写入投标人名称字段',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: '',
        extraFields: []
      }
    )
    expect(plan.actions).toEqual([
      expect.objectContaining({ label: 'bidderName', targetNodeId: 'p-0', value: '示例单位' })
    ])
    expect(plan.unresolvedFields).toEqual([{ field: 'address', label: '注册地址' }])
    expect(plan.unknownRequired).toBe(0)
    expect(plan.warnings.join('；')).toContain('阻止猜测填充')
  })

  it('requires an explicit blank slot and preserves adjacent placeholder markers', () => {
    const snapshot = {
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: 'template.docx',
      hasTextLayer: true,
      nodes: [
        ...['p-0', 'p-1'].map((nodeId, index) => ({
          nodeId,
          kind: 'paragraph' as const,
          text: index === 0 ? '投标人应遵守本须知' : '投标人名称：____ 地址：____ [[证照]]',
          anchor: {
            nodeId,
            kind: 'paragraph' as const,
            label: '段落',
            excerpt: index === 0 ? '投标人应遵守本须知' : '投标人名称：____ 地址：____ [[证照]]',
            digest: 'a'.repeat(64)
          }
        }))
      ],
      textLength: 35
    }
    const plan = createFillPlan(
      snapshot,
      {
        candidateId: 'd'.repeat(24),
        title: '资格审查投标文件格式',
        startNodeId: 'p-0',
        endNodeId: 'p-1',
        sourceType: 'docx-template',
        sectionOutline: [],
        confidence: 0.9,
        reasons: ['synthetic']
      },
      {
        bidderName: '甲公司',
        unifiedSocialCreditCode: '',
        address: '乙市乙路',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: '',
        extraFields: []
      }
    )
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'bidderName', targetNodeId: 'p-1' }),
        expect.objectContaining({ label: 'address', targetNodeId: 'p-1' }),
        expect.objectContaining({ action: 'placeholder', targetNodeId: 'p-1' })
      ])
    )
    expect(plan.actions.some((action) => action.targetNodeId === 'p-0')).toBe(false)
  })

  it('does not hide an unresolved fixed field behind another action on the same node', () => {
    const makeNode = (nodeId: string, text: string) => ({
      nodeId,
      kind: 'paragraph' as const,
      text,
      anchor: {
        nodeId,
        kind: 'paragraph' as const,
        label: '段落',
        excerpt: text,
        digest: 'e'.repeat(64)
      }
    })
    const snapshot = {
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: 'template.docx',
      hasTextLayer: true,
      nodes: [makeNode('p-0', '投标人名称：____ 工期：____')],
      textLength: 20
    }
    const plan = createFillPlan(
      snapshot,
      {
        candidateId: 'f'.repeat(24),
        title: '资格审查投标文件格式',
        startNodeId: 'p-0',
        endNodeId: 'p-0',
        sourceType: 'docx-template',
        sectionOutline: [],
        confidence: 0.9,
        reasons: ['synthetic']
      },
      {
        bidderName: '甲公司',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: '',
        extraFields: []
      }
    )
    // Leftover blanks (here the 工期 slot) are reported for manual completion
    // but no longer block generation; only a missing bidder-name slot blocks.
    expect(plan.unknownRequired).toBe(0)
    expect(plan.unknownFields).toContainEqual(expect.objectContaining({ nodeId: 'p-0' }))
  })

  it('creates one placeholder action for every image marker in a node', () => {
    const text = '营业执照 [[证照]] 法定代表人签章 [[签章]]'
    const snapshot = {
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName: 'template.docx',
      hasTextLayer: true,
      nodes: [
        {
          nodeId: 'p-0',
          kind: 'paragraph' as const,
          text,
          anchor: {
            nodeId: 'p-0',
            kind: 'paragraph' as const,
            label: '段落',
            excerpt: text,
            digest: 'f'.repeat(64)
          }
        }
      ],
      textLength: text.length
    }
    const plan = createFillPlan(
      snapshot,
      {
        candidateId: '1'.repeat(24),
        title: '资格审查投标文件格式',
        startNodeId: 'p-0',
        endNodeId: 'p-0',
        sourceType: 'docx-template',
        sectionOutline: [],
        confidence: 0.9,
        reasons: ['synthetic']
      },
      {
        bidderName: '甲公司',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: '',
        extraFields: []
      }
    )
    expect(plan.actions.filter((action) => action.action === 'placeholder')).toHaveLength(2)
  })

  it('replaces multiple labeled values in one paragraph without swallowing later fields', () => {
    const bidder = {
      fieldId: 'a'.repeat(24),
      label: 'bidderName',
      targetNodeId: 'p-0',
      action: 'replace' as const,
      source: 'user-form' as const,
      value: '甲公司'
    }
    const address = {
      fieldId: 'b'.repeat(24),
      label: 'address',
      targetNodeId: 'p-0',
      action: 'replace' as const,
      source: 'user-form' as const,
      value: '乙市乙路'
    }
    const afterBidder = applyFieldAction('投标人名称：____ 地址：____', bidder)
    const afterAddress = applyFieldAction(afterBidder, address)
    expect(afterAddress).toBe('投标人名称：甲公司 地址：乙市乙路')
    expect(applyFieldAction('投标人名称：____ 地址：____ [[证照]]', bidder)).toBe(
      '投标人名称：甲公司 地址：____ [[证照]]'
    )
    expect(
      applyFieldAction('投标人名称：甲公司 地址：乙市乙路 [[证照]]', {
        fieldId: 'c'.repeat(24),
        label: '证照',
        targetNodeId: 'p-0',
        action: 'placeholder',
        source: 'placeholder',
        placeholderType: 'certificate'
      })
    ).toContain('甲公司 地址：乙市乙路')
  })

  it('covers role, project, internal-conflict and unresolved-placeholder rules', () => {
    const makeDocument = (displayName: string, text: string) => ({
      schemaVersion: 1 as const,
      documentType: 'docx' as const,
      displayName,
      hasTextLayer: true,
      nodes: text.split('\n').map((line, index) => ({
        nodeId: `p-${index}`,
        kind: 'paragraph' as const,
        text: line,
        anchor: {
          nodeId: `p-${index}`,
          kind: 'paragraph' as const,
          label: '段落',
          excerpt: line,
          digest: 'a'.repeat(64)
        }
      })),
      textLength: text.length
    })
    const tender = extractFacts(
      makeDocument('tender.docx', '项目名称：项目A\n标段名称：一标段\n招标人：采购单位\n工期：30天')
    )
    const bid = extractFacts(
      makeDocument(
        'bid.docx',
        '项目名称：项目B\n标段名称：二标段\n招标人：采购单位\n工期：20天\n工期：25天\n请填写项目负责人'
      )
    )
    const findings = deterministicFindings(tender, bid, '示例单位')
    expect(findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining([
        'role-confusion',
        'project-mismatch',
        'fixed-parameter-mismatch',
        'internal-conflict',
        'template-placeholder'
      ])
    )
  })
})
