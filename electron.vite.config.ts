import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version?: unknown
  }
).version
if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
  throw new Error('package.json version is missing')
}

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
    plugins: [react()],
    define: {
      __BID_SENTRY_VERSION__: JSON.stringify(packageVersion)
    }
  }
})
