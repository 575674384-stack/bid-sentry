import { Buffer } from 'node:buffer'
import { readdir } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { extractFile, listPackage } from '@electron/asar'

const releaseDirectory = resolve('release')
const requiredEntries = Object.freeze([
  'out/main/index.js',
  'out/main/worker.js',
  'out/preload/index.cjs',
  'out/renderer/index.html',
  'package.json',
  'LICENSE'
])
const forbiddenPathPatterns = Object.freeze([
  /(^|\/)test-apikey\.md$/iu,
  /(^|\/)\.env(?:\.|$)/iu,
  /(^|\/)settings\.v1\.json$/iu,
  /(^|\/)secrets\.v1\.bin$/iu,
  /(^|\/)tests?(\/|$)/iu,
  /(^|\/)docs\/aegis(\/|$)/iu,
  /(^|\/)test-results(\/|$)/iu,
  /(^|\/)playwright-report(\/|$)/iu,
  /(^|\/)coverage(\/|$)/iu,
  /(^|\/)\.bid-sentry-tmp-/iu,
  /e2eHarness/iu,
  /\.map$/iu,
  /\.log$/iu
])
const forbiddenContentMarkers = Object.freeze([
  'BID_SENTRY_E2E',
  'test-apikey.md',
  'synthetic-e2e-key'
])
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.mjs', '.txt'])

const archives = await findAppArchives(releaseDirectory)
if (archives.length === 0) {
  throw new Error('No packaged app.asar was found under release/. Build a package first.')
}

for (const archive of archives) {
  auditArchive(archive)
  process.stdout.write(`Package audit passed: ${relative(process.cwd(), archive)}\n`)
}

async function findAppArchives(directory) {
  const results = []
  await visit(directory)
  return results.sort()

  async function visit(currentDirectory) {
    let entries
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
      } else if (entry.isFile() && entry.name === 'app.asar') {
        results.push(absolutePath)
      }
    }
  }
}

function auditArchive(archivePath) {
  const rawEntries = listPackage(archivePath, { isPack: false })
  const entries = rawEntries.map(normalizeArchivePath)
  const entrySet = new Set(entries)

  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry))
  if (missingEntries.length > 0) {
    throw new Error(
      `${relative(process.cwd(), archivePath)} is missing required entries: ${missingEntries.join(', ')}`
    )
  }

  const forbiddenEntries = entries.filter((entry) =>
    forbiddenPathPatterns.some((pattern) => pattern.test(entry))
  )
  if (forbiddenEntries.length > 0) {
    throw new Error(
      `${relative(process.cwd(), archivePath)} contains ${forbiddenEntries.length} forbidden entries: ${summarizeEntries(forbiddenEntries)}`
    )
  }

  for (const entry of entries) {
    if (!entry.startsWith('out/') || !textExtensions.has(extname(entry).toLowerCase())) continue

    const contents = extractFile(archivePath, entry)
    for (const marker of forbiddenContentMarkers) {
      if (contents.includes(Buffer.from(marker))) {
        throw new Error(
          `${relative(process.cwd(), archivePath)} contains forbidden production marker in ${entry}`
        )
      }
    }
  }
}

function normalizeArchivePath(value) {
  return value
    .split(sep)
    .join('/')
    .replace(/^\/+|\/+$/gu, '')
}

function summarizeEntries(entries) {
  const visibleEntries = entries.slice(0, 20)
  const omittedCount = entries.length - visibleEntries.length
  return `${visibleEntries.join(', ')}${omittedCount > 0 ? `, … (${omittedCount} more)` : ''}`
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error
}
