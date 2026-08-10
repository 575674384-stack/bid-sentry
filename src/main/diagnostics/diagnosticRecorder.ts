import { appendFile, chmod, mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DiagnosticEventSchema,
  DiagnosticSummarySchema,
  type AppError,
  type DiagnosticEvent,
  type DiagnosticStage,
  type DiagnosticSystemCategory,
  type DiagnosticTaskType
} from '../../shared/contracts'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface DiagnosticRecorderOptions {
  directory: string
  appVersion: string
  runtime?: string
  os?: string
  now?: () => Date
}

export interface DiagnosticRecordInput {
  taskType?: DiagnosticTaskType
  stage?: DiagnosticStage
  code: string
  detailId?: string
  systemCategory?: DiagnosticSystemCategory
}

/**
 * Privacy-safe, best-effort diagnostics. The recorder accepts only an
 * allow-listed projection and therefore never needs to inspect an exception.
 */
export class DiagnosticRecorder {
  readonly #directory: string
  readonly #appVersion: string
  readonly #runtime: string
  readonly #os: string
  readonly #now: () => Date

  constructor(options: DiagnosticRecorderOptions) {
    this.#directory = options.directory
    this.#appVersion = options.appVersion
    this.#runtime = options.runtime ?? process.versions.electron ?? process.versions.node
    this.#os = options.os ?? process.platform
    this.#now = options.now ?? (() => new Date())
  }

  async record(input: DiagnosticRecordInput): Promise<string> {
    const detailId = input.detailId ?? randomUUID()
    const event = DiagnosticEventSchema.parse({
      schemaVersion: 1,
      timestamp: this.#now().toISOString(),
      appVersion: this.#appVersion,
      runtime: this.#runtime,
      os: this.#os,
      taskType: input.taskType ?? 'sanitization',
      stage: input.stage ?? 'unknown',
      code: input.code,
      detailId,
      systemCategory: input.systemCategory ?? 'unknown'
    })
    await this.#append(event)
    return detailId
  }

  async recordError(
    error: AppError,
    options: {
      taskType?: DiagnosticTaskType
      systemCategory?: DiagnosticSystemCategory
      stage?: DiagnosticStage
    } = {}
  ): Promise<string> {
    const stage = options.stage ?? error.stage
    return this.record({
      code: error.code,
      ...(options.taskType ? { taskType: options.taskType } : {}),
      ...(stage ? { stage } : {}),
      ...(error.detailId ? { detailId: error.detailId } : {}),
      ...(options.systemCategory ? { systemCategory: options.systemCategory } : {})
    })
  }

  async summary(detailId: string): Promise<unknown> {
    await this.#prune()
    const events: DiagnosticEvent[] = []
    for (const file of await this.#files()) {
      try {
        const text = await readFile(join(this.#directory, file), 'utf8')
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          const parsed = DiagnosticEventSchema.safeParse(JSON.parse(line))
          if (parsed.success && parsed.data.detailId === detailId) events.push(parsed.data)
        }
      } catch {
        // A corrupt/locked diagnostics file is not allowed to affect a task.
      }
    }
    return DiagnosticSummarySchema.parse({ schemaVersion: 1, detailId, events })
  }

  async #append(event: DiagnosticEvent): Promise<void> {
    try {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 })
      await this.#prune()
      const file = join(this.#directory, 'diagnostics.jsonl')
      let size = 0
      try {
        size = (await stat(file)).size
      } catch {
        // New file.
      }
      if (size + Buffer.byteLength(JSON.stringify(event), 'utf8') + 1 > MAX_FILE_BYTES) {
        const rotated = join(this.#directory, `diagnostics-${Date.now()}.jsonl`)
        try {
          await rename(file, rotated)
        } catch {
          // If another process rotated it, writing the current file remains safe.
        }
      }
      await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
      await chmod(file, 0o600)
      await this.#prune()
    } catch {
      // Diagnostics are deliberately non-blocking: never turn a safe task
      // failure into a second failure because a profile directory is read-only.
    }
  }

  async #files(): Promise<string[]> {
    try {
      return (await readdir(this.#directory)).filter((file) =>
        /^diagnostics(?:-\d+)?\.jsonl$/u.test(file)
      )
    } catch {
      return []
    }
  }

  async #prune(): Promise<void> {
    const files = await this.#files()
    const cutoff = this.#now().getTime() - MAX_AGE_MS
    const entries = await Promise.all(
      files.map(async (file) => {
        const path = join(this.#directory, file)
        try {
          const info = await stat(path)
          return { file, path, time: info.mtimeMs }
        } catch {
          return null
        }
      })
    )
    const valid = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    for (const entry of valid) {
      if (entry.time < cutoff) await unlink(entry.path).catch(() => undefined)
    }
    const remaining = valid.filter((entry) => entry.time >= cutoff).sort((a, b) => b.time - a.time)
    for (const entry of remaining.slice(MAX_FILES)) await unlink(entry.path).catch(() => undefined)
  }
}
