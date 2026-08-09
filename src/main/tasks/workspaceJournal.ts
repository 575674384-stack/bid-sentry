import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { cleanupAbandonedTemporaryWorkspace } from '../../core/documents/fileSafety'
import {
  TemporaryWorkspaceDescriptorSchema,
  type TemporaryWorkspaceDescriptor
} from '../../shared/contracts'

const WorkspaceJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(TemporaryWorkspaceDescriptorSchema).max(100)
  })
  .strict()

const MAX_JOURNAL_BYTES = 1024 * 1024

export type WorkspaceJournalEntry = TemporaryWorkspaceDescriptor

export class WorkspaceJournal {
  #queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly journalPath: string,
    private readonly cleanup: (
      workspace: TemporaryWorkspaceDescriptor
    ) => Promise<void> = cleanupAbandonedTemporaryWorkspace,
    private readonly now: () => number = Date.now
  ) {}

  recover(): Promise<void> {
    return this.#mutate(async () => {
      const entries = await this.#read()
      const remaining: WorkspaceJournalEntry[] = []
      for (const entry of entries) {
        try {
          await this.cleanup(entry)
        } catch {
          remaining.push(entry)
        }
      }
      await this.#write(remaining)
    })
  }

  add(entryInput: WorkspaceJournalEntry): Promise<void> {
    return this.#mutate(async () => {
      const entry = TemporaryWorkspaceDescriptorSchema.parse({
        ...entryInput,
        rootPath: resolve(entryInput.rootPath),
        outputDirectory: resolve(entryInput.outputDirectory)
      })
      const entries = await this.#read()
      const withoutDuplicate = entries.filter((candidate) => candidate.rootPath !== entry.rootPath)
      await this.#write([...withoutDuplicate, entry])
    })
  }

  remove(entryInput: WorkspaceJournalEntry): Promise<void> {
    return this.#mutate(async () => {
      const entry = TemporaryWorkspaceDescriptorSchema.parse({
        ...entryInput,
        rootPath: resolve(entryInput.rootPath),
        outputDirectory: resolve(entryInput.outputDirectory)
      })
      const entries = await this.#read()
      await this.#write(
        entries.filter(
          (candidate) =>
            candidate.rootPath !== entry.rootPath ||
            candidate.rootIdentity.device !== entry.rootIdentity.device ||
            candidate.rootIdentity.inode !== entry.rootIdentity.inode ||
            candidate.rootIdentity.mode !== entry.rootIdentity.mode
        )
      )
    })
  }

  #mutate(operation: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async #read(): Promise<WorkspaceJournalEntry[]> {
    try {
      const handle = await open(this.journalPath, 'r')
      let source: string
      try {
        const buffer = Buffer.alloc(MAX_JOURNAL_BYTES + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead > MAX_JOURNAL_BYTES) {
          await handle.close()
          await this.#quarantine()
          return []
        }
        source = buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close().catch(() => undefined)
      }
      const parsed = WorkspaceJournalSchema.safeParse(JSON.parse(source) as unknown)
      if (parsed.success) return parsed.data.entries
      await this.#quarantine()
      return []
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      if (error instanceof SyntaxError) {
        await this.#quarantine()
        return []
      }
      throw error
    }
  }

  async #write(entries: WorkspaceJournalEntry[]): Promise<void> {
    if (entries.length === 0) {
      await unlink(this.journalPath).catch((error: unknown) => {
        if (!(isNodeError(error) && error.code === 'ENOENT')) throw error
      })
      return
    }
    const value = WorkspaceJournalSchema.parse({ schemaVersion: 1, entries })
    await mkdir(dirname(this.journalPath), { recursive: true })
    const temporaryPath = `${this.journalPath}.${randomUUID()}.tmp`
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      await rename(temporaryPath, this.journalPath)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  async #quarantine(): Promise<void> {
    const target = `${this.journalPath}.corrupt-${this.now()}-${randomUUID()}.json`
    await rename(this.journalPath, target).catch((error: unknown) => {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error
    })
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
