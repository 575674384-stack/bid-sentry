import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as yazl from 'yazl'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { readDocumentSnapshot } from '../../src/core/documents/documentReader'
import { readDocxArchive, writeDocxArchive } from '../../src/core/documents/docx/archive'
import { findTemplateCandidates } from '../../src/core/generation/templateCandidates'
import { createFillPlan } from '../../src/core/generation/fieldPlan'
import type { DocumentSnapshot } from '../../src/shared/contracts'

/**
 * Regression coverage for the real-world tender DOCX incident: a 1.6 MiB
 * word/document.xml, directory entries in the package, Chinese localized
 * style ids, whitespace-spaced field labels and a template section without a
 * clean structural boundary. Fixtures are built from scratch — no real
 * document content is ever committed.
 */

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, recursiveOptions())))
})

function recursiveOptions(): { recursive: true; force: true } {
  return { recursive: true, force: true }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

function paragraph(text: string, styleId?: string): string {
  const style = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ''
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

async function writeRawDocx(
  filePath: string,
  parts: Readonly<Record<string, string>>,
  options: { includeDirectoryEntries?: boolean } = {}
): Promise<void> {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(CONTENT_TYPES, 'utf8'), '[Content_Types].xml')
  if (options.includeDirectoryEntries !== false) zip.addEmptyDirectory('_rels/')
  zip.addBuffer(Buffer.from(RELS, 'utf8'), '_rels/.rels')
  if (options.includeDirectoryEntries !== false) zip.addEmptyDirectory('word/')
  for (const [name, contents] of Object.entries(parts)) {
    zip.addBuffer(Buffer.from(contents, 'utf8'), name)
  }
  zip.end()
  const chunks: Buffer[] = []
  await new Promise<void>((resolvePromise, rejectPromise) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('error', rejectPromise)
    zip.outputStream.on('end', () => resolvePromise())
  })
  await writeFile(filePath, Buffer.concat(chunks))
}

