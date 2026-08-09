import { createWriteStream } from 'node:fs'
import {
  access,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as yazl from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_INPUT_BYTES,
  TemporaryWorkspace,
  assertInputUnchanged,
  assertOutputAvailable,
  buildSanitizedOutputPath,
  cleanupTemporaryWorkspace,
  createInputSnapshot,
  createTemporaryWorkspace,
  finalizeVerifiedOutput,
  reserveTemporaryFile,
  sha256File
} from '../../src/core/documents/fileSafety'
import type { VerificationReport } from '../../src/shared/contracts'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-files-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function writeMinimalPdf(filePath: string, content = 'sample'): Promise<void> {
  await writeFile(filePath, `%PDF-1.7\n${content}\n%%EOF`, 'utf8')
}

async function writeDocx(filePath: string, valid = true): Promise<void> {
  const zipFile = new yazl.ZipFile()
  if (valid) {
    zipFile.addBuffer(
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '[Content_Types].xml'
    )
    zipFile.addBuffer(
      Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      '_rels/.rels'
    )
    zipFile.addBuffer(
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'
      ),
      'word/document.xml'
    )
  } else {
    zipFile.addBuffer(Buffer.from('not a Word document'), 'readme.txt')
  }
  zipFile.end()

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(filePath, { mode: 0o600 })
    zipFile.outputStream.pipe(output)
    output.on('close', resolvePromise)
    output.on('error', rejectPromise)
    zipFile.outputStream.on('error', rejectPromise)
  })
}

function passedVerification(inputSha256: string, outputSha256: string): VerificationReport {
  return {
    schemaVersion: 1,
    status: 'passed',
    checks: [{ name: 'content', status: 'passed', message: '内容指纹一致。' }],
    inputSha256,
    outputSha256
  }
}

