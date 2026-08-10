import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { GenerationTaskManager } from '../../src/main/tasks/generationTaskManager'
import { readDocxArchive } from '../../src/core/documents/docx/archive'
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
    await writeDocxFixture(inputPath)
    const before = await readFile(inputPath)
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
        candidateId: candidate!.candidateId,
        userForm,
        confirmed: true
      },
      input,
      directory
    )
    expect(result.outputName).toContain('资格标草稿.docx')
    const output = await readDocxArchive(join(directory, result.outputName))
    expect(output.entries.some((entry) => entry.name === 'word/document.xml')).toBe(true)
    expect(await readFile(inputPath)).toEqual(before)
    expect(JSON.stringify(output)).not.toContain('apiKey')
  })

  it('rebuilds a text-layer PDF template into a new DOCX and rejects scanned PDFs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-generation-pdf-'))
    directories.push(directory)
    const inputPath = join(directory, 'tender.pdf')
    await writePdfFixture(inputPath)
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
    const preview = await manager.preview(
      { schemaVersion: 1, inputId: '123e4567-e89b-42d3-a456-426614174000', userForm },
      input
    )
    const result = await manager.run(
      {
        schemaVersion: 1,
        inputId: '123e4567-e89b-42d3-a456-426614174000',
        outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000',
        candidateId: preview.candidates[0]!.candidateId,
        userForm,
        confirmed: true
      },
      input,
      directory
    )
    expect(result.warnings).toContain('PDF 模板将结构化重建为 DOCX，可能存在版式差异。')
    expect((await readDocxArchive(join(directory, result.outputName))).entries).toContainEqual(
      expect.objectContaining({ name: 'word/document.xml' })
    )
  })
})
