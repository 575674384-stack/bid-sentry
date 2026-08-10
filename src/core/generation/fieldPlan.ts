import { createHash } from 'node:crypto'
import {
  FillPlanSchema,
  type FieldAction,
  type GenerationUserForm,
  type TemplateCandidate
} from '../../shared/contracts'
import type { DocumentSnapshot } from '../../shared/contracts'
import { DocumentSafetyError } from '../documents/fileSafety'
import { applyFieldAction } from './docx'
import { extractFacts, type ReviewEntity } from '../review/entities'

export function createFillPlan(
  document: DocumentSnapshot,
  candidate: TemplateCandidate,
  userForm: GenerationUserForm,
  inputSha256 = '0'.repeat(64)
) {
  const selected = selectedNodes(document, candidate)
  if (selected.length === 0) throw new DocumentSafetyError('INVALID_REQUEST')
  const actions: FieldAction[] = []
  const formEntries: Array<[keyof GenerationUserForm, string]> = [
    ['bidderName', userForm.bidderName],
    ['unifiedSocialCreditCode', userForm.unifiedSocialCreditCode],
    ['address', userForm.address],
    ['legalRepresentative', userForm.legalRepresentative],
    ['authorizedRepresentative', userForm.authorizedRepresentative],
    ['contact', userForm.contact],
    ['phone', userForm.phone],
    ['email', userForm.email],
    ['projectName', userForm.projectName],
    ['sectionName', userForm.sectionName],
    ['compilationDate', userForm.compilationDate]
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
      unresolvedFields.push({ field, label: fieldLabel(field) })
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
  // Only the required bidder identity blocks generation when its confirmed
  // value has no explicit target. Optional form values may legitimately be
  // absent from a particular qualification template; report them without
  // guessing a similar field or blocking the otherwise safe draft.
  const unknownRequired =
    unknownFields.length + unresolvedFields.filter(({ field }) => field === 'bidderName').length
  const planWithoutDigest = {
    schemaVersion: 1,
    planId: cryptoRandomUuid(),
    inputSha256,
    candidateId: candidate.candidateId,
    userForm,
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
        userForm,
        actions,
        unknownRequired,
        warnings: planWithoutDigest.warnings
      })
    )
    .digest('hex')
  return FillPlanSchema.parse({ ...planWithoutDigest, planDigest })
}

interface FixedValue {
  kind: 'duration' | 'qualityStandard' | 'projectNumber'
  labelPattern: string
  entity: ReviewEntity
}

function fixedValues(document: DocumentSnapshot): FixedValue[] {
  const facts = extractFacts(document)
  return [
    ...facts.durations.map((entity) => ({
      kind: 'duration' as const,
      labelPattern: '工期|服务期|交货期|合同期限',
      entity
    })),
    ...facts.qualityTerms.map((entity) => ({
      kind: 'qualityStandard' as const,
      labelPattern: '质量标准|质量要求|验收标准',
      entity
    })),
    ...facts.projectNumbers.map((entity) => ({
      kind: 'projectNumber' as const,
      labelPattern: '项目编号|招标编号|标段编号|项目代码',
      entity
    }))
  ]
}

function selectedNodes(document: DocumentSnapshot, candidate: TemplateCandidate) {
  const start = document.nodes.findIndex((node) => node.nodeId === candidate.startNodeId)
  const end = document.nodes.findIndex((node) => node.nodeId === candidate.endNodeId)
  if (start < 0 || end < start) return []
  return document.nodes.slice(start, end + 1)
}

function fieldLabel(field: keyof GenerationUserForm): string {
  return (
    (
      {
        bidderName: '投标人(?:名称)?|投标单位(?:名称)?|bidder\\s+name',
        unifiedSocialCreditCode: '统一社会信用代码',
        address: '地址',
        legalRepresentative: '法定代表人',
        authorizedRepresentative: '授权代表',
        contact: '联系人',
        phone: '电话|手机',
        email: '邮箱|电子邮件',
        projectName: '项目名称',
        sectionName: '标段',
        compilationDate: '编制日期'
      } as Record<keyof GenerationUserForm, string>
    )[field] ?? field
  )
}

function hasExplicitFormSlot(
  node: DocumentSnapshot['nodes'][number],
  field: keyof GenerationUserForm
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
