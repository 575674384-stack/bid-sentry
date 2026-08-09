import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000

export class TaskRandomMapping {
  readonly #salt = randomBytes(32)
  readonly #values = new Map<string, string | number | boolean>()
  #destroyed = false

  constructor(private readonly now: () => number = Date.now) {}

  person(originalValue: string): string {
    return this.mapString('person', originalValue, () => `User-${randomToken(6)}`)
  }

  initials(originalValue: string): string {
    return this.mapString(
      'initials',
      originalValue,
      () => `${randomLetter()}${randomLetter()}`
    )
  }

  organization(originalValue: string): string {
    return this.mapString('organization', originalValue, () => `Org-${randomToken(6)}`)
  }

  description(originalValue: string): string {
    return this.mapString('description', originalValue, () => `Document-${randomToken(8)}`)
  }

  uuid(originalValue: string): string {
    return this.mapString('uuid', originalValue, randomUUID)
  }

  integer(originalValue: number): number {
    const key = this.keyFor('integer', originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'number') return existing

    let generated = randomInt(1, 2_147_483_647)
    if (generated === originalValue) generated = generated === 2_147_483_646 ? 1 : generated + 1
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

  timestamp(originalValue: string): string {
    return this.mapString('timestamp', originalValue, () => this.randomPastTimestamp())
  }

  timestampPair(
    createdOriginalValue: string,
    modifiedOriginalValue: string
  ): { created: string; modified: string } {
    const createdKey = this.keyFor('created-timestamp', createdOriginalValue)
    const modifiedKey = this.keyFor('modified-timestamp', modifiedOriginalValue)
    const existingCreated = this.#values.get(createdKey)
    const existingModified = this.#values.get(modifiedKey)

    if (typeof existingCreated === 'string' && typeof existingModified === 'string') {
      return { created: existingCreated, modified: existingModified }
    }

    const now = Math.floor(this.now() / 1_000) * 1_000
    const lowerBound = now - ONE_YEAR_MS
    const first = randomInt(lowerBound, now + 1)
    const second = randomInt(lowerBound, now + 1)
    const created = new Date(Math.min(first, second)).toISOString()
    const modified = new Date(Math.max(first, second)).toISOString()
    this.#values.set(createdKey, created)
    this.#values.set(modifiedKey, modified)
    return { created, modified }
  }

  destroy(): void {
    this.#values.clear()
    this.#salt.fill(0)
    this.#destroyed = true
  }

  private mapString(kind: string, originalValue: string, create: () => string): string {
    const key = this.keyFor(kind, originalValue)
    const existing = this.#values.get(key)
    if (typeof existing === 'string') return existing

    const generated = create()
    this.#values.set(key, generated)
    return generated
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
