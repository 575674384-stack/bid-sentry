import { createWriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { posix } from 'node:path'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import { DocumentSafetyError } from '../fileSafety'

const MAX_ENTRY_COUNT = 10_000
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
const MAX_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 100

export interface DocxArchiveEntry {
  name: string
  contents: Buffer
  compressionMethod: number
  lastModified: Date
  mode: number
  isDirectory: boolean
}

export interface DocxArchive {
  entries: DocxArchiveEntry[]
}

export async function readDocxArchive(
  filePath: string,
  signal?: AbortSignal
): Promise<DocxArchive> {
  throwIfAborted(signal)

  return new Promise<DocxArchive>((resolvePromise, rejectPromise) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true, strictFileNames: true },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          rejectPromise(toArchiveReadError(openError))
          return
        }

        const entries: DocxArchiveEntry[] = []
        const names = new Set<string>()
        let totalUncompressedBytes = 0
        let settled = false

        const reject = (error: unknown): void => {
          if (settled) return
          settled = true
          zipFile.close()
          rejectPromise(toArchiveReadError(error))
        }

        zipFile.on('error', reject)
        zipFile.on('entry', (entry) => {
          if (settled) return
          try {
            throwIfAborted(signal)
            validateEntry(entry, names)
            totalUncompressedBytes += entry.uncompressedSize
            if (
              entries.length + 1 > MAX_ENTRY_COUNT ||
              totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES
            ) {
              throw new DocumentSafetyError('UNSAFE_ARCHIVE')
            }

            const isDirectory = entry.fileName.endsWith('/')
            if (isDirectory) {
              entries.push(toArchiveEntry(entry, Buffer.alloc(0), true))
              zipFile.readEntry()
              return
            }

            zipFile.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) {
                reject(streamError)
                return
              }

              const chunks: Buffer[] = []
              let bytesRead = 0
              const onAbort = (): void => {
                stream.destroy(new DocumentSafetyError('TASK_CANCELLED', signal?.reason))
              }
              const removeAbortListener = (): void => {
                signal?.removeEventListener('abort', onAbort)
              }
              signal?.addEventListener('abort', onAbort, { once: true })
              stream.on('data', (chunk: Buffer) => {
                if (signal?.aborted) {
                  onAbort()
                  return
                }
                bytesRead += chunk.length
                if (
                  bytesRead > entry.uncompressedSize ||
                  bytesRead > MAX_ENTRY_UNCOMPRESSED_BYTES
                ) {
                  stream.destroy(new DocumentSafetyError('UNSAFE_ARCHIVE'))
                  return
                }
                chunks.push(chunk)
              })
              stream.on('error', (error) => {
                removeAbortListener()
                reject(error)
              })
              stream.on('end', () => {
                removeAbortListener()
                if (settled) return
                if (bytesRead !== entry.uncompressedSize) {
                  reject(new DocumentSafetyError('INVALID_DOCUMENT'))
                  return
                }
                entries.push(toArchiveEntry(entry, Buffer.concat(chunks), false))
                zipFile.readEntry()
              })
            })
          } catch (error) {
            reject(error)
          }
        })
        zipFile.on('end', () => {
          if (settled) return
          settled = true
          resolvePromise({ entries })
        })
        zipFile.readEntry()
      }
    )
  })
}

export async function writeDocxArchive(
  archive: DocxArchive,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  const zipFile = new yazl.ZipFile()

  for (const entry of archive.entries) {
    throwIfAborted(signal)
    const options = {
      mtime: entry.lastModified,
      mode: entry.mode,
      compress: entry.compressionMethod !== 0
    }
    if (entry.isDirectory) {
      zipFile.addEmptyDirectory(entry.name, options)
    } else {
      zipFile.addBuffer(entry.contents, entry.name, options)
    }
  }
  zipFile.end()

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outputPath, { flags: 'w', mode: 0o600 })
    const onAbort = (): void => {
      output.destroy(new DocumentSafetyError('TASK_CANCELLED', signal?.reason))
    }
    const removeAbortListener = (): void => {
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const reject = (error: unknown): void => {
      removeAbortListener()
      output.destroy()
      rejectPromise(error)
    }
    zipFile.outputStream.on('error', reject)
    output.on('error', reject)
    output.on('close', () => {
      removeAbortListener()
      resolvePromise()
    })
    zipFile.outputStream.pipe(output)
  })

  const handle = await open(outputPath, 'r+')
  await handle.sync()
  await handle.close()
}

export function archiveEntryMap(archive: DocxArchive): ReadonlyMap<string, DocxArchiveEntry> {
  return new Map(archive.entries.map((entry) => [entry.name, entry]))
}

export function replaceArchiveEntries(
  archive: DocxArchive,
  replacements: ReadonlyMap<string, Buffer>
): DocxArchive {
  return {
    entries: archive.entries.map((entry) => ({
      ...entry,
      contents: replacements.get(entry.name) ?? entry.contents
    }))
  }
}

function validateEntry(entry: yauzl.Entry, names: Set<string>): void {
  const name = entry.fileName
  if (!isSafeArchivePath(name) || names.has(name)) {
    throw new DocumentSafetyError('UNSAFE_ARCHIVE')
  }
  names.add(name)

  if ((entry.generalPurposeBitFlag & 0x1) !== 0 || isSymbolicLink(entry)) {
    throw new DocumentSafetyError('UNSAFE_ARCHIVE')
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new DocumentSafetyError('UNSAFE_ARCHIVE')
  }
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
  ) {
    throw new DocumentSafetyError('UNSAFE_ARCHIVE')
  }
}

function isSafeArchivePath(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/')) return false
  const withoutDirectorySuffix = name.endsWith('/') ? name.slice(0, -1) : name
  if (!withoutDirectorySuffix) return false
  if (/^[A-Za-z]:/u.test(withoutDirectorySuffix)) return false
  return (
    posix.normalize(withoutDirectorySuffix) === withoutDirectorySuffix &&
    withoutDirectorySuffix.split('/').every((segment) => segment !== '..' && segment !== '.')
  )
}

function isSymbolicLink(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return (unixMode & 0o170000) === 0o120000
}

function toArchiveEntry(
  entry: yauzl.Entry,
  contents: Buffer,
  isDirectory: boolean
): DocxArchiveEntry {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return {
    name: entry.fileName,
    contents,
    compressionMethod: entry.compressionMethod,
    lastModified: entry.getLastModDate(),
    mode: unixMode || (isDirectory ? 0o755 : 0o600),
    isDirectory
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
}

function toArchiveReadError(error: unknown): DocumentSafetyError {
  if (error instanceof DocumentSafetyError) return error
  if (
    error instanceof Error &&
    /^(absolute path|invalid characters in fileName|invalid relative path):/u.test(error.message)
  ) {
    return new DocumentSafetyError('UNSAFE_ARCHIVE', error)
  }
  return new DocumentSafetyError('INVALID_DOCUMENT', error)
}
