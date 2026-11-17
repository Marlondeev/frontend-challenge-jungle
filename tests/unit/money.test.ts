import { describe, expect, it } from 'vitest'
import { addEth, compareEth, formatEth, multiplyEth, parseEth } from '../../src/lib/money'

describe('ETH decimal arithmetic', () => {
  it('adds tenths without binary floating-point loss', () => {
    expect(addEth('0.1', '0.2')).toBe('0.3')
  })
  it('preserves all eighteen wei decimal positions', () => {
    expect(parseEth('1.000000000000000001')).toBe(1000000000000000001n)
    expect(addEth('999999999999.999999999999999999', '0.000000000000000001')).toBe('1000000000000')
  })
  it('computes item totals and normalizes display strings', () => {
    expect(multiplyEth('1.79', 2)).toBe('3.58')
    expect(formatEth('0001.190000')).toBe('1.19')
    expect(compareEth('1.9', '1.19')).toBe(1)
  })
  it.each(['-1', 'NaN', '1e3', '1,2', '1.0000000000000000001'])('rejects invalid transport amount %s', value => {
    expect(() => parseEth(value)).toThrow()
  })
  it('rejects fractional or negative quantities', () => {
    expect(() => multiplyEth('1', 1.5)).toThrow()
    expect(() => multiplyEth('1', -1)).toThrow()
  })
})
