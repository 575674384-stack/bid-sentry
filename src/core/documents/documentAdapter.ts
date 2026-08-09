import type {
  AppError,
  DocumentType,
  InputSnapshot,
  MetadataFieldDescriptor,
  VerificationReport
} from '../../shared/contracts'

export interface DocumentInspection {
  documentType: DocumentType
  fields: MetadataFieldDescriptor[]
  warnings: string[]
  blockers: AppError[]
}

export interface DocumentSanitizationPlan {
  documentType: DocumentType
  inputSha256: string
  fields: MetadataFieldDescriptor[]
}

export interface DocumentAdapter<
  TInspection extends DocumentInspection = DocumentInspection,
  TPlan extends DocumentSanitizationPlan = DocumentSanitizationPlan
> {
  readonly documentType: DocumentType
  inspect(input: InputSnapshot, signal: AbortSignal): Promise<TInspection>
  createPlan(input: InputSnapshot, inspection: TInspection, signal: AbortSignal): Promise<TPlan>
  sanitizeToTemp(
    input: InputSnapshot,
    plan: TPlan,
    temporaryPath: string,
    signal: AbortSignal
  ): Promise<void>
  verify(
    input: InputSnapshot,
    plan: TPlan,
    temporaryPath: string,
    signal: AbortSignal
  ): Promise<VerificationReport>
}
