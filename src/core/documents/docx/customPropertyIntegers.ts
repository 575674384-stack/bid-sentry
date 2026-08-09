export interface CustomIntegerBounds {
  validationMin: bigint
  validationMax: bigint
  generationMin: number
  generationMax: number
}

const INTEGER_BOUNDS: Readonly<Record<string, CustomIntegerBounds>> = Object.freeze({
  i1: bounds(-128n, 127n, -128, 127),
  i2: bounds(-32_768n, 32_767n, -32_768, 32_767),
  i4: bounds(-2_147_483_648n, 2_147_483_647n, -2_147_483_648, 2_147_483_647),
  int: bounds(-2_147_483_648n, 2_147_483_647n, -2_147_483_648, 2_147_483_647),
  i8: bounds(
    -9_223_372_036_854_775_808n,
    9_223_372_036_854_775_807n,
    -2_147_483_648,
    2_147_483_647
  ),
  ui1: bounds(0n, 255n, 0, 255),
  ui2: bounds(0n, 65_535n, 0, 65_535),
  ui4: bounds(0n, 4_294_967_295n, 0, 2_147_483_647),
  uint: bounds(0n, 4_294_967_295n, 0, 2_147_483_647),
  ui8: bounds(0n, 18_446_744_073_709_551_615n, 0, 2_147_483_647)
})

export function customIntegerBounds(localName: string): CustomIntegerBounds | null {
  return INTEGER_BOUNDS[localName] ?? null
}

export function isValidCustomInteger(value: string, integerBounds: CustomIntegerBounds): boolean {
  const normalized = value.trim()
  if (!/^-?\d+$/u.test(normalized)) return false
  try {
    const parsed = BigInt(normalized)
    return parsed >= integerBounds.validationMin && parsed <= integerBounds.validationMax
  } catch {
    return false
  }
}

function bounds(
  validationMin: bigint,
  validationMax: bigint,
  generationMin: number,
  generationMax: number
): CustomIntegerBounds {
  return { validationMin, validationMax, generationMin, generationMax }
}
