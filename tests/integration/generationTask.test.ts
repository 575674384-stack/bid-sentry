import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { GenerationTaskManager } from '../../src/main/tasks/generationTaskManager'
import { readDocxArchive } from '../../src/core/documents/docx/archive'
import { readDocumentSnapshot } from '../../src/core/documents/documentReader'
import { generateDocxFromTemplate } from '../../src/core/generation/docx'
import { resolvePathIdentityWithoutSymbolicLinks } from '../../src/core/documents/pathSafety'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'
import { writePdfFixture } from '../fixtures/builders/pdfFixture'

const directories: string[] = []
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
)

describe('GenerationTaskManager', () => {
  it('generates a new DOCX from the selected template without modifying input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-'))
    directories.push(directory)
    const inputPath = join(directory, 'tender.docx')
    await writeDocxFixture(inputPath, {
      qualificationTemplate: true,
      externalDocumentRelationship: false,
      splitBidderNameCells: true,
      structuredDocumentTag: true,
      rootUnrelatedAttachment: true,
      notesWithMedia: true
    })
    const before = await readFile(inputPath)
    const input = await createInputSnapshot(inputPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const manager = new GenerationTaskManager()
    const userForm = {
      bidderName: '示例投标单位',
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
    }
    const preview = await manager.preview(
      { schemaVersion: 1, inputId: '123e4567-e89b-42d3-a456-426614174000', userForm },
      input
    )
    const candidate = preview.candidates[0]
    expect(candidate).toBeDefined()
    const result = await manager.run(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
        previewTaskId: preview.taskId,
        candidateId: candidate!.candidateId,
        planId: preview.plans.find((plan) => plan.candidateId === candidate!.candidateId)!.planId,
        planDigest: preview.plans.find((plan) => plan.candidateId === candidate!.candidateId)!
          .planDigest,
        confirmed: true
      },
      input,
      directory,
      outputDirectoryIdentity
    )
    expect(result.outputName).toContain('资格标草稿.docx')
    const output = await readDocxArchive(join(directory, result.outputName))
    expect(output.entries.some((entry) => entry.name === 'word/document.xml')).toBe(true)
    const documentXml = output.entries.find((entry) => entry.name === 'word/document.xml')!
    expect(documentXml.contents.toString('utf8')).toContain('投标文件正文必须保持不变')
    expect(documentXml.contents.toString('utf8')).toContain('投标人名称')
    expect(documentXml.contents.toString('utf8')).toContain('示例投标单位')
    expect(documentXml.contents.toString('utf8')).toContain('受控模板内容')
    expect(documentXml.contents.toString('utf8')).not.toContain('其他投标文件正文（范围外）')
    expect(output.entries.some((entry) => entry.name === 'word/comments.xml')).toBe(false)
    expect(output.entries.some((entry) => entry.name === 'docProps/custom.xml')).toBe(false)
    expect(output.entries.some((entry) => entry.name === 'word/media/image1.png')).toBe(true)
    expect(output.entries.some((entry) => entry.name === 'word/media/unrelated.png')).toBe(false)
    expect(output.entries.some((entry) => entry.name === 'word/media/note1.png')).toBe(true)
    expect(output.entries.some((entry) => entry.name === 'word/media/note2.png')).toBe(false)
    expect(
      output.entries.find((entry) => entry.name === 'word/footnotes.xml')!.contents.toString('utf8')
    ).not.toContain('Unselected note')
    expect(output.entries.some((entry) => entry.name === 'word/header1.xml')).toBe(true)
    expect(output.entries.some((entry) => entry.name === 'word/footer1.xml')).toBe(true)
    expect(
      output.entries.find((entry) => entry.name === 'word/header1.xml')!.contents.toString('utf8')
    ).toContain('页眉内容')
    expect(
      output.entries.find((entry) => entry.name === 'word/footer1.xml')!.contents.toString('utf8')
    ).toContain('页脚内容')
    const rootRelationships = output.entries.find((entry) => entry.name === '_rels/.rels')!
    expect(rootRelationships.contents.toString('utf8')).not.toContain('custom-properties')
    expect(result.warnings).toContain('DOCX 生成不会保留原自定义属性（如存在），请在输出前确认。')
    expect(await readFile(inputPath)).toEqual(before)
    expect(JSON.stringify(output)).not.toContain('apiKey')
  })

  it('binds execution to the exact confirmed generation plan and rejects tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-plan-'))
    directories.push(directory)
    const inputPath = join(directory, 'tender.docx')
    await writeDocxFixture(inputPath, {
      qualificationTemplate: true,
      externalDocumentRelationship: false
    })
    const input = await createInputSnapshot(inputPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const manager = new GenerationTaskManager()
    const userForm = {
      bidderName: '确认计划单位',
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
    }
    const preview = await manager.preview(
      { schemaVersion: 1, inputId: '123e4567-e89b-42d3-a456-426614174000', userForm },
      input
    )
    const plan = preview.plans[0]!
    await expect(
      manager.run(
        {
          schemaVersion: 1,
          inputId: '123e4567-e89b-42d3-a456-426614174000',
          outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
          previewTaskId: preview.taskId,
          candidateId: plan.candidateId,
          planId: plan.planId,
          planDigest: '0'.repeat(64),
          confirmed: true
        },
        input,
        directory,
        outputDirectoryIdentity
      )
    ).rejects.toMatchObject({ appError: { code: 'PLAN_EXPIRED' } })
    expect((await readdir(directory)).filter((name) => name.endsWith('.docx'))).toEqual([
      'tender.docx'
    ])
  })

  it('keeps only the selected DOCX section header and footer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-sections-'))
    directories.push(directory)
    const inputPath = join(directory, 'multi-section.docx')
    await writeDocxFixture(inputPath, {
      qualificationTemplate: true,
      multiSection: true,
      externalDocumentRelationship: false
    })
    const input = await createInputSnapshot(inputPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const manager = new GenerationTaskManager()
    const preview = await manager.preview(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        userForm: {
          bidderName: '多节单位',
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
        }
      },
      input
    )
    const firstCandidate = preview.candidates.find((candidate) =>
      candidate.title.includes('资格审查')
    )
    expect(firstCandidate).toBeDefined()
    const firstPlan = preview.plans.find((plan) => plan.candidateId === firstCandidate!.candidateId)
    expect(firstPlan).toBeDefined()
    const result = await manager.run(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
        previewTaskId: preview.taskId,
        candidateId: firstCandidate!.candidateId,
        planId: firstPlan!.planId,
        planDigest: firstPlan!.planDigest,
        confirmed: true
      },
      input,
      directory,
      outputDirectoryIdentity
    )
    const output = await readDocxArchive(join(directory, result.outputName))
    const outputDocumentXml = output.entries
      .find((entry) => entry.name === 'word/document.xml')!
      .contents.toString('utf8')
    expect(outputDocumentXml).toContain('rIdHeader')
    expect(outputDocumentXml).not.toContain('rIdHeader2')
    expect(output.entries.some((entry) => entry.name === 'word/header1.xml')).toBe(true)
    expect(output.entries.some((entry) => entry.name === 'word/footer1.xml')).toBe(true)
    expect(output.entries.some((entry) => entry.name === 'word/header2.xml')).toBe(false)
    expect(output.entries.some((entry) => entry.name === 'word/footer2.xml')).toBe(false)

    const snapshot = await readDocumentSnapshot(inputPath, 'docx')
    const secondHeading = snapshot.nodes.find((node) => node.text.includes('其他投标文件正文'))
    expect(secondHeading).toBeDefined()
    const secondOutputPath = join(directory, 'second-section.docx')
    await generateDocxFromTemplate(
      inputPath,
      secondOutputPath,
      snapshot,
      {
        candidateId: 'a'.repeat(24),
        title: '第二节',
        startNodeId: secondHeading!.nodeId,
        endNodeId: secondHeading!.nodeId,
        sourceType: 'docx-template',
        sectionOutline: [],
        confidence: 1,
        reasons: ['synthetic']
      },
      []
    )
    const secondOutput = await readDocxArchive(secondOutputPath)
    const secondDocumentXml = secondOutput.entries
      .find((entry) => entry.name === 'word/document.xml')!
      .contents.toString('utf8')
    expect(secondDocumentXml).toContain('rIdHeader2')
    expect(secondDocumentXml).not.toContain('rIdHeader"')
    expect(secondOutput.entries.some((entry) => entry.name === 'word/header2.xml')).toBe(true)
    expect(secondOutput.entries.some((entry) => entry.name === 'word/footer2.xml')).toBe(true)
    expect(secondOutput.entries.some((entry) => entry.name === 'word/header1.xml')).toBe(false)
    expect(secondOutput.entries.some((entry) => entry.name === 'word/footer1.xml')).toBe(false)
  })

  it('refuses to preview a document when no explicit template range exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-no-template-'))
    directories.push(directory)
    const inputPath = join(directory, 'ordinary.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const manager = new GenerationTaskManager()
    const userForm = {
      bidderName: '示例投标单位',
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
    }
    await expect(
      manager.preview(
        { schemaVersion: 1, inputId: '123e4567-e89b-42d3-a456-426614174000', userForm },
        input
      )
    ).rejects.toMatchObject({ appError: { code: 'INVALID_REQUEST' } })
  })

  it('rebuilds a text-layer PDF template into a new DOCX and rejects scanned PDFs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-pdf-'))
    directories.push(directory)
    const inputPath = join(directory, 'tender.pdf')
    await writePdfFixture(inputPath, { qualificationTemplate: true })
    const input = await createInputSnapshot(inputPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const manager = new GenerationTaskManager()
    const userForm = {
      bidderName: '示例投标单位',
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
    }
    const preview = await manager.preview(
      { schemaVersion: 1, inputId: '123e4567-e89b-42d3-a456-426614174000', userForm },
      input
    )
    const result = await manager.run(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
        previewTaskId: preview.taskId,
        candidateId: preview.candidates[0]!.candidateId,
        planId: preview.plans[0]!.planId,
        planDigest: preview.plans[0]!.planDigest,
        confirmed: true
      },
      input,
      directory,
      outputDirectoryIdentity
    )
    expect(result.warnings).toContain('PDF 模板将结构化重建为 DOCX，可能存在版式差异。')
    expect((await readDocxArchive(join(directory, result.outputName))).entries).toContainEqual(
      expect.objectContaining({ name: 'word/document.xml' })
    )
    const generatedSnapshot = await readDocumentSnapshot(join(directory, result.outputName), 'docx')
    const generatedText = generatedSnapshot.nodes.map((node) => node.text).join('\n')
    expect(generatedText).toContain('Bidder name:')
    expect(generatedText).toContain('示例投标单位')
    expect(generatedText).not.toContain('Second page content remains unchanged.')
  })

  it('rebuilds PDF headings and obvious columns as editable DOCX structure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-pdf-layout-'))
    directories.push(directory)
    const inputPath = join(directory, 'layout.pdf')
    await writePdfFixture(inputPath, { qualificationTemplate: true, multiColumn: true })
    const input = await createInputSnapshot(inputPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const manager = new GenerationTaskManager()
    const preview = await manager.preview(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        userForm: {
          bidderName: '布局示例单位',
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
        }
      },
      input
    )
    const plan = preview.plans[0]!
    const result = await manager.run(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
        previewTaskId: preview.taskId,
        candidateId: plan.candidateId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        confirmed: true
      },
      input,
      directory,
      outputDirectoryIdentity
    )
    const output = await readDocxArchive(join(directory, result.outputName))
    const documentXml = output.entries
      .find((entry) => entry.name === 'word/document.xml')!
      .contents.toString('utf8')
    expect(documentXml).toContain('w:pStyle w:val="Heading1"')
    expect(documentXml).toContain('<w:tbl>')
    expect(documentXml).toContain('布局示例单位')
    expect(documentXml).toContain('Project number: 2024-001')
    const generatedSnapshot = await readDocumentSnapshot(join(directory, result.outputName), 'docx')
    expect(generatedSnapshot.nodes.filter((node) => node.kind === 'cell')).toHaveLength(2)
  })
})
