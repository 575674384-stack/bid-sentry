import { SanitizationWorkerRuntime } from './sanitizationWorker'

const parentPort = process.parentPort

if (!parentPort) {
  throw new Error('Bid Sentry worker requires an Electron utility-process parent port.')
}

const worker = new SanitizationWorkerRuntime(parentPort)
parentPort.on('message', (event) => {
  void worker.handle(event.data)
})
