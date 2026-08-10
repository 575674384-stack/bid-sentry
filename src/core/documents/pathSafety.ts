import { lstat, realpath } from 'node:fs/promises'
import { join, parse, resolve, sep, win32 } from 'node:path'
import { FileSystemIdentitySchema, type FileSystemIdentity } from '../../shared/contracts/documents'

export interface ResolvedFileSystemPath {
  canonicalPath: string
  identity: FileSystemIdentity
}

export async function resolvePathIdentityWithoutSymbolicLinks(
  filePath: string
): Promise<ResolvedFileSystemPath> {
  const absolutePath = resolve(filePath)
  const before = await readPathTrace(absolutePath)
  const firstCanonicalPath = await realpath(absolutePath)
  const after = await readPathTrace(absolutePath)
  const canonicalPath = await realpath(absolutePath)
  const canonicalTrace = await readPathTrace(canonicalPath)

  if (
    !samePathTrace(before, after) ||
    normalizeFileIdentity(firstCanonicalPath) !== normalizeFileIdentity(canonicalPath) ||
    !samePathObject(after.at(-1), canonicalTrace.at(-1))
  ) {
    throw new Error('The path changed while it was being validated.')
  }

  return {
    canonicalPath,
    identity: pathTraceIdentity(canonicalTrace.at(-1))
  }
}

export async function resolvePathWithoutSymbolicLinks(filePath: string): Promise<string> {
  return (await resolvePathIdentityWithoutSymbolicLinks(filePath)).canonicalPath
}

interface PathTraceEntry {
  device: bigint
  inode: bigint
  mode: bigint
}

async function readPathTrace(absolutePath: string): Promise<PathTraceEntry[]> {
  const { root } = parse(absolutePath)
  let currentPath = root
  const trace: PathTraceEntry[] = []

  await appendPathIdentity(trace, currentPath)

  for (const component of absolutePath.slice(root.length).split(sep).filter(Boolean)) {
    currentPath = join(currentPath, component)
    await appendPathIdentity(trace, currentPath)
  }

  return trace
}

async function appendPathIdentity(trace: PathTraceEntry[], filePath: string): Promise<void> {
  const info = await lstat(filePath, { bigint: true })
  if (info.isSymbolicLink()) {
    throw new Error('Symbolic path components are not allowed.')
  }
  trace.push({ device: info.dev, inode: info.ino, mode: info.mode })
}

function samePathTrace(left: readonly PathTraceEntry[], right: readonly PathTraceEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => samePathObject(entry, right[index]))
  )
}

function samePathObject(
  left: PathTraceEntry | undefined,
  right: PathTraceEntry | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode
  )
}

function pathTraceIdentity(entry: PathTraceEntry | undefined): FileSystemIdentity {
  if (!entry) throw new Error('The path identity could not be resolved.')
  return fileSystemIdentityFromBigInts(entry.device, entry.inode, entry.mode)
}

export function fileSystemIdentityFromBigInts(
  device: bigint,
  inode: bigint,
  mode: bigint
): FileSystemIdentity {
  return FileSystemIdentitySchema.parse({
    device: device.toString(10),
    inode: inode.toString(10),
    mode: mode.toString(10)
  })
}

export function sameFileSystemIdentity(
  left: FileSystemIdentity,
  right: FileSystemIdentity,
  platform: NodeJS.Platform = process.platform
): boolean {
  // Windows reports the permission/type bits inconsistently across path and
  // hard-link stats.  Device + file ID are the stable identity there; callers
  // independently require the expected regular-file/directory type.  POSIX
  // keeps the mode comparison as an additional guard against type changes.
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    (platform === 'win32' || left.mode === right.mode)
  )
}

export function normalizeFileIdentity(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalized = platform === 'win32' ? win32.resolve(filePath) : resolve(filePath)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}
