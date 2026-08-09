const REVISION_ELEMENTS = new Set([
  'cellDel',
  'cellIns',
  'cellMerge',
  'customXmlDelRangeStart',
  'customXmlInsRangeStart',
  'customXmlMoveFromRangeStart',
  'customXmlMoveToRangeStart',
  'del',
  'ins',
  'moveFrom',
  'moveFromRangeStart',
  'moveTo',
  'moveToRangeStart',
  'numberingChange',
  'pPrChange',
  'rPrChange',
  'sectPrChange',
  'tblGridChange',
  'tblPrChange',
  'tcPrChange',
  'trPrChange'
])

export function isWordIdentityElement(localName: string | null): boolean {
  return localName === 'comment' || REVISION_ELEMENTS.has(localName ?? '')
}
