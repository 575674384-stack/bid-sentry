import { TaskRandomMapping } from '../../sanitization/randomMapping'
import { assertSafeTemporaryOutput } from '../fileSafety'
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
