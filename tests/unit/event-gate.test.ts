import { describe, expect, it } from 'vitest'
import { VersionGate } from '../../src/lib/event-gate'
describe('realtime event ordering', () => {
  it('applies a version once and ignores duplicates and older events', () => {
    const gate = new VersionGate()
    expect(gate.accept('nft', { eventId: 'e2', resourceId: 'a', version: 2 })).toBe(true)
    expect(gate.accept('nft', { eventId: 'e2', resourceId: 'a', version: 2 })).toBe(false)
    expect(gate.accept('nft', { eventId: 'e1', resourceId: 'a', version: 1 })).toBe(false)
    expect(gate.accept('nft', { eventId: 'e3', resourceId: 'a', version: 3 })).toBe(true)
  })
  it('does not regress a newer REST snapshot and isolates resources', () => {
    const gate = new VersionGate()
    expect(gate.accept('order', { eventId: 'old', resourceId: 'a', version: 2 }, 4)).toBe(false)
    expect(gate.accept('order', { eventId: 'new', resourceId: 'a', version: 5 }, 4)).toBe(true)
    expect(gate.accept('nft', { eventId: 'other', resourceId: 'b', version: 1 })).toBe(true)
  })
})
