import { z } from 'zod'

export const DocumentTypeSchema = z.enum(['docx', 'pdf'])

const DecimalFileSystemValueSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u)

export const FileSystemIdentitySchema = z
  .object({
    device: DecimalFileSystemValueSchema,
    inode: DecimalFileSystemValueSchema,
    mode: DecimalFileSystemValueSchema
  })
  .strict()

export const WorkspacePublicationArtifactSchema = z
  .object({
    temporaryPath: z.string().min(1),
    outputPath: z.string().min(1),
    outputSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    identity: FileSystemIdentitySchema.optional()
  })
  .strict()

export const WorkspacePublicationSchema = z
  .object({
    artifacts: z.array(WorkspacePublicationArtifactSchema).min(1).max(20)
  })
  .strict()

export const TemporaryWorkspaceDescriptorSchema = z
  .object({
    rootPath: z.string().min(1),
    outputDirectory: z.string().min(1),
    rootIdentity: FileSystemIdentitySchema,
    outputDirectoryIdentity: FileSystemIdentitySchema,
    publication: WorkspacePublicationSchema.optional()
  })
  .strict()

export const InputSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    absolutePath: z.string().min(1),
    displayName: z.string().trim().min(1).max(255),
    documentType: DocumentTypeSchema,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    mtimeMs: z.number().nonnegative()
  })
  .strict()

export const ReportFileIdentitySchema = z
  .object({
    displayName: z.string().trim().min(1).max(255),
    documentType: DocumentTypeSchema,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()

export const MetadataFieldCategorySchema = z.enum([
  'person-identity',
  'organization',
  'application',
  'timestamp',
  'document-identifier',
  'description',
  'custom-property',
  'comment-identity',
  'revision-identity',
  'other'
])

export const MetadataValueTypeSchema = z.enum([
  'string',
  'initials',
  'organization',
  'integer',
  'number',
  'boolean',
  'timestamp',
  'uuid'
])

export const MetadataFieldDescriptorSchema = z
  .object({
    field: z.string().trim().min(1).max(200),
    category: MetadataFieldCategorySchema,
    valueType: MetadataValueTypeSchema,
    occurrences: z.number().int().positive(),
    action: z.enum(['randomize', 'preserve', 'warn'])
  })
  .strict()

const SafeDisplayValueSchema = z.string().max(2_000)

/** A single metadata occurrence shown only in the active preview. */
export const MetadataPreviewItemSchema = z
  .object({
    part: z.string().trim().min(1).max(200),
    locator: z.string().trim().min(1).max(300),
    field: z.string().trim().min(1).max(200),
    category: MetadataFieldCategorySchema,
    valueType: MetadataValueTypeSchema,
    occurrences: z.literal(1),
    action: z.enum(['randomize', 'preserve', 'warn']),
    originalDisplayValue: SafeDisplayValueSchema,
    replacementDisplayValue: SafeDisplayValueSchema.nullable()
  })
  .strict()

export type DocumentType = z.infer<typeof DocumentTypeSchema>
export type FileSystemIdentity = z.infer<typeof FileSystemIdentitySchema>
export type WorkspacePublicationArtifact = z.infer<typeof WorkspacePublicationArtifactSchema>
export type WorkspacePublication = z.infer<typeof WorkspacePublicationSchema>
export type TemporaryWorkspaceDescriptor = z.infer<typeof TemporaryWorkspaceDescriptorSchema>
export type InputSnapshot = z.infer<typeof InputSnapshotSchema>
export type ReportFileIdentity = z.infer<typeof ReportFileIdentitySchema>
export type MetadataFieldCategory = z.infer<typeof MetadataFieldCategorySchema>
export type MetadataValueType = z.infer<typeof MetadataValueTypeSchema>
export type MetadataFieldDescriptor = z.infer<typeof MetadataFieldDescriptorSchema>
export type MetadataPreviewItem = z.infer<typeof MetadataPreviewItemSchema>
