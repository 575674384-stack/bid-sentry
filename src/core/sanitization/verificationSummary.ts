import { createHash } from 'node:crypto'
import type { VerificationCheck, VerificationReport } from '../../shared/contracts'

export function aggregateVerification(
  verifications: readonly VerificationReport[]
): VerificationReport {
  const inputSha256 = createHash('sha256')
    .update(verifications.map((verification) => verification.inputSha256).join(':'))
    .digest('hex')
  const outputSha256 = createHash('sha256')
    .update(verifications.map((verification) => verification.outputSha256).join(':'))
    .digest('hex')
  const checks: VerificationCheck[] = verifications.flatMap((verification, fileIndex) =>
    verification.checks.map((check) => ({
      name: `file-${fileIndex + 1}:${check.name}`.slice(0, 200),
      status: check.status,
      message: check.message
    }))
  )
  return {
    schemaVersion: 1,
    status: 'passed',
    checks,
    inputSha256,
    outputSha256
  }
}
