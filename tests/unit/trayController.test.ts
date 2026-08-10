import { describe, expect, it } from 'vitest'
import { WindowController } from '../../src/main/app/windowController'

describe('WindowController', () => {
  it('hides on close when enabled and shows when disabled', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>()
    let visible = true
    let prevented = false
    const window = {
      on: (event: string, listener: (value: { preventDefault(): void }) => void) =>
        listeners.set(event, listener),
      hide: () => {
        visible = false
      },
      show: () => {
        visible = true
      },
      focus: () => undefined,
      isVisible: () => visible,
      isDestroyed: () => false
    } as never
    const controller = new WindowController(window, {
      closeToTray: true,
      requestQuit: () => undefined
    })
    listeners.get('close')?.({
      preventDefault: () => {
        prevented = true
      }
    })
    expect(prevented).toBe(true)
    expect(visible).toBe(false)
    controller.setCloseToTray(false)
    expect(visible).toBe(true)
  })
})
