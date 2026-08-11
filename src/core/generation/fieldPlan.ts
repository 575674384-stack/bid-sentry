import { createHash } from 'node:crypto'
import {
  FillPlanSchema,
  GenerationUserFormSchema,
  type FieldAction,
  type GenerationUserForm,
  type TemplateCandidate
} from '../../shared/contracts'
import type { DocumentSnapshot } from '../../shared/contracts'
import { DocumentSafetyError } from '../documents/fileSafety'
import { applyFieldAction } from './docx'
import { knownLabelPattern, literalLabelPattern, KNOWN_LABEL_SYNONYMS } from './labels'
import { extractFacts, normalize, type ReviewEntity } from '../review/entities'

// Whitespace-tolerant, synonym-rich label patterns shared with the OOXML
// writer (src/core/generation/labels.ts is the single source of truth).
const FORM_FIELD_LABELS: Record<KnownFormField, string> = Object.fromEntries(
  [
    'bidderName',
    'unifiedSocialCreditCode',
    'address',
    'legalRepresentative',
    'authorizedRepresentative',
    'contact',
    'phone',
    'email',
    'projectName',
    'sectionName',
    'compilationDate'
  ].map((field) => [field, knownLabelPattern(field) as string])
) as Record<KnownFormField, string>

type KnownFormField = Exclude<keyof GenerationUserForm, 'extraFields'>

const FIXED_VALUE_LABELS: Record<FixedValueKind, string> = Object.fromEntries(
  ['duration', 'qualityStandard', 'projectNumber'].map((field) => [
    field,
    knownLabelPattern(field) as string
  ])
) as Record<FixedValueKind, string>

/**
 * Labels that deterministic code already owns: the eleven well-known form
 * fields plus the tender-fixed values filled from tender evidence. Local slot
 * detection and AI suggestions must never re-offer them as dynamic fields.
 */
const KNOWN_TEMPLATE_LABEL_PATTERNS: readonly string[] = [
  ...Object.values(FORM_FIELD_LABELS),
  ...Object.values(FIXED_VALUE_LABELS)
]

const MAX_DETECTED_SLOT_LABEL_CHARS = 30

/** True when a template slot label is already owned by a deterministic rule. */
export function isKnownTemplateLabel(label: string): boolean {
  const text = label.trim()
  if (!text) return false
  return KNOWN_TEMPLATE_LABEL_PATTERNS.some((pattern) =>
    new RegExp(`^(?:${pattern})$`, 'iu').test(text)
  )
}

/**
 * Labels of template slots the local rules can see but no deterministic rule
 * fills: explicit `标签：____` blanks and table label cells with an empty
 * adjacent value cell. Well-known and tender-fixed labels are excluded.
 */
export function detectTemplateSlots(
  document: DocumentSnapshot,
  candidate: TemplateCandidate
): string[] {
  const selected = selectedNodes(document, candidate)
  const fieldNodes = selected.filter((node) => node.kind !== 'table')
  const labels: string[] = []
  const seen = new Set<string>()
  const push = (raw: string): void => {
    const label = raw.trim()
    if (!label || label.length > MAX_DETECTED_SLOT_LABEL_CHARS) return
    const key = normalize(label)
    if (!key || seen.has(key) || isKnownTemplateLabel(label)) return
    seen.add(key)
    labels.push(label)
  }
  const slotPattern = new RegExp(
    `(?:^|[\\s|])([^\\s：:，,;；|_＿.．·…—–<>\\[\\]【】]{1,${MAX_DETECTED_SLOT_LABEL_CHARS}}?)\\s*[：:]\\s*${EMPTY_SLOT_PATTERN}(?=\\s|$|[，,;；])`,
    'giu'
  )
  for (const node of fieldNodes) {
    for (const match of node.text.matchAll(slotPattern)) {
      push(match[1] ?? '')
    }
    if (
      node.kind === 'cell' &&
      node.text.trim().length > 0 &&
      !/[：:]/u.test(node.text) &&
      adjacentCellValueTarget(fieldNodes, node)
    ) {
      push(node.text)
    }
  }
  return labels.slice(0, 30)
}

