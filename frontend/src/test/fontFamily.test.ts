import { describe, expect, it } from 'vitest'
import { fontIdentity, primaryFamily, toFontFamilyStack } from '../utils/fontFamily'

describe('primaryFamily', () => {
  it.each([
    ['Menlo', 'Menlo'],
    ['"Courier New"', 'Courier New'],
    ["'DejaVu Sans Mono'", 'DejaVu Sans Mono'],
    ['Consolas, monospace', 'Consolas'],
    ['  "Courier New"  , monospace', 'Courier New'],
  ])('extracts the primary family from %j', (value, expected) => {
    expect(primaryFamily(value)).toBe(expected)
  })
})

describe('toFontFamilyStack', () => {
  it.each([
    ['monospace', 'monospace'],
    ['SERIF', 'serif'],
    ['Sans-Serif', 'sans-serif'],
  ])('leaves generic family %j unquoted', (value, expected) => {
    expect(toFontFamilyStack(value)).toBe(expected)
  })

  it('quotes a named family', () => {
    expect(toFontFamilyStack('Courier New')).toBe('"Courier New", monospace')
  })

  it('escapes an embedded quote', () => {
    expect(toFontFamilyStack('A"B')).toBe('"A\\"B", monospace')
  })

  it('escapes an embedded backslash', () => {
    expect(toFontFamilyStack('A\\B')).toBe('"A\\\\B", monospace')
  })
})

describe('fontIdentity', () => {
  it('gives a legacy stack and plain name the same identity', () => {
    expect(fontIdentity('"Courier New", monospace')).toBe(fontIdentity('Courier New'))
  })
})
