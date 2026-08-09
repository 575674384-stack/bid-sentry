import { describe, expect, it } from 'vitest'
import { SanitizationWorkerRuntime } from '../../src/worker/sanitizationWorker'
import type { WorkerResponse } from '../../src/shared/contracts'

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000'

describe('SanitizationWorkerRuntime protocol rejection', () => {
  it('returns a strict safe error for an unknown message without echoing its contents', async () => {
    const messages: WorkerResponse[] = []
    const runtime = new SanitizationWorkerRuntime({
      postMessage: (message) => messages.push(message)
    })

    await runtime.handle({
      schemaVersion: 1,
      type: 'run-shell',
      taskId: TASK_ID,
      command: 'secret-path /private/input.docx'
    })

    expect(messages).toEqual([
      {
        schemaVersion: 1,
        type: 'error',
        taskId: TASK_ID,
        error: {
          schemaVersion: 1,
          code: 'INVALID_REQUEST',
          message: '请求无效，请重新操作。',
          retryable: false
        }
      }
    ])
    expect(JSON.stringify(messages)).not.toContain('/private/input.docx')
  })

  it('rejects cancellation for a task that is not owned by the worker', async () => {
    const messages: WorkerResponse[] = []
    const runtime = new SanitizationWorkerRuntime({
      postMessage: (message) => messages.push(message)
    })

    await runtime.handle({ schemaVersion: 1, type: 'cancel', taskId: TASK_ID })

    expect(messages[0]).toMatchObject({
      type: 'error',
      taskId: TASK_ID,
      error: { code: 'TASK_NOT_FOUND' }
    })
  })

  it('rejects execute requests that omit creation-time workspace identities', async () => {
    const messages: WorkerResponse[] = []
    const runtime = new SanitizationWorkerRuntime({
      postMessage: (message) => messages.push(message)
    })

    await runtime.handle({
      schemaVersion: 1,
      type: 'execute',
      taskId: TASK_ID,
      planDigest: 'c'.repeat(64),
      outputDirectory: '/safe/output',
      workspaceRootPath: '/safe/output/.bid-sentry-tmp-test',
      appVersion: '0.1.0'
    })

    expect(messages[0]).toMatchObject({
      type: 'error',
      taskId: TASK_ID,
      error: { code: 'INVALID_REQUEST' }
    })
  })
})
