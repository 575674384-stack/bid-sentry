import { contextBridge } from 'electron'

export interface BidSentryApi {
  readonly apiVersion: 1
}

const api: BidSentryApi = Object.freeze({
  apiVersion: 1
})

contextBridge.exposeInMainWorld('bidSentry', api)

declare global {
  interface Window {
    bidSentry: BidSentryApi
  }
}