export function createFillPlan(
  document: DocumentSnapshot,
  candidate: TemplateCandidate,
  userForm: GenerationUserForm,
  inputSha256 = '0'.repeat(64)
) {
  // Normalize through the wire schema so the plan digest binds the exact
  // canonical form (including extraFields) regardless of caller-side defaults.
  const form = GenerationUserFormSchema.parse(userForm)
  const selected = selectedNodes(document, candidate)
  if (selected.length === 0) throw new DocumentSafetyError('INVALID_REQUEST')
  const actions: FieldAction[] = []
  const formEntries: Array<[KnownFormField, string]> = [
    ['bidderName', form.bidderName],
    ['unifiedSocialCreditCode', form.unifiedSocialCreditCode],
    ['address', form.address],
    ['legalRepresentative', form.legalRepresentative],
    ['authorizedRepresentative', form.authorizedRepresentative],
    ['contact', form.contact],
    ['phone', form.phone],
    ['email', form.email],
    ['projectName', form.projectName],
    ['sectionName', form.sectionName],
    ['compilationDate', form.compilationDate]
  ]
  const unresolvedFields: Array<{ field: string; label: string }> = []
  // Tables expose both an aggregate `table-*` node and concrete `cell-*`
  // nodes.  A fill action must target the concrete cell so the OOXML writer
  // can apply it without rewriting the entire table.
  const fieldNodes = selected.filter((node) => node.kind !== 'table')
  for (const [field, value] of formEntries) {
    if (!value) continue
    const explicitTarget = fieldNodes.find((node) => hasExplicitFormSlot(node, field))
    if (!explicitTarget) {
      unresolvedFields.push({ field, label: displayFieldLabel(field) })
      continue
    }
    const target = adjacentCellValueTarget(fieldNodes, explicitTarget) ?? explicitTarget
    actions.push({
      fieldId: createHash('sha256')
        .update(`${field}|${target.nodeId}|${value}`)
        .digest('hex')
        .slice(0, 24),
      label: field,
      targetNodeId: target.nodeId,
      action: 'replace',
      source: 'user-form',
      value
    })
  }
  // Dynamic extra fields participate in slot matching by normalized label.
  // They never block generation: an unmatched extra field is reported exactly
  // like an unmatched optional known field.
  for (const extra of form.extraFields) {
    if (!extra.value) continue
    const explicitTarget = findExtraFieldTarget(fieldNodes, extra.label)
    if (!explicitTarget) {
      unresolvedFields.push({ field: extra.key, label: extra.label })
      continue
    }
    actions.push({
      fieldId: createHash('sha256')
        .update(`extra|${extra.key}|${explicitTarget.nodeId}|${extra.value}`)
        .digest('hex')
        .slice(0, 24),
      label: extra.label,
      targetNodeId: explicitTarget.nodeId,
      action: 'replace',
      source: 'user-form',
      value: extra.value
    })
  }
  for (const fixed of fixedValues(document)) {
    const target = fieldNodes.find(
      (node) =>
        node.nodeId !== fixed.entity.nodeId &&
        !actions.some(
          (action) =>
            action.source === 'tender-fixed' &&
            action.label === fixed.kind &&
            action.targetNodeId === node.nodeId
        ) &&
        new RegExp(fixed.labelPattern, 'iu').test(node.text) &&
        /(?:____+|待填写|请填写|\[\[.+?\]\]|【请填写)/u.test(node.text)
    )
    if (!target) continue
    actions.push({
      fieldId: createHash('sha256')
        .update(
          `tender-fixed|${fixed.kind}|${target.nodeId}|${fixed.entity.nodeId}|${fixed.entity.value}`
        )
        .digest('hex')
        .slice(0, 24),
      label: fixed.kind,
      targetNodeId: target.nodeId,
      action: 'replace',
      source: 'tender-fixed',
      value: fixed.entity.value,
      evidenceNodeId: fixed.entity.nodeId
    })
  }
  for (const node of fieldNodes) {
    const markerPattern = /(?:\[\[|【请插入[：:]?)(图片|证照|签章|印章|照片)(?:\]\]|】)/giu
    for (const [markerIndex, marker] of [...node.text.matchAll(markerPattern)].entries())
      actions.push({
        fieldId: createHash('sha256')
          .update(`placeholder|${node.nodeId}|${markerIndex}`)
          .digest('hex')
          .slice(0, 24),
        label: marker[1] ?? '图片',
        targetNodeId: node.nodeId,
        action: 'placeholder',
        source: 'placeholder',
        placeholderType: marker[1]?.includes('证照')
          ? 'certificate'
          : marker[1]?.includes('签') || marker[1]?.includes('章')
            ? 'signature'
            : 'image'
      })
  }
  const unknownFields = fieldNodes.filter((node) =>
    /(?:\[\[.+?\]\]|____+|待填写|请填写)/u.test(
      actions
        .filter((action) => action.targetNodeId === node.nodeId)
        .reduce((text, action) => applyFieldAction(text, action), node.text)
    )
  )
  // Real qualification templates are full of blanks the bidder completes by
  // hand (签字、盖章、日期、证照编号…). Those stay visible in the plan as
  // 待人工填写 items and never block generation. The only hard blocker is the
  // required bidder identity having no explicit slot — filling it into a
  // guessed position would be a wrong-value defect, not a draft gap.
  const unknownRequired = unresolvedFields.filter(({ field }) => field === 'bidderName').length
  const planWithoutDigest = {
    schemaVersion: 1,
    planId: cryptoRandomUuid(),
    inputSha256,
    candidateId: candidate.candidateId,
    userForm: form,
    actions,
    unknownRequired,
    unknownFields: unknownFields.map((node) => ({
      nodeId: node.nodeId,
      text: node.text.slice(0, 500)
    })),
    unresolvedFields,
    warnings: [
      ...(document.documentType === 'pdf'
        ? ['PDF 模板将结构化重建为 DOCX，可能存在版式差异。']
        : ['DOCX 生成不会保留原自定义属性（如存在），请在输出前确认。']),
      ...unresolvedFields.map(({ label }) => `未找到“${label}”的明确模板字段，已阻止猜测填充。`)
    ]
  }
  const planDigest = createHash('sha256')
    .update(
      JSON.stringify({
        inputSha256,
        candidateId: candidate.candidateId,
        userForm: form,
        actions,
        unknownRequired,
        warnings: planWithoutDigest.warnings
      })
    )
    .digest('hex')
  return FillPlanSchema.parse({ ...planWithoutDigest, planDigest })
}

