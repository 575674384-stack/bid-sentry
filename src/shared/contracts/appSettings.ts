import { z } from 'zod'

export const APP_SETTINGS_SCHEMA_VERSION = 3 as const

export const OutputModeSchema = z.enum(['suffix', 'overwrite'])

/**
 * File-name suffix appended to sanitized outputs. Path separators, Windows
 * device characters and control characters are rejected so the suffix can
 * never escape the input file's own directory.
 */
export const OutputSuffixSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\\/:*?"<>|\p{Cc}]+$/u, '后缀不能包含路径或特殊字符。')
  .refine((value) => !value.endsWith('.') && value !== '.' && value !== '..', {
    message: '后缀不能以点号结尾。'
  })

export const DEFAULT_OUTPUT_SUFFIX = '_已清洗'

/** User-owned company facts used to prefill the qualification form. */
export const CompanyProfileSchema = z
  .object({
    bidderName: z.string().trim().max(300).default(''),
    unifiedSocialCreditCode: z.string().trim().max(100).default(''),
    address: z.string().trim().max(500).default(''),
    legalRepresentative: z.string().trim().max(100).default(''),
    authorizedRepresentative: z.string().trim().max(100).default(''),
    contact: z.string().trim().max(100).default(''),
    phone: z.string().trim().max(100).default(''),
    email: z.string().trim().max(200).default('')
  })
  .strict()

export const AppSettingsSchema = z
  .object({
    schemaVersion: z.literal(APP_SETTINGS_SCHEMA_VERSION),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4),
    closeToTray: z.boolean(),
    checkUpdatesOnStartup: z.boolean(),
    outputMode: OutputModeSchema,
    outputSuffix: OutputSuffixSchema,
    companyProfile: CompanyProfileSchema
  })
  .strict()

export type OutputMode = z.infer<typeof OutputModeSchema>
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
