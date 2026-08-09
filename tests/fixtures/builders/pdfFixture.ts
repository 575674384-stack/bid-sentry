import { writeFile } from 'node:fs/promises'
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFRawStream,
  PDFString,
  StandardFonts
} from 'pdf-lib'

export const PDF_FIXTURE_VALUES = Object.freeze({
  author: 'Alice',
  creator: 'Bid Authoring Tool',
  producer: 'Synthetic PDF Producer',
  title: 'Original Tender Title',
  subject: 'Original Tender Subject',
  keywords: 'secret keywords',
  created: '2024-01-01T08:00:00.000Z',
  modified: '2024-01-02T09:30:00.000Z',
  bodyText: 'Bid document page content must remain unchanged.',
  annotationText: 'Synthetic review annotation',
  vendorXmpValue: 'KEEP-XMP-VENDOR-VALUE',
  attachmentName: 'evidence.bin'
})

export const PDF_FIXTURE_ATTACHMENT = Buffer.from('synthetic-attachment-payload', 'utf8')

const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

export interface PdfFixtureOptions {
  scanned?: boolean
  signed?: boolean
  signatureFieldOnly?: boolean
  signatureTypeOnly?: boolean
  byteRangeOnly?: boolean
  unsignedByteRangeText?: boolean
  encrypted?: boolean
  malformed?: boolean
  malformedXmp?: boolean
  compressedXmp?: boolean
  xmpFilterForm?: 'name' | 'array' | 'abbreviated' | 'indirect-array-item'
  xmpDecodeParmsForm?:
    'none' | 'null' | 'empty-dictionary' | 'array-null' | 'array-empty-dictionary' | 'non-default'
}

export async function writePdfFixture(
  filePath: string,
  options: PdfFixtureOptions = {}
): Promise<void> {
  if (options.malformed) {
    await writeFile(filePath, '%PDF-1.7\nsynthetic-corrupt-document\n%%EOF\n', {
      flag: 'wx',
      mode: 0o600
    })
    return
  }

  const document = await PDFDocument.create({ updateMetadata: false })
  const font = await document.embedFont(StandardFonts.Helvetica)
  const image = await document.embedPng(FIXTURE_PNG)
  const firstPage = document.addPage([420, 595])
  const secondPage = document.addPage([500, 700])
  firstPage.drawImage(image, { x: 40, y: 500, width: 40, height: 40 })
  const byteRangeLookalike = options.unsignedByteRangeText
    ? 'Unsigned note /ByteRange [0 1 2 3] only'
    : ''
  if (!options.scanned) {
    firstPage.drawText(
      byteRangeLookalike
        ? `${PDF_FIXTURE_VALUES.bodyText} ${byteRangeLookalike}`
        : PDF_FIXTURE_VALUES.bodyText,
      { x: 40, y: 450, size: 12, font }
    )
    secondPage.drawText('Second page content remains unchanged.', {
      x: 40,
      y: 640,
      size: 12,
      font
    })
  } else {
    secondPage.drawImage(image, { x: 100, y: 550, width: 80, height: 80 })
  }

  addAnnotation(document, firstPage.node, byteRangeLookalike)
  await document.attach(PDF_FIXTURE_ATTACHMENT, PDF_FIXTURE_VALUES.attachmentName, {
    mimeType: 'application/octet-stream',
    description: 'Synthetic attachment for structural verification'
  })
  addInfoMetadata(document, byteRangeLookalike)
  addXmpMetadata(document, options, byteRangeLookalike)
  document.context.trailerInfo.ID = document.context.obj([
    PDFHexString.of('00112233445566778899aabbccddeeff'),
    PDFHexString.of('ffeeddccbbaa99887766554433221100')
  ])
  if (options.signed) addSyntheticSignature(document)
  if (options.signatureFieldOnly) addSyntheticSignatureField(document)
  if (options.signatureTypeOnly) addSyntheticSignatureDictionary(document)
  if (options.byteRangeOnly) addSyntheticByteRange(document)
  if (options.encrypted) addSyntheticEncryptionMarker(document)

  const bytes = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false
  })
  const outputBytes = byteRangeLookalike
    ? Buffer.concat([bytes, Buffer.from(`\n% ${byteRangeLookalike}\n`, 'ascii')])
    : bytes
  await writeFile(filePath, outputBytes, { flag: 'wx', mode: 0o600 })
}

function addInfoMetadata(document: PDFDocument, byteRangeLookalike: string): void {
  const values = PDF_FIXTURE_VALUES
  document.setAuthor(values.author)
  document.setCreator(values.creator)
  document.setProducer(values.producer)
  document.setTitle(values.title)
  document.setSubject(values.subject)
  document.setKeywords(values.keywords.split(' '))
  document.setCreationDate(new Date(values.created))
  document.setModificationDate(new Date(values.modified))
  const info = document.context.lookup(document.context.trailerInfo.Info, PDFDict)
  info.set(PDFName.of('Trapped'), PDFName.of('True'))
  info.set(
    PDFName.of('VendorPrivate'),
    PDFString.of(byteRangeLookalike || 'KEEP-INFO-VENDOR-VALUE')
  )
}

function addXmpMetadata(
  document: PDFDocument,
  options: PdfFixtureOptions,
  byteRangeLookalike: string
): void {
  const xml = Buffer.from(xmpXml(options.malformedXmp === true, byteRangeLookalike), 'utf8')
  const stream =
    options.compressedXmp === false
      ? PDFRawStream.of(
          document.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: xml.length }),
          xml
        )
      : document.context.flateStream(xml, { Type: 'Metadata', Subtype: 'XML' })
  configureXmpStream(document, stream, options)
  document.catalog.set(PDFName.of('Metadata'), document.context.register(stream))
}

