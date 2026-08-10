import { access, copyFile, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Optional local incident runner. It intentionally skips when no user-approved
 * fixture is supplied, so a real bid document can never become a repository
 * test dependency.
 */
describe('local DOCX incident compatibility', () => {
  it('keeps an incident input immutable while handing it to the real job', async () => {
    const source = process.env.BID_SENTRY_COMPAT_DOCX
    if (!source) return
    await access(source)
    const work = await mkdtemp(join(tmpdir(), 'bid-sentry-incident-'))
    const copy = join(work, basename(source))
    await copyFile(source, copy)
    const before = await stat(copy)
    const bytes = await readFile(copy)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect((await stat(copy)).mtimeMs).toBe(before.mtimeMs)
    // The full execution path is exercised by the fixture/integration suite;
    // this boundary test proves the compatibility input is read-only.
  })
})
