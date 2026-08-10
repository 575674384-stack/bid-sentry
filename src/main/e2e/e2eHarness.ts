import { appendFileSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { utilityProcess } from 'electron'
import type { ManagedWorkerProcess } from '../tasks/taskManager'
import type { WorkerRequest } from '../../shared/contracts'

export interface E2eHarness {
  readonly inputPaths: readonly string[]
  readonly userDataDirectory: string
  createWorker(workerPath: string): ManagedWorkerProcess
  recordRevealedFile(absolutePath: string): void
}

export function createE2eHarness(environment: NodeJS.ProcessEnv): E2eHarness {
  if (environment.BID_SENTRY_E2E !== '1') {
    throw new Error('E2E harness activation was rejected.')
  }

  const root = requiredAbsolutePath(environment, 'BID_SENTRY_E2E_ROOT')
  const inputPaths = parseInputPaths(environment, root)
  const userDataDirectory = pathInsideRoot(environment, 'BID_SENTRY_E2E_USER_DATA', root)
  const revealLogPath = pathInsideRoot(environment, 'BID_SENTRY_E2E_REVEAL_LOG', root)
  const executeDelayMs = parseExecuteDelay(environment.BID_SENTRY_E2E_EXECUTE_DELAY_MS)

  return Object.freeze({
    inputPaths: Object.freeze(inputPaths),
    userDataDirectory,
    createWorker(workerPath: string): ManagedWorkerProcess {
      return createDelayedWorker(workerPath, executeDelayMs)
    },
    recordRevealedFile(absolutePath: string): void {
      const resultPath = ensureInsideRoot(root, absolutePath)
      appendFileSync(revealLogPath, `${basename(resultPath)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
    }
  })
}

function parseInputPaths(environment: NodeJS.ProcessEnv, root: string): string[] {
  const raw = environment.BID_SENTRY_E2E_INPUTS
  if (!raw) throw new Error('E2E input fixtures are missing.')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('E2E input fixtures are invalid.')
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > 20 ||
    parsed.some((value) => typeof value !== 'string')
  ) {
    throw new Error('E2E input fixtures are invalid.')
  }
  return parsed.map((value) => ensureInsideRoot(root, value))
}

function pathInsideRoot(environment: NodeJS.ProcessEnv, name: string, root: string): string {
  return ensureInsideRoot(root, requiredAbsolutePath(environment, name))
}

function requiredAbsolutePath(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]
  if (!value || !isAbsolute(value)) throw new Error('E2E path configuration is invalid.')
  return resolve(value)
}

function ensureInsideRoot(root: string, candidate: string): string {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(candidate)
  const relation = relative(absoluteRoot, absoluteCandidate)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('E2E path escaped its temporary root.')
  }
  return absoluteCandidate
}

function parseExecuteDelay(raw: string | undefined): number {
  if (raw === undefined) return 0
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 5_000) {
    throw new Error('E2E execute delay is invalid.')
  }
  return value
}

function createDelayedWorker(workerPath: string, executeDelayMs: number): ManagedWorkerProcess {
  const worker = utilityProcess.fork(workerPath, [], {
    serviceName: 'Bid Sentry E2E Document Worker'
  })
  let pendingExecute: NodeJS.Timeout | null = null

  const managed: ManagedWorkerProcess = {
    postMessage(message: WorkerRequest): void {
      if (message.type === 'execute' && executeDelayMs > 0) {
        if (pendingExecute) throw new Error('E2E worker already has a pending execution.')
        pendingExecute = setTimeout(() => {
          pendingExecute = null
          worker.postMessage(message)
        }, executeDelayMs)
        return
      }
      if (message.type === 'cancel' && pendingExecute) {
        clearTimeout(pendingExecute)
        pendingExecute = null
      }
      worker.postMessage(message)
    },
    on(
      event: 'message' | 'exit',
      listener: ((message: unknown) => void) | ((code: number) => void)
    ) {
      if (event === 'message') worker.on(event, listener as (message: unknown) => void)
      else worker.on(event, listener as (code: number) => void)
      return managed
    },
    kill(): boolean {
      if (pendingExecute) {
        clearTimeout(pendingExecute)
        pendingExecute = null
      }
      return worker.kill()
    }
  }
  return managed
}
