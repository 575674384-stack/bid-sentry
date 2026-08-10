import { describe, expect, it } from 'vitest'
import { TaskRandomMapping } from '../../src/core/sanitization/randomMapping'

const NOW = Date.parse('2026-08-09T12:00:00.000Z')
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000

describe('TaskRandomMapping', () => {
  it('generates non-empty type-safe privacy values', () => {
    for (let index = 0; index < 1_000; index += 1) {
      const mapping = new TaskRandomMapping(() => NOW)
      expect(mapping.person('Alice')).toMatch(/^User-[A-F0-9]{12}$/u)
      expect(mapping.initials('AL')).toMatch(/^[A-Z]{4}$/u)
      expect(mapping.organization('Example Corp')).toMatch(/^Org-[A-F0-9]{12}$/u)
      expect(mapping.description('Sensitive description')).toMatch(/^Document-[A-F0-9]{16}$/u)
      expect(mapping.uuid('old-id')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
      expect(Number.isInteger(mapping.integer(10))).toBe(true)
      expect(Number.isFinite(mapping.number(123.5))).toBe(true)
      expect(mapping.number(123.5)).not.toBe(123.5)
      expect(mapping.boolean(true)).toBe(false)

      const timestamp = Date.parse(mapping.timestamp('old timestamp'))
      expect(timestamp).toBeGreaterThanOrEqual(NOW - ONE_YEAR_MS)
      expect(timestamp).toBeLessThanOrEqual(NOW)
    }
  })

  it('keeps the same identity stable within one task and separates tasks', () => {
    const first = new TaskRandomMapping(() => NOW)
    const second = new TaskRandomMapping(() => NOW)

    expect(first.person('Alice')).toBe(first.person('Alice'))
    expect(first.organization('Example Corp')).toBe(first.organization('Example Corp'))
    expect(first.person('Alice')).not.toBe(first.person('Bob'))
    expect(first.person('Alice')).not.toBe(second.person('Alice'))
  })

  it('assigns distinct aliases to distinct identities within one task', () => {
    const mapping = new TaskRandomMapping(() => NOW)
    const people = new Set(
      Array.from({ length: 1_000 }, (_, index) => mapping.person(`Person-${index}`))
    )
    const organizations = new Set(
      Array.from({ length: 1_000 }, (_, index) => mapping.organization(`Organization-${index}`))
    )

    expect(people.size).toBe(1_000)
    expect(organizations.size).toBe(1_000)
  })

  it('generates stable past timestamps that are not in the future', () => {
    const mapping = new TaskRandomMapping(() => NOW)
    const first = mapping.timestamp('old created')

    expect(Date.parse(first)).toBeGreaterThanOrEqual(NOW - ONE_YEAR_MS)
    expect(Date.parse(first)).toBeLessThanOrEqual(NOW)
    // The same original timestamp maps deterministically within one task.
    expect(mapping.timestamp('old created')).toBe(first)

    const originalCreated = '2026-08-08T08:00:00.000Z'
    const mappedCreated = mapping.timestamp(originalCreated)
    expect(mappedCreated).not.toBe(originalCreated)
    expect(Date.parse(mappedCreated)).toBeLessThanOrEqual(NOW)
  })

  it('does not expose original values through enumerable state and cannot be reused after destroy', () => {
    const mapping = new TaskRandomMapping(() => NOW)
    mapping.person('Sensitive Person Name')
    mapping.organization('Sensitive Organization')

    expect(JSON.stringify(mapping)).not.toContain('Sensitive')
    mapping.destroy()
    expect(() => mapping.person('another')).toThrow(/已销毁/u)
  })
})
