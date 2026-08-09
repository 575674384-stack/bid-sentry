const parentPort = process.parentPort

if (!parentPort) {
  throw new Error('Bid Sentry worker requires an Electron utility-process parent port.')
}

parentPort.on('message', () => {
  parentPort.postMessage({
    schemaVersion: 1,
    type: 'error',
    error: {
      code: 'UNSUPPORTED_MESSAGE',
      message: '当前后台任务消息尚不受支持。'
    }
  })
})
