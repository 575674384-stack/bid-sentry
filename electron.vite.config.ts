import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    define: {
      __BID_SENTRY_E2E_BUILD__: JSON.stringify(process.env.BID_SENTRY_E2E === '1')
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/worker/index.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve('src/preload/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()]
  }
})