function configureXmpStream(
  document: PDFDocument,
  stream: PDFRawStream,
  options: PdfFixtureOptions
): void {
  if (options.compressedXmp !== false) {
    const filterName = options.xmpFilterForm === 'abbreviated' ? 'Fl' : 'FlateDecode'
    if (options.xmpFilterForm === 'array') {
      stream.dict.set(PDFName.of('Filter'), document.context.obj([PDFName.of(filterName)]))
    } else if (options.xmpFilterForm === 'indirect-array-item') {
      const filterRef = document.context.register(PDFName.of(filterName))
      stream.dict.set(PDFName.of('Filter'), document.context.obj([filterRef]))
    } else {
      stream.dict.set(PDFName.of('Filter'), PDFName.of(filterName))
    }
  }

  switch (options.xmpDecodeParmsForm ?? 'none') {
    case 'none':
      break
    case 'null':
      stream.dict.set(PDFName.of('DecodeParms'), PDFNull)
      break
    case 'empty-dictionary':
      stream.dict.set(PDFName.of('DecodeParms'), document.context.obj({}))
      break
    case 'array-null':
      stream.dict.set(PDFName.of('DecodeParms'), document.context.obj([PDFNull]))
      break
    case 'array-empty-dictionary':
      stream.dict.set(PDFName.of('DecodeParms'), document.context.obj([document.context.obj({})]))
      break
    case 'non-default':
      stream.dict.set(PDFName.of('DecodeParms'), document.context.obj({ Predictor: 12 }))
      break
  }
}

function addAnnotation(document: PDFDocument, page: PDFDict, byteRangeLookalike: string): void {
  const annotation = document.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [40, 400, 60, 420],
    Contents: PDFString.of(byteRangeLookalike || PDF_FIXTURE_VALUES.annotationText),
    Name: 'Comment'
  })
  const annotationRef = document.context.register(annotation)
  const annotations = document.context.obj([annotationRef])
  page.set(PDFName.of('Annots'), annotations)
}

function addSyntheticSignature(document: PDFDocument): void {
  const signature = document.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 100, 200, 300],
    Contents: PDFHexString.of('00'.repeat(64))
  })
  const signatureRef = document.context.register(signature)
  const field = document.context.obj({
    FT: 'Sig',
    T: PDFString.of('SyntheticSignature'),
    V: signatureRef
  })
  const fieldRef = document.context.register(field)
  const acroForm = document.context.obj({ Fields: [fieldRef], SigFlags: 3 })
  document.catalog.set(PDFName.of('AcroForm'), document.context.register(acroForm))
}

function addSyntheticSignatureField(document: PDFDocument): void {
  const field = document.context.obj({
    FT: 'Sig',
    T: PDFString.of('SyntheticEmptySignatureField')
  })
  const fieldRef = document.context.register(field)
  const acroForm = document.context.obj({ Fields: [fieldRef], SigFlags: 1 })
  document.catalog.set(PDFName.of('AcroForm'), document.context.register(acroForm))
}

function addSyntheticSignatureDictionary(document: PDFDocument): void {
  const signature = document.context.obj({
    Type: 'Sig',
    Contents: PDFHexString.of('00'.repeat(64))
  })
  document.catalog.set(PDFName.of('SyntheticSignature'), document.context.register(signature))
}

function addSyntheticByteRange(document: PDFDocument): void {
  const signatureEvidence = document.context.obj({
    ByteRange: [0, 100, 200, 300],
    Contents: PDFHexString.of('00'.repeat(64))
  })
  document.catalog.set(
    PDFName.of('SyntheticSignatureEvidence'),
    document.context.register(signatureEvidence)
  )
}

function addSyntheticEncryptionMarker(document: PDFDocument): void {
  const encryption = document.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    Length: 40,
    O: PDFHexString.of('00'.repeat(32)),
    U: PDFHexString.of('11'.repeat(32)),
    P: -4
  })
  document.context.trailerInfo.Encrypt = document.context.register(encryption)
}

function xmpXml(malformed: boolean, byteRangeLookalike: string): string {
  const values = PDF_FIXTURE_VALUES
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
      xmlns:vendor="urn:bid-sentry:vendor"
      pdf:Producer="${values.producer}"
      pdf:Keywords="${values.keywords}"
      pdf:Trapped="True"
      xmp:CreatorTool="${values.creator}"
      xmp:CreateDate="${values.created}"
      xmp:ModifyDate="${values.modified}"
      xmp:MetadataDate="${values.modified}"
      xmpMM:DocumentID="uuid:123e4567-e89b-42d3-a456-426614174000"
      xmpMM:InstanceID="uuid:123e4567-e89b-42d3-a456-426614174001"
      vendor:Private="${byteRangeLookalike || values.vendorXmpValue}">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${values.title}</rdf:li></rdf:Alt></dc:title>
      <dc:subject><rdf:Bag><rdf:li>${values.subject}</rdf:li></rdf:Bag></dc:subject>
      <dc:creator><rdf:Seq><rdf:li>${values.author}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Original Description</rdf:li></rdf:Alt></dc:description>
      ${malformed ? '<vendor:Broken>&undefinedEntity;</vendor:Broken>' : ''}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}
