import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000

export class TaskRandomMapping {
  readonly #salt = randomBytes(32)
  readonly #values = new Map<string, string | number | boolean>()
  readonly #usedStringValues = new Map<string, Set<string>>()
  #destroyed = false

  constructor(private readonly now: () => number = Date.now) {}

  person(originalValue: string): string {
    return this.mapString('person', originalValue, () => `User-${randomToken(6)}`)
  }

  initials(originalValue: string): string {
    return this.mapString(
      'initials',
      originalValue,
      () => `${randomLetter()}${randomLetter()}${randomLetter()}${randomLetter()}`
    )
  }

  organization(originalValue: string): string {
    return this.mapString('organization', originalValue, () => `Org-${randomToken(6)}`)
  }

  application(originalValue: string): string {
    return this.mapString('application', originalValue, () => `App-${randomToken(6)}`)
  }

  description(originalValue: string): string {
    return this.mapString('description', originalValue, () => `Document-${randomToken(8)}`)
  }

  uuid(originalValue: string): string {
    return this.mapString('uuid', originalValue, randomUUID)
  }

  integer(originalValue: number): number {
    return this.integerInRange(String(originalValue), 1, 2_147_483_646)
  }

  integerInRange(originalValue: string, min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError('随机整数范围无效。')
    }
    const key = this.keyFor(`integer:${min}:${max}`, originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'number') return existing

    let generated = randomInt(min, max + 1)
    if (String(generated) === originalValue.trim() && min < max) {
      generated = generated === max ? min : generated + 1
    }
    this.#values.set(key, generated)
    return generated
  }

  number(originalValue: number): number {
    if (!Number.isFinite(originalValue)) throw new RangeError('原数值无效。')
    const key = this.keyFor('number', originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'number') return existing

    let generated = randomInt(-100_000_000, 100_000_001) / 100
    if (Object.is(generated, originalValue)) generated += 0.01
    this.#values.set(key, generated)
    return generated
  }

  boolean(originalValue: boolean): boolean {
    const key = this.keyFor('boolean', originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'boolean') return existing

    const generated = !originalValue
    this.#values.set(key, generated)
    return generated
  }

  enumValue(originalValue: string, allowedValues: readonly string[]): string {
    const candidates = [...new Set(allowedValues)].filter((value) => value !== originalValue)
    if (candidates.length === 0 || candidates.some((value) => value.length === 0)) {
      throw new RangeError('随机枚举范围无效。')
    }
    return this.mapString(`enum:${allowedValues.join('|')}`, originalValue, () => {
      return candidates[randomInt(0, candidates.length)]!
    })
  }

  timestamp(originalValue: string): string {
    return this.mapString('timestamp', originalValue, () => this.randomPastTimestamp())
  }

  destroy(): void {
    this.#values.clear()
    this.#usedStringValues.clear()
    this.#salt.fill(0)
    this.#destroyed = true
  }

  private mapString(kind: string, originalValue: string, create: () => string): string {
    const key = this.keyFor(kind, originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'string') return existing

    const used = this.#usedStringValues.get(kind) ?? new Set<string>()
    this.#usedStringValues.set(kind, used)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const generated = create()
      if (generated === originalValue || used.has(generated)) continue
      used.add(generated)
      this.#values.set(key, generated)
      return generated
    }
    throw new Error('无法生成唯一随机映射。')
  }

  private randomPastTimestamp(): string {
    const now = Math.floor(this.now() / 1_000) * 1_000
    return new Date(randomInt(now - ONE_YEAR_MS, now + 1)).toISOString()
  }

  private keyFor(kind: string, originalValue: string | number | boolean): string {
    if (this.#destroyed) {
      throw new Error('随机映射已销毁。')
    }
    return createHmac('sha256', this.#salt)
      .update(kind)
      .update('\0')
      .update(typeof originalValue)
      .update('\0')
      .update(String(originalValue))
      .digest('hex')
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('hex').toUpperCase()
}

function randomLetter(): string {
  return String.fromCharCode(65 + randomInt(0, 26))
}
