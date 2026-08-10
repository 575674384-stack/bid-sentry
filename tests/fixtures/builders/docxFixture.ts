import { createWriteStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import * as yazl from 'yazl'

const FIXTURE_DATE = new Date('2024-01-02T03:04:06.000Z')
const TRAVERSAL_SAFE_NAME = 'xx/escape.xml'
const TRAVERSAL_UNSAFE_NAME = '../escape.xml'
const BACKSLASH_SAFE_NAME = 'word/backslash.txt'
const BACKSLASH_UNSAFE_NAME = 'word\\backslash.txt'

export const DOCX_FIXTURE_VALUES = Object.freeze({
  person: 'Alice',
  initials: 'AL',
  organization: 'Acme Tendering Ltd',
  hyperlinkBase: 'C:\\Users\\Alice\\TenderProject',
  created: '2024-01-01T08:00:00.000Z',
  modified: '2024-01-02T09:30:00.000Z',
  commentText: '请保留评论正文。',
  bodyText: '投标文件正文必须保持不变。',
  tableText: '表格内容保持不变',
  headerText: '页眉内容',
  footerText: '页脚内容',
  secondHeaderText: '第二节页眉内容',
  secondFooterText: '第二节页脚内容',
  sensitiveCustomName: 'Customer-Acme-Secret-Property',
  unsupportedCustomValue: 'UNSUPPORTED-CUSTOM-VALUE'
})

export const DOCX_FIXTURE_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

export interface DocxFixtureOptions {
  plainZip?: boolean
  macroEnabled?: boolean
  signedDocument?: boolean
  externalMainRelationship?: boolean
  brokenDocumentRelationships?: boolean
  missingRelationshipTarget?: boolean
  malformedMetadataXml?: boolean
  emptyCreator?: boolean
  duplicateEntry?: boolean
  traversalEntry?: boolean
  backslashEntry?: boolean
  compressionBomb?: boolean
  encryptedEntry?: boolean
  symbolicLinkEntry?: boolean
  foreignCustomValueNamespace?: boolean
  escapingRelationshipTarget?: boolean
  encodedEscapingRelationshipTarget?: boolean
  doubleEncodedRelationshipTarget?: boolean
  orphanRelationshipPart?: boolean
  distinctManager?: boolean
  qualificationTemplate?: boolean
  splitBidderNameCells?: boolean
  structuredDocumentTag?: boolean
  rootUnrelatedAttachment?: boolean
  externalDocumentRelationship?: boolean
  notesWithMedia?: boolean
  multiSection?: boolean
}

export async function writeDocxFixture(
  filePath: string,
  options: DocxFixtureOptions = {}
): Promise<void> {
  const zipFile = new yazl.ZipFile()

  if (options.plainZip) {
    addBuffer(zipFile, 'readme.txt', 'ordinary ZIP, not a DOCX')
  } else {
    addDocxEntries(zipFile, options)
  }

  zipFile.end()
  await writeZipFile(zipFile, filePath)

  if (options.traversalEntry) {
    await patchEntryName(filePath, TRAVERSAL_SAFE_NAME, TRAVERSAL_UNSAFE_NAME)
  }
  if (options.backslashEntry) {
    await patchEntryName(filePath, BACKSLASH_SAFE_NAME, BACKSLASH_UNSAFE_NAME)
  }
  if (options.encryptedEntry) {
    await patchEncryptedFlags(filePath)
  }
  if (options.symbolicLinkEntry) {
    await patchSymbolicLinkEntry(filePath, 'word/styles.xml')
  }
}

function addDocxEntries(zipFile: yazl.ZipFile, options: DocxFixtureOptions): void {
  addBuffer(
    zipFile,
    '[Content_Types].xml',
    contentTypesXml(
      options.macroEnabled === true,
      options.signedDocument === true,
      options.notesWithMedia === true,
      options.multiSection === true
    )
  )
  addBuffer(
    zipFile,
    '_rels/.rels',
    rootRelationshipsXml(
      options.externalMainRelationship === true,
      options.signedDocument === true,
      options.rootUnrelatedAttachment === true
    )
  )
  addBuffer(
    zipFile,
    'docProps/core.xml',
    options.malformedMetadataXml
      ? corePropertiesXml(options.emptyCreator === true).replace(
          'Original Bid Title',
          '&undefinedEntity;'
        )
      : corePropertiesXml(options.emptyCreator === true)
  )
  addBuffer(zipFile, 'docProps/app.xml', appPropertiesXml(options.distinctManager === true))
  addBuffer(
    zipFile,
    'docProps/custom.xml',
    customPropertiesXml(options.foreignCustomValueNamespace === true)
  )
  addBuffer(zipFile, 'word/document.xml', documentXml(options))
  addBuffer(
    zipFile,
    'word/_rels/document.xml.rels',
    options.brokenDocumentRelationships
      ? '<Relationships><broken>'
      : documentRelationshipsXml(options)
  )
  addBuffer(zipFile, 'word/styles.xml', stylesXml())
  addBuffer(zipFile, 'word/comments.xml', commentsXml())
  addBuffer(zipFile, 'word/header1.xml', headerXml())
  addBuffer(zipFile, 'word/footer1.xml', footerXml())
  if (options.multiSection) {
    addBuffer(zipFile, 'word/header2.xml', secondHeaderXml())
    addBuffer(zipFile, 'word/footer2.xml', secondFooterXml())
  }
  if (options.notesWithMedia) {
    addBuffer(zipFile, 'word/footnotes.xml', footnotesXml())
    addBuffer(zipFile, 'word/_rels/footnotes.xml.rels', footnotesRelationshipsXml())
    zipFile.addBuffer(DOCX_FIXTURE_IMAGE, 'word/media/note1.png', {
      mtime: FIXTURE_DATE,
      mode: 0o600,
      compress: false
    })
    zipFile.addBuffer(Buffer.from('unselected-note-media'), 'word/media/note2.png', {
      mtime: FIXTURE_DATE,
      mode: 0o600,
      compress: false
    })
  }
  zipFile.addBuffer(DOCX_FIXTURE_IMAGE, 'word/media/image1.png', {
    mtime: FIXTURE_DATE,
    mode: 0o600,
    compress: false
  })
  if (options.rootUnrelatedAttachment) addBuffer(zipFile, 'word/media/unrelated.png', 'unrelated')

  if (options.macroEnabled) {
    zipFile.addBuffer(Buffer.from('synthetic-vba-placeholder'), 'word/vbaProject.bin', {
      mtime: FIXTURE_DATE,
      mode: 0o600,
      compress: false
    })
  }
  if (options.signedDocument) {
    addBuffer(zipFile, '_xmlsignatures/origin.sigs', '<SignatureOrigin/>')
    addBuffer(zipFile, '_xmlsignatures/sig1.xml', '<SyntheticSignature/>')
    addBuffer(
      zipFile,
      '_xmlsignatures/_rels/origin.sigs.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSignature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature" Target="sig1.xml"/></Relationships>`
    )
  }
  if (options.duplicateEntry) {
    addBuffer(zipFile, 'word/styles.xml', stylesXml())
  }
  if (options.traversalEntry) {
    addBuffer(zipFile, TRAVERSAL_SAFE_NAME, '<escape/>')
  }
  if (options.backslashEntry) {
    addBuffer(zipFile, BACKSLASH_SAFE_NAME, 'non-conformant ZIP entry name')
  }
  if (options.escapingRelationshipTarget) {
    addBuffer(zipFile, 'evil.xml', '<escape-target/>')
  }
  if (options.encodedEscapingRelationshipTarget) {
    addBuffer(zipFile, 'word/..%2F..%2Fevil.xml', '<encoded-escape-target/>')
  }
  if (options.doubleEncodedRelationshipTarget) {
    addBuffer(zipFile, 'word/%2e%2e/%2e%2e/evil.xml', '<double-encoded-escape-target/>')
  }
  if (options.orphanRelationshipPart) {
    addBuffer(
      zipFile,
      'ghost/_rels/missing.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOrphan" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="../../word/styles.xml"/></Relationships>`
    )
  }
  if (options.compressionBomb) {
    zipFile.addBuffer(Buffer.alloc(2 * 1024 * 1024), 'word/compression-bomb.bin', {
      mtime: FIXTURE_DATE,
      mode: 0o600,
      compress: true
    })
  }
}

function addBuffer(zipFile: yazl.ZipFile, name: string, contents: string): void {
  zipFile.addBuffer(Buffer.from(contents, 'utf8'), name, {
    mtime: FIXTURE_DATE,
    mode: 0o600,
    compress: true
  })
}

async function writeZipFile(zipFile: yazl.ZipFile, filePath: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
    zipFile.outputStream.on('error', rejectPromise)
    output.on('error', rejectPromise)
    output.on('close', resolvePromise)
    zipFile.outputStream.pipe(output)
  })
}