type FixedValueKind = 'duration' | 'qualityStandard' | 'projectNumber'

interface FixedValue {
  kind: FixedValueKind
  labelPattern: string
  entity: ReviewEntity
}

function fixedValues(document: DocumentSnapshot): FixedValue[] {
  const facts = extractFacts(document)
  return [
    ...facts.durations.map((entity) => ({ kind: 'duration' as const, entity })),
    ...facts.qualityTerms.map((entity) => ({ kind: 'qualityStandard' as const, entity })),
    ...facts.projectNumbers.map((entity) => ({ kind: 'projectNumber' as const, entity }))
  ].map((fixed) => ({ ...fixed, labelPattern: FIXED_VALUE_LABELS[fixed.kind] }))
}

function selectedNodes(document: DocumentSnapshot, candidate: TemplateCandidate) {
  const start = document.nodes.findIndex((node) => node.nodeId === candidate.startNodeId)
  const end = document.nodes.findIndex((node) => node.nodeId === candidate.endNodeId)
  if (start < 0 || end < start) return []
  return document.nodes.slice(start, end + 1)
}

function fieldLabel(field: KnownFormField): string {
  return FORM_FIELD_LABELS[field] ?? field
}

/** User-facing label for a known field (regex sources must never reach UI). */
function displayFieldLabel(field: KnownFormField): string {
  return KNOWN_LABEL_SYNONYMS[field]?.[0] ?? field
}

function hasExplicitFormSlot(
  node: DocumentSnapshot['nodes'][number],
  field: KnownFormField
): boolean {
  const text = node.text.trim()
  if (!text) return false
  const label = fieldLabel(field)
  if (new RegExp(`^(?:${label})$`, 'iu').test(text)) return true
  return new RegExp(
    `(?:^|[\\s|])(?:${label})\\s*[：:]\\s*${EMPTY_SLOT_PATTERN}(?=\\s|$|[，,;；])`,
    'iu'
  ).test(text)
}

/**
 * Slot lookup for a dynamic extra field: either the whole node is the label
 * (normalized: trim, width- and whitespace-insensitive) or the node contains
 * `标签：____`. Matching mirrors the known-field rules so the OOXML writer can
 * replace the value by label afterwards.
 */
function findExtraFieldTarget(
  nodes: readonly DocumentSnapshot['nodes'][number][],
  label: string
): DocumentSnapshot['nodes'][number] | undefined {
  const pattern = literalLabelPattern(label)
  const normalizedLabel = normalize(label)
  if (!pattern || !normalizedLabel) return undefined
  const explicit = nodes.find((node) => {
    const text = node.text.trim()
    if (!text) return false
    if (normalize(text) === normalizedLabel) return true
    return new RegExp(
      `(?:^|[\\s|])(?:${pattern})\\s*[：:]\\s*${EMPTY_SLOT_PATTERN}(?=\\s|$|[，,;；])`,
      'iu'
    ).test(text)
  })
  if (!explicit) return undefined
  return adjacentCellValueTarget(nodes, explicit) ?? explicit
}

const EMPTY_SLOT_PATTERN =
  '(?:[_＿.．·…]{2,}|[-—–]{2,}|待填写|请填写|请提供|填写|空白|未填写|未提供|<[^>]+>|\\[\\[[^\\]]+\\]\\]|【[^】]+】)'

function adjacentCellValueTarget(
  nodes: readonly DocumentSnapshot['nodes'][number][],
  labelNode: DocumentSnapshot['nodes'][number]
): DocumentSnapshot['nodes'][number] | undefined {
  if (labelNode.kind !== 'cell') return undefined
  const match = /^cell-(\d+)-(\d+)-(\d+)$/u.exec(labelNode.nodeId)
  if (!match) return undefined
  const nextCellId = `cell-${match[1]}-${match[2]}-${Number(match[3]) + 1}`
  const nextCell = nodes.find((node) => node.nodeId === nextCellId)
  if (!nextCell || nextCell.kind !== 'cell') return undefined
  return /^(?:\s*|_+|待填写|请填写|\[\[.+?\]\])$/u.test(nextCell.text) ? nextCell : undefined
}

function cryptoRandomUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000'
}