describe('createInputSnapshot', () => {
  it('detects PDF and a valid WordprocessingML DOCX', async () => {
    const directory = await createTemporaryDirectory()
    const pdfPath = join(directory, 'input.pdf')
    const docxPath = join(directory, 'input.docx')
    await writeMinimalPdf(pdfPath)
    await writeDocx(docxPath)

    const pdf = await createInputSnapshot(pdfPath)
    const docx = await createInputSnapshot(docxPath)

    expect(pdf).toMatchObject({ displayName: 'input.pdf', documentType: 'pdf' })
    expect(docx).toMatchObject({ displayName: 'input.docx', documentType: 'docx' })
    expect(pdf.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(docx.sha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('rejects extension disguises, non-Word ZIP files and unsupported types', async () => {
    const directory = await createTemporaryDirectory()
    const disguised = join(directory, 'disguised.docx')
    const plainZip = join(directory, 'plain.docx')
    const legacy = join(directory, 'legacy.doc')
    await writeMinimalPdf(disguised)
    await writeDocx(plainZip, false)
    await writeFile(legacy, 'legacy', 'utf8')

    await expect(createInputSnapshot(disguised)).rejects.toMatchObject({
      appError: { code: 'INVALID_DOCUMENT' }
    })
    await expect(createInputSnapshot(plainZip)).rejects.toMatchObject({
      appError: { code: 'INVALID_DOCUMENT' }
    })
    await expect(createInputSnapshot(legacy)).rejects.toMatchObject({
      appError: { code: 'UNSUPPORTED_TYPE' }
    })
  })

  it.skipIf(process.platform === 'win32')('rejects symbolic-link inputs', async () => {
    const directory = await createTemporaryDirectory()
    const target = join(directory, 'target.pdf')
    const linked = join(directory, 'linked.pdf')
    await writeMinimalPdf(target)
    await symlink(target, linked)

    await expect(createInputSnapshot(linked)).rejects.toMatchObject({
      appError: { code: 'INVALID_DOCUMENT' }
    })
  })

  it('rejects a sparse file over the 200 MiB boundary before parsing content', async () => {
    const directory = await createTemporaryDirectory()
    const oversized = join(directory, 'oversized.pdf')
    const handle = await open(oversized, 'w', 0o600)
    await handle.write('%PDF-')
    await handle.truncate(MAX_INPUT_BYTES + 1)
    await handle.close()

    await expect(createInputSnapshot(oversized)).rejects.toMatchObject({
      appError: { code: 'FILE_TOO_LARGE' }
    })
  })
})

describe('immutable input and output boundaries', () => {
  it('detects an input changed after its snapshot', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'input.pdf')
    await writeMinimalPdf(inputPath, 'first')
    const snapshot = await createInputSnapshot(inputPath)
    await writeMinimalPdf(inputPath, 'other')

    await expect(assertInputUnchanged(snapshot)).rejects.toMatchObject({
      appError: { code: 'FILE_CHANGED' }
    })
  })

  it.skipIf(process.platform === 'win32')(
    'detects when a snapshotted input is replaced by a symbolic link',
    async () => {
      const directory = await createTemporaryDirectory()
      const inputPath = join(directory, 'input.pdf')
      const replacementPath = join(directory, 'replacement.pdf')
      await writeMinimalPdf(inputPath, 'first')
      await writeMinimalPdf(replacementPath, 'first')
      const snapshot = await createInputSnapshot(inputPath)
      await rm(inputPath)
      await symlink(replacementPath, inputPath)

      await expect(assertInputUnchanged(snapshot)).rejects.toMatchObject({
        appError: { code: 'FILE_CHANGED' }
      })
    }
  )

  it('builds a stable output name and refuses an existing target', async () => {
    const directory = await createTemporaryDirectory()
    const outputPath = buildSanitizedOutputPath('/source/Bid.DOCX', directory)

    expect(outputPath).toBe(join(directory, 'Bid_sanitized.docx'))
    await expect(assertOutputAvailable(outputPath)).resolves.toBeUndefined()
    await writeFile(outputPath, 'occupied', 'utf8')
    await expect(assertOutputAvailable(outputPath)).rejects.toMatchObject({
      appError: { code: 'OUTPUT_EXISTS' }
    })
  })

  it('publishes only a registered file with matching passed verification', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'input.pdf')
    await writeMinimalPdf(inputPath)
    const input = await createInputSnapshot(inputPath)
    const workspace = await createTemporaryWorkspace(directory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'input_sanitized.pdf')
    await writeFile(temporaryPath, '%PDF-1.7\nsanitized\n%%EOF', 'utf8')
    const outputSha256 = await sha256File(temporaryPath)
    const outputPath = buildSanitizedOutputPath(inputPath, directory)

    await finalizeVerifiedOutput({
      workspace,
      input,
      temporaryPath,
      outputPath,
      verification: passedVerification(input.sha256, outputSha256)
    })

    expect(await readFile(outputPath, 'utf8')).toContain('sanitized')
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await cleanupTemporaryWorkspace(workspace)
  })

  it('rejects failed verification, changed temp data and output races', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'input.pdf')
    await writeMinimalPdf(inputPath)
    const input = await createInputSnapshot(inputPath)
    const workspace = await createTemporaryWorkspace(directory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'input_sanitized.pdf')
    await writeFile(temporaryPath, '%PDF-1.7\nfirst\n%%EOF', 'utf8')
    const verifiedSha256 = await sha256File(temporaryPath)
    const outputPath = buildSanitizedOutputPath(inputPath, directory)

    const failedVerification: VerificationReport = {
      schemaVersion: 1,
      status: 'failed',
      checks: [{ name: 'content', status: 'failed', message: '内容不一致。' }],
      inputSha256: input.sha256,
      outputSha256: verifiedSha256
    }
    await expect(
      finalizeVerifiedOutput({
        workspace,
        input,
        temporaryPath,
        outputPath,
        verification: failedVerification
      })
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })

    await writeFile(temporaryPath, '%PDF-1.7\nchanged\n%%EOF', 'utf8')
    await expect(
      finalizeVerifiedOutput({
        workspace,
        input,
        temporaryPath,
        outputPath,
        verification: passedVerification(input.sha256, verifiedSha256)
      })
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })

    const currentSha256 = await sha256File(temporaryPath)
    await writeFile(outputPath, 'racing writer', 'utf8')
    await expect(
      finalizeVerifiedOutput({
        workspace,
        input,
        temporaryPath,
        outputPath,
        verification: passedVerification(input.sha256, currentSha256)
      })
    ).rejects.toMatchObject({ appError: { code: 'OUTPUT_EXISTS' } })
    expect(await readFile(outputPath, 'utf8')).toBe('racing writer')
    await cleanupTemporaryWorkspace(workspace)
  })

  it('refuses to clean an untrusted temporary workspace object', async () => {
    const directory = await createTemporaryDirectory()
    const forged = new TemporaryWorkspace(join(directory, '.bid-sentry-tmp-forged'), directory)

    await expect(cleanupTemporaryWorkspace(forged)).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
  })
})
