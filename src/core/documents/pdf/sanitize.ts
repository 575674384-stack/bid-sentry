import { writeFile } from 'node:fs/promises'
import { TaskRandomMapping } from '../../sanitization/randomMapping'
import { assertSafeTemporaryOutput, DocumentSafetyError } from '../fileSafety'
import { loadSafePdfFile } from './inspect'
import { sanitizePdfMetadata } from './metadata'

export async function sanitizePdfToPath(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
  replacementValues?: Readonly<Record<string, string>>
): Promise<void> {
  await assertSafeTemporaryOutput(inputPath, outputPath)
  const { document } = await loadSafePdfFile(inputPath, signal)
  const mapping = new TaskRandomMapping()

  try {
    sanitizePdfMetadata(document, mapping, replacementValues)
    throwIfAborted(signal)
    const bytes = await document.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false
    })
    throwIfAborted(signal)
    try {
      await writeFile(outputPath, bytes, { mode: 0o600, signal })
    } catch (error) {
      if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
      throw new DocumentSafetyError('INVALID_DOCUMENT', error)
    }
  } finally {
    mapping.destroy()
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
}