describe('real-world DOCX compatibility', () => {
  it('accepts a main document part larger than the marker pre-flight cap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-bigdoc-'))
    directories.push(directory)
    const filePath = join(directory, 'big.docx')
    // Random hex keeps the compression ratio realistic; repeated prose would
    // trip the zip-bomb ratio guard instead of exercising the size path.
    const filler = (await import('node:crypto')).randomBytes(700_000).toString('hex')
    await writeRawDocx(filePath, { 'word/document.xml': documentXml(paragraph(filler)) })

    const snapshot = await createInputSnapshot(filePath)

    expect(snapshot.documentType).toBe('docx')
    expect(snapshot.size).toBe((await stat(filePath)).size)
    const document = await readDocumentSnapshot(filePath, 'docx')
    expect(document.nodes.length).toBeGreaterThan(0)
  })

  it('round-trips packages that contain directory entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-dirs-'))
    directories.push(directory)
    const source = join(directory, 'dirs.docx')
    await writeRawDocx(source, {
      'word/document.xml': documentXml(paragraph('目录条目回归'))
    })

    const archive = await readDocxArchive(source)
    expect(archive.entries.some((entry) => entry.isDirectory)).toBe(true)

    const rewritten = join(directory, 'rewritten.docx')
    await writeDocxArchive(archive, rewritten)
    const reread = await readDocxArchive(rewritten)
    expect(reread.entries.some((entry) => entry.isDirectory)).toBe(true)
    const main = reread.entries.find((entry) => entry.name === 'word/document.xml')
    expect(main?.contents.toString('utf8')).toContain('目录条目回归')
  })

  it('detects headings from localized style ids and demotes junk outline levels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-styles-'))
    directories.push(directory)
    const filePath = join(directory, 'styles.docx')
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="a3"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyJunk"><w:outlineLvl w:val="3"/></w:style>
</w:styles>`
    await writeRawDocx(filePath, {
      'word/document.xml': documentXml(
        [
          paragraph('第八章 投标文件格式', '1'),
          paragraph('资格证明文件', 'a3'),
          paragraph('', 'BodyJunk'),
          paragraph(
            '这是一个被误标了大纲级别的正文段落，它的长度远远超过任何合理标题会有的长度，继续补充内容使其超过六十个字符的阈值，因此必须被降级为普通段落处理。',
            'BodyJunk'
          ),
          paragraph('普通正文。')
        ].join('')
      ),
      'word/styles.xml': styles
    })

    const document = await readDocumentSnapshot(filePath, 'docx')
    const headings = document.nodes.filter((node) => node.kind === 'heading')
    expect(headings.map((node) => [node.level, node.text])).toEqual([
      [1, '第八章 投标文件格式'],
      [2, '资格证明文件']
    ])
  })

  it('falls back to numbered-title heuristics when no heading styles exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-heuristic-'))
    directories.push(directory)
    const filePath = join(directory, 'plain.docx')
    await writeRawDocx(filePath, {
      'word/document.xml': documentXml(
        [
          paragraph('第五节 招标投标各种文件格式'),
          paragraph('附件格式'),
          paragraph('正文内容。')
        ].join('')
      )
    })

    const document = await readDocumentSnapshot(filePath, 'docx')
    const headings = document.nodes.filter((node) => node.kind === 'heading')
    expect(headings.map((node) => node.text)).toEqual(['第五节 招标投标各种文件格式', '附件格式'])
  })

  it('offers a document-end candidate when the tight section range is a divider page', async () => {
    const document = snapshotWithNodes([
      heading('h-1', '第一章 招标公告', 1),
      paragraphNode('p-1', '正文。'),
      heading('h-2', '第五节 招标投标各种文件格式', 2),
      heading('h-3', '第六节 图纸和技术资料', 2),
      heading('h-4', '投标资格送审文件', 1),
      paragraphNode('p-2', '企业名称：________________'),
      heading('h-5', '投 标 书', 1),
      paragraphNode('p-3', '法定 代表人：________________')
    ])

    const candidates = findTemplateCandidates(document)

    const loose = candidates.find((candidate) => candidate.endNodeId === 'p-3')
    expect(loose).toBeDefined()
    expect(loose?.startNodeId).toBe('h-2')
    expect(loose?.reasons.join('')).toContain('人工核对')
  })

  it('matches whitespace-spaced and synonymous labels without blocking on leftover blanks', () => {
    const document = snapshotWithNodes([
      heading('h-1', '投标文件格式', 1),
      cell('cell-0-0-0', '企业名称'),
      cell('cell-0-0-1', ''),
      cell('cell-0-1-0', '法定 代表人'),
      cell('cell-0-1-1', ''),
      paragraphNode('p-1', '签字：________________')
    ])
    const candidate = findTemplateCandidates(document)[0]
    expect(candidate).toBeDefined()

    const plan = createFillPlan(document, candidate!, {
      bidderName: '示例建设有限公司',
      unifiedSocialCreditCode: '',
      address: '',
      legalRepresentative: '张三',
      authorizedRepresentative: '',
      contact: '',
      phone: '',
      email: '',
      projectName: '',
      sectionName: '',
      compilationDate: '',
      extraFields: []
    })

    expect(plan.unknownRequired).toBe(0)
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'bidderName',
          targetNodeId: 'cell-0-0-1',
          value: '示例建设有限公司'
        }),
        expect.objectContaining({
          label: 'legalRepresentative',
          targetNodeId: 'cell-0-1-1',
          value: '张三'
        })
      ])
    )
    // The leftover 签字 blank is reported for manual completion, not a blocker.
    expect(plan.unknownFields.map((node) => node.nodeId)).toContain('p-1')
  })
})

function heading(nodeId: string, text: string, level: number) {
  return {
    nodeId,
    kind: 'heading' as const,
    text,
    anchor: {
      nodeId,
      kind: 'heading' as const,
      label: '标题',
      excerpt: text,
      digest: 'a'.repeat(64)
    },
    level
  }
}

function paragraphNode(nodeId: string, text: string) {
  return {
    nodeId,
    kind: 'paragraph' as const,
    text,
    anchor: {
      nodeId,
      kind: 'paragraph' as const,
      label: '段落',
      excerpt: text,
      digest: 'a'.repeat(64)
    }
  }
}

function cell(nodeId: string, text: string) {
  return {
    nodeId,
    kind: 'cell' as const,
    text,
    anchor: {
      nodeId,
      kind: 'cell' as const,
      label: '单元格',
      excerpt: text,
      digest: 'a'.repeat(64)
    }
  }
}

function snapshotWithNodes(nodes: DocumentSnapshot['nodes']): DocumentSnapshot {
  return {
    schemaVersion: 1,
    documentType: 'docx',
    displayName: 'synthetic.docx',
    hasTextLayer: true,
    nodes,
    textLength: nodes.reduce((total, node) => total + node.text.length, 0)
  }
}
