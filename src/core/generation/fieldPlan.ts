import { createHash } from 'node:crypto'
import {
  FillPlanSchema,
  type FieldAction,
  type GenerationUserForm,
  type TemplateCandidate
} from '../../shared/contracts'
import type { DocumentSnapshot } from '../../shared/contracts'

export function createFillPlan(
  document: DocumentSnapshot,
  candidate: TemplateCandidate,
  userForm: GenerationUserForm,
  inputSha256 = '0'.repeat(64)
) {
  const selected = selectedNodes(document, candidate)
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
  for (const [field, value] of formEntries) {
    if (!value) continue
    const target =
      selected.find((node) => new RegExp(fieldLabel(field), 'iu').test(node.text)) ??
      selected.find((node) =>
        /投标人|统一社会信用代码|地址|法定代表人|授权代表|联系人|电话|邮箱|编制日期/iu.test(
          node.text
        )
      )
    if (!target) continue
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
  for (const node of selected) {
    const marker = /(?:\[\[|【请插入[：:]?)(图片|证照|签章|印章|照片)(?:\]\]|】)/iu.exec(node.text)
    if (marker)
      actions.push({
        fieldId: createHash('sha256')
          .update(`placeholder|${node.nodeId}`)
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
  const unknownRequired = selected.filter(
    (node) =>
      /(?:\[\[.+?\]\]|____+|待填写|请填写)/u.test(node.text) &&
      !actions.some((action) => action.targetNodeId === node.nodeId)
  ).length
  return FillPlanSchema.parse({
    schemaVersion: 1,
    planId: cryptoRandomUuid(),
    inputSha256,
    candidateId: candidate.candidateId,
    userForm,
    actions,
    unknownRequired,
    warnings:
      document.documentType === 'pdf' ? ['PDF 模板将结构化重建为 DOCX，可能存在版式差异。'] : []
  })
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
        bidderName: '投标人|投标单位',
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

function cryptoRandomUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000'
}