function contentTypesXml(
  macroEnabled: boolean,
  signedDocument: boolean,
  notesWithMedia: boolean,
  multiSection: boolean
): string {
  const mainContentType = macroEnabled
    ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="${mainContentType}"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  ${multiSection ? '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}
  ${notesWithMedia ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
  ${signedDocument ? '<Override PartName="/_xmlsignatures/origin.sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/><Override PartName="/_xmlsignatures/sig1.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/>' : ''}
</Types>`
}

function rootRelationshipsXml(
  externalMainRelationship: boolean,
  signedDocument: boolean,
  rootUnrelatedAttachment: boolean
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  ${externalMainRelationship ? '<Relationship Id="rIdExternalMain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/document.xml" TargetMode="External"/>' : ''}
  ${signedDocument ? '<Relationship Id="rIdSignatureOrigin" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="_xmlsignatures/origin.sigs"/>' : ''}
  ${rootUnrelatedAttachment ? '<Relationship Id="rIdUnrelated" Type="http://schemas.openxmlformats.org/package/2006/relationships/thumbnail" Target="word/media/unrelated.png"/>' : ''}
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`
}

function corePropertiesXml(emptyCreator: boolean): string {
  const values = DOCX_FIXTURE_VALUES
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Original Bid Title</dc:title>
  <dc:subject>Original Bid Subject</dc:subject>
  <dc:creator>${emptyCreator ? '' : values.person}</dc:creator>
  <cp:keywords>secret,keywords</cp:keywords>
  <dc:description>Original Description</dc:description>
  <cp:lastModifiedBy>${values.person}</cp:lastModifiedBy>
  <cp:revision>7</cp:revision>
  <cp:category>Original Category</cp:category>
  <cp:contentStatus>Draft</cp:contentStatus>
  <dc:identifier>123e4567-e89b-42d3-a456-426614174000</dc:identifier>
  <dcterms:created xsi:type="dcterms:W3CDTF">${values.created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${values.modified}</dcterms:modified>
  <cp:lastPrinted>2024-01-03T10:00:00.000Z</cp:lastPrinted>
</cp:coreProperties>`
}

function appPropertiesXml(distinctManager: boolean): string {
  const values = DOCX_FIXTURE_VALUES
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Template>Normal.dotm</Template>
  <HyperlinkBase>${values.hyperlinkBase}</HyperlinkBase>
  <TotalTime>42</TotalTime>
  <Pages>9</Pages>
  <Words>1234</Words>
  <Characters>6789</Characters>
  <CharactersWithSpaces>7000</CharactersWithSpaces>
  <Lines>88</Lines>
  <Paragraphs>32</Paragraphs>
  <Application>Microsoft Office Word</Application>
  <AppVersion>16.0000</AppVersion>
  <Company>${values.organization}</Company>
  <Manager>${distinctManager ? 'Bob' : values.person}</Manager>
</Properties>`
}

function customPropertiesXml(foreignValueNamespace: boolean): string {
  const values = DOCX_FIXTURE_VALUES
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="TextProp"><vt:lpwstr>Original Custom Text</vt:lpwstr></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="IntProp"><vt:i4>314</vt:i4></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="7" name="Int8Prop"><vt:i1>-12</vt:i1></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="8" name="UInt8Prop"><vt:ui1>200</vt:ui1></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="BoolProp"><vt:bool>true</vt:bool></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="5" name="DateProp"><vt:filetime>2024-01-04T10:00:00.000Z</vt:filetime></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="9" name="NumberProp"><vt:r8>123.5</vt:r8></property>
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="6" name="${values.sensitiveCustomName}"><vt:vector size="1" baseType="lpwstr"><vt:lpwstr>${values.unsupportedCustomValue}</vt:lpwstr></vt:vector></property>
  ${foreignValueNamespace ? '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="10" name="ForeignInt"><foreign:i1 xmlns:foreign="urn:foreign">12</foreign:i1></property>' : ''}
</Properties>`
}

function documentXml(options: DocxFixtureOptions): string {
  const values = DOCX_FIXTURE_VALUES
  const firstSectionBoundary = options.multiSection
    ? '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:pPr><w:r><w:t>选中模板第一节结束</w:t></w:r></w:p>'
    : ''
  const finalSectionProperties = options.multiSection
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader2"/><w:footerReference w:type="default" r:id="rIdFooter2"/></w:sectPr>'
    : '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    ${options.qualificationTemplate ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>资格审查投标文件格式</w:t></w:r>${options.notesWithMedia ? '<w:r><w:footnoteReference w:id="1"/></w:r>' : ''}</w:p>` : ''}
    ${options.qualificationTemplate && !options.splitBidderNameCells ? '<w:p><w:r><w:t>投标人名称：________________</w:t></w:r></w:p>' : ''}
    ${options.qualificationTemplate ? '<w:p><w:r><w:drawing><wp:inline r:embed="rIdImage"><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="Synthetic image"/><a:graphic/></wp:inline></w:drawing></w:r></w:p>' : ''}
    <w:p><w:r><w:t>${values.bodyText}</w:t></w:r></w:p>
    ${options.qualificationTemplate && options.splitBidderNameCells ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>投标人名称</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>' : ''}
    <w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>${values.tableText}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p>
      <w:commentRangeStart w:id="0"/>
      <w:ins w:id="1" w:author="${values.person}" w:date="2024-01-05T11:00:00.000Z"><w:r><w:t>修订插入内容</w:t></w:r></w:ins>
      <w:commentRangeEnd w:id="0"/>
      <w:r><w:commentReference w:id="0"/></w:r>
    </w:p>
    ${options.qualificationTemplate && options.structuredDocumentTag ? '<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>受控模板内容</w:t></w:r></w:p></w:sdtContent></w:sdt>' : ''}
    ${firstSectionBoundary}
    ${options.qualificationTemplate ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>其他投标文件正文（范围外）</w:t></w:r>${options.notesWithMedia ? '<w:r><w:footnoteReference w:id="2"/></w:r>' : ''}</w:p>` : ''}
    ${finalSectionProperties}
  </w:body>
</w:document>`
}

function documentRelationshipsXml(options: DocxFixtureOptions): string {
  const imageTarget = options.escapingRelationshipTarget
    ? '../../evil.xml'
    : options.encodedEscapingRelationshipTarget
      ? '..%2F..%2Fevil.xml'
      : options.doubleEncodedRelationshipTarget
        ? '%252e%252e/%252e%252e/evil.xml'
        : options.missingRelationshipTarget
          ? 'media/missing.png'
          : 'media/image1.png'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageTarget}"/>
  <Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  ${options.multiSection ? '<Relationship Id="rIdHeader2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/><Relationship Id="rIdFooter2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>' : ''}
  ${options.notesWithMedia ? '<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' : ''}
  ${options.externalDocumentRelationship === false ? '' : '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/reference" TargetMode="External"/>'}
</Relationships>`
}

function footnotesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:footnote w:id="-1"><w:p/></w:footnote><w:footnote w:id="0"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Selected note</w:t></w:r><w:r><w:drawing r:embed="rIdNoteImage1"/></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Unselected note</w:t></w:r><w:r><w:drawing r:embed="rIdNoteImage2"/></w:r></w:p></w:footnote></w:footnotes>`
}

function footnotesRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNoteImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/note1.png"/><Relationship Id="rIdNoteImage2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/note2.png"/></Relationships>`
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
}

function commentsXml(): string {
  const values = DOCX_FIXTURE_VALUES
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="${values.person}" w:initials="${values.initials}" w:date="2024-01-05T11:00:00.000Z"><w:p><w:r><w:t>${values.commentText}</w:t></w:r></w:p></w:comment></w:comments>`
}

function headerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${DOCX_FIXTURE_VALUES.headerText}</w:t></w:r></w:p></w:hdr>`
}

function footerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${DOCX_FIXTURE_VALUES.footerText}</w:t></w:r></w:p></w:ftr>`
}

function secondHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${DOCX_FIXTURE_VALUES.secondHeaderText}</w:t></w:r></w:p></w:hdr>`
}

function secondFooterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${DOCX_FIXTURE_VALUES.secondFooterText}</w:t></w:r></w:p></w:ftr>`
}

async function patchEntryName(filePath: string, from: string, to: string): Promise<void> {
  const source = Buffer.from(from, 'utf8')
  const replacement = Buffer.from(to, 'utf8')
  if (source.length !== replacement.length) throw new Error('ZIP entry patch names must match.')

  const bytes = await readFile(filePath)
  let offset = 0
  let replacements = 0
  while ((offset = bytes.indexOf(source, offset)) >= 0) {
    replacement.copy(bytes, offset)
    offset += replacement.length
    replacements += 1
  }
  if (replacements < 2) throw new Error('ZIP entry name was not found in both headers.')
  await writeFile(filePath, bytes)
}

async function patchEncryptedFlags(filePath: string): Promise<void> {
  const bytes = await readFile(filePath)
  patchHeaderFlags(bytes, 0x04034b50, 6)
  patchHeaderFlags(bytes, 0x02014b50, 8)
  await writeFile(filePath, bytes)
}

function patchHeaderFlags(bytes: Buffer, signature: number, flagOffset: number): void {
  let matched = false
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (bytes.readUInt32LE(offset) !== signature) continue
    bytes.writeUInt16LE(bytes.readUInt16LE(offset + flagOffset) | 0x1, offset + flagOffset)
    matched = true
  }
  if (!matched) throw new Error('ZIP header signature was not found.')
}

async function patchSymbolicLinkEntry(filePath: string, entryName: string): Promise<void> {
  const bytes = await readFile(filePath)
  let matched = false
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
    const nameLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name !== entryName) continue
    bytes.writeUInt16LE(0x0314, offset + 4)
    bytes.writeUInt32LE((0o120777 << 16) >>> 0, offset + 38)
    matched = true
    break
  }
  if (!matched) throw new Error('ZIP entry for symbolic-link patch was not found.')
  await writeFile(filePath, bytes)
}
