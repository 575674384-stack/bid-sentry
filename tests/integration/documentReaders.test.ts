import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDocumentSnapshot } from '../../src/core/documents/documentReader'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'
import { writePdfFixture } from '../fixtures/builders/pdfFixture'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('anchored document readers', () => {
  it('reads DOCX paragraphs, table cells, headers and footers without modifying the input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-readers-'))
    directories.push(directory)
    const filePath = join(directory, 'tender.docx')
    await writeDocxFixture(filePath)
    const before = await readFile(filePath)

    const snapshot = await readDocumentSnapshot(filePath, 'docx')

    expect(snapshot.nodes.some((node) => node.kind === 'cell')).toBe(true)
    expect(snapshot.nodes.some((node) => node.kind === 'header')).toBe(true)
    expect(snapshot.nodes.some((node) => node.kind === 'footer')).toBe(true)
    expect(await readFile(filePath)).toEqual(before)
  })

  it('extracts real PDF text-layer pages and rejects scanned pages for content workflows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-readers-'))
    directories.push(directory)
    const textPath = join(directory, 'text.pdf')
    const scannedPath = join(directory, 'scanned.pdf')
    await writePdfFixture(textPath)
    await writePdfFixture(scannedPath, { scanned: true })

    const snapshot = await readDocumentSnapshot(textPath, 'pdf')
    expect(snapshot.nodes.length).toBeGreaterThan(0)
    expect(snapshot.nodes[0]?.anchor.page).toBe(1)
    expect(snapshot.nodes[0]?.anchor.bbox?.width).toBeGreaterThan(0)
    expect(snapshot.nodes.some((node) => node.text.includes('Bid document page content'))).toBe(
      true
    )
    await expect(readDocumentSnapshot(scannedPath, 'pdf')).rejects.toMatchObject({
      appError: { code: 'TEXT_LAYER_REQUIRED' }
    })
  })
})
