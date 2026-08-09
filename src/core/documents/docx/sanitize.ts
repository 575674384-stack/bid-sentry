import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { TaskRandomMapping } from '../../sanitization/randomMapping'
import { DocumentSafetyError } from '../fileSafety'
import { readDocxArchive, writeDocxArchive } from './archive'
import { inspectDocxArchive } from './inspect'
import { sanitizeDocxMetadata } from './metadata'

export async function sanitizeDocxToPath(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await assertSafeTemporaryOutput(inputPath, outputPath)
  const archive = await readDocxArchive(inputPath, signal)
  inspectDocxArchive(archive)
  const mapping = new TaskRandomMapping()

  try {
    const sanitized = sanitizeDocxMetadata(archive, mapping)
    await writeDocxArchive(sanitized.archive, outputPath, signal)
  } finally {
    mapping.destroy()
  }
}

async function assertSafeTemporaryOutput(inputPath: string, outputPath: string): Promise<void> {
  if (resolve(inputPath) === resolve(outputPath)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [inputInfo, outputInfo] = await Promise.all([lstat(inputPath), lstat(outputPath)]).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (
    !inputInfo.isFile() ||
    inputInfo.isSymbolicLink() ||
    !outputInfo.isFile() ||
    outputInfo.isSymbolicLink() ||
    (inputInfo.dev === outputInfo.dev && inputInfo.ino === outputInfo.ino)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}
