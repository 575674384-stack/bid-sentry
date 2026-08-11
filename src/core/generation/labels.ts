/**
 * Shared label vocabulary for qualification-template field matching. Real
 * tender templates write labels with arbitrary internal spacing
 * (`法定 代表人`, `联系 电 话`) and with many synonyms (`企业名称`,
 * `单位名称`, …), so every pattern is whitespace-tolerant and built from a
 * synonym list — one source of truth for slot detection, fill planning and
 * the OOXML writer.
 */

export function escapeRegExpLiteral(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Regex source matching a literal label. NFKC-normalized, regex metacharacters
 * escaped, and arbitrary whitespace allowed between characters so
 * `注册 资本` and `注册资本` are the same slot label.
 */
export function literalLabelPattern(label: string): string {
  const characters = [...label.normalize('NFKC')].filter(
    (character) => !/[\s\u3000]/u.test(character)
  )
  return characters.map(escapeRegExpLiteral).join('[\\s\u3000]*')
}

/** Synonyms for the known form fields and tender-fixed values. */
export const KNOWN_LABEL_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  bidderName: [
    '投标人名称',
    '投标单位名称',
    '投标人全称',
    '投标单位全称',
    '企业名称',
    '单位名称',
    '申请人名称',
    '投标人',
    '投标单位',
    'Bidder Name',
    'Bidder'
  ],
  unifiedSocialCreditCode: ['统一社会信用代码', '信用代码', 'Unified Social Credit Code'],
  address: ['注册地址', '企业地址', '详细地址', '地址', 'Address'],
  legalRepresentative: ['法定代表人', '法人代表', 'Legal Representative'],
  authorizedRepresentative: ['授权代表', '委托代理人', '授权委托人'],
  contact: ['项目联系人', '联系人', 'Contact Person', 'Contact'],
  phone: ['联系电话', '手机号码', '电话', '手机', 'Telephone', 'Phone', 'Tel'],
  email: ['电子邮箱', '电子邮件', '邮箱', 'E-mail', 'Email'],
  projectName: ['项目名称', '工程名称', 'Project Name'],
  sectionName: ['标段名称', '标段'],
  compilationDate: ['编制日期', '编制时间'],
  duration: ['工期', '服务期', '交货期', '合同期限'],
  qualityStandard: ['质量标准', '质量要求', '验收标准'],
  projectNumber: ['项目编号', '招标编号', '标段编号', '项目代码']
}

function synonymPattern(synonyms: readonly string[]): string {
  return [...synonyms]
    .sort((left, right) => right.length - left.length)
    .map(literalLabelPattern)
    .join('|')
}

const KNOWN_LABEL_PATTERN_CACHE = new Map<string, string>()

/** Whitespace-tolerant regex source for a known field/tender-fixed label. */
export function knownLabelPattern(field: string): string | undefined {
  const cached = KNOWN_LABEL_PATTERN_CACHE.get(field)
  if (cached) return cached
  const synonyms = KNOWN_LABEL_SYNONYMS[field]
  if (!synonyms) return undefined
  const pattern = synonymPattern(synonyms)
  KNOWN_LABEL_PATTERN_CACHE.set(field, pattern)
  return pattern
}

const ALL_KNOWN_PATTERN = synonymPattern(Object.values(KNOWN_LABEL_SYNONYMS).flat())

/** Regex source matching any known label; used for value-boundary lookaheads. */
export function allKnownLabelsPattern(): string {
  return ALL_KNOWN_PATTERN
}
