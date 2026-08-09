import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  unlink: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lstat: fsMocks.lstat,
  unlink: fsMocks.unlink
}))

import { rollbackPublishedFiles } from '../../src/core/documents/fileSafety'
import { fileSystemIdentityFromBigInts } from '../../src/core/documents/pathSafety'

const DEVICE = 7n
const MODE = 0o100600n
const FIRST_UNSAFE_INODE = 9_007_199_254_740_992n

beforeEach(() => {
  fsMocks.lstat.mockReset()
  fsMocks.unlink.mockReset()
})

describe('exact published-file identity', () => {
  it('preserves an adjacent user inode above Number.MAX_SAFE_INTEGER', async () => {
    fsMocks.lstat.mockResolvedValue(regularFileStats(FIRST_UNSAFE_INODE + 1n))

    await expect(
      rollbackPublishedFiles([
        {
          absolutePath: '/safe/output.docx',
          identity: fileSystemIdentityFromBigInts(DEVICE, FIRST_UNSAFE_INODE, MODE)
        }
      ])
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })

    expect(fsMocks.lstat).toHaveBeenCalledWith('/safe/output.docx', { bigint: true })
    expect(fsMocks.unlink).not.toHaveBeenCalled()
  })

  it('unlinks only the exact bigint identity recorded at publication', async () => {
    fsMocks.lstat.mockResolvedValue(regularFileStats(FIRST_UNSAFE_INODE))

    await rollbackPublishedFiles([
      {
        absolutePath: '/safe/output.docx',
        identity: fileSystemIdentityFromBigInts(DEVICE, FIRST_UNSAFE_INODE, MODE)
      }
    ])

    expect(fsMocks.unlink).toHaveBeenCalledOnce()
    expect(fsMocks.unlink).toHaveBeenCalledWith('/safe/output.docx')
  })
})

function regularFileStats(inode: bigint) {
  return {
    dev: DEVICE,
    ino: inode,
    mode: MODE,
    isFile: () => true,
    isSymbolicLink: () => false
  }
}
