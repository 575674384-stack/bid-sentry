import { randomUUID } from 'node:crypto'
import {
  WorkerRequestSchema,
  WorkerResponseSchema,
  createAppError,
  toSafeAppError,
  type AppError,
  type TaskProgress,
  type WorkerRequest,
  type WorkerResponse
} from '../shared/contracts'
import { DocumentSafetyError } from '../core/documents/fileSafety'
import { SanitizationJob } from '../core/sanitization/sanitizeJob'

export interface WorkerMessagePort {
  postMessage(message: WorkerResponse): void
}

export class SanitizationWorkerRuntime {
  readonly #job: SanitizationJob
  readonly #port: WorkerMessagePort
  #taskId: string | null = null
  #controller: AbortController | null = null
  #operationPending = false

  constructor(port: WorkerMessagePort, job: SanitizationJob = new SanitizationJob()) {
    this.#port = port
    this.#job = job
  }

  async handle(rawMessage: unknown): Promise<void> {
    const parsed = WorkerRequestSchema.safeParse(rawMessage)
    if (!parsed.success) {
      this.#postError(taskIdFromUnknown(rawMessage), createAppError('INVALID_REQUEST'))
      return
    }

    const message = parsed.data
    if (message.type === 'cancel') {
      this.#cancel(message)
      return
    }
    if (this.#operationPending || (this.#taskId !== null && this.#taskId !== message.taskId)) {
      this.#postError(message.taskId, createAppError('INVALID_REQUEST'))
      return
    }

    if (message.type === 'preview') {
      await this.#preview(message)
    } else {
      await this.#execute(message)
    }
  }

  async #preview(message: Extract<WorkerRequest, { type: 'preview' }>): Promise<void> {
    this.#taskId = message.taskId
    this.#controller = new AbortController()
    this.#operationPending = true
    try {
      const preview = await this.#job.preview(message, this.#controller.signal, (progress) =>
        this.#postProgress(progress)
      )
      this.#post({ schemaVersion: 1, type: 'preview-result', preview })
    } catch (error) {
      this.#handleOperationError(message.taskId, error)
      this.#reset()
    } finally {
      this.#operationPending = false
    }
  }

  async #execute(message: Extract<WorkerRequest, { type: 'execute' }>): Promise<void> {
    if (!this.#controller || this.#taskId !== message.taskId || this.#controller.signal.aborted) {
      this.#postError(message.taskId, createAppError('TASK_NOT_FOUND'))
      return
    }

    this.#operationPending = true
    try {
      const result = await this.#job.execute(message, this.#controller.signal, (progress) =>
        this.#postProgress(progress)
      )
      this.#post({ schemaVersion: 1, type: 'execute-result', result })
    } catch (error) {
      this.#handleOperationError(message.taskId, error)
    } finally {
      this.#operationPending = false
      this.#reset()
    }
  }

  #cancel(message: Extract<WorkerRequest, { type: 'cancel' }>): void {
    if (!this.#controller || this.#taskId !== message.taskId) {
      this.#postError(message.taskId, createAppError('TASK_NOT_FOUND'))
      return
    }

    this.#job.cancel(message.taskId)
    this.#controller.abort(createAppError('TASK_CANCELLED'))
    if (!this.#operationPending) {
      this.#postProgress(cancelledProgress(message.taskId))
      this.#reset()
    }
  }

  #handleOperationError(taskId: string, error: unknown): void {
    const appError = safeError(error)
    if (appError.code === 'TASK_CANCELLED') {
      this.#postProgress(cancelledProgress(taskId))
    } else {
      this.#postError(taskId, appError)
    }
  }

  #postProgress(progress: TaskProgress): void {
    this.#post({ schemaVersion: 1, type: 'progress', progress })
  }

  #postError(taskId: string, error: AppError): void {
    this.#post({ schemaVersion: 1, type: 'error', taskId, error })
  }

  #post(message: WorkerResponse): void {
    this.#port.postMessage(WorkerResponseSchema.parse(message))
  }

  #reset(): void {
    this.#taskId = null
    this.#controller = null
  }
}

function cancelledProgress(taskId: string): TaskProgress {
  return {
    schemaVersion: 1,
    taskId,
    state: 'cancelled',
    progress: 0,
    message: '任务已取消。'
  }
}

function safeError(error: unknown): AppError {
  return error instanceof DocumentSafetyError ? error.appError : toSafeAppError(error)
}

function taskIdFromUnknown(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'taskId' in message &&
    typeof message.taskId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      message.taskId
    )
  ) {
    return message.taskId
  }
  return randomUUID()
}
