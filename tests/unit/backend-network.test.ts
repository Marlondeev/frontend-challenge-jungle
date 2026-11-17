import { afterEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createBackend, memoryStorage } from '../../src/mocks/backend'
import { createHandlers } from '../../src/mocks/handlers'
import axios from 'axios'

const resources: Array<() => void> = []
afterEach(() => { resources.splice(0).reverse().forEach(dispose => dispose()) })
function setup() {
  const backend = createBackend({ storage: memoryStorage() })
  const handlers = createHandlers(backend, { latency: 0 })
  const server = setupServer(...handlers.handlers)
  server.listen({ onUnhandledRequest: 'error' })
  resources.push(() => backend.dispose(), () => handlers.dispose(), () => server.close())
  return { backend }
}
describe('MSW REST boundary', () => {
  it('serves catalogue search, schema errors, guest session, and control through HTTP', async () => {
    setup()
    const result = await fetch('http://localhost/api/nfts?q=Emerald&sort=price-asc').then(res => res.json())
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item: { name: string }) => item.name.includes('Emerald'))).toBe(true)
    expect(await fetch('http://localhost/api/session').then(res => res.json())).toEqual({ user: null, expiresAt: null })
    const response = await fetch('http://localhost/api/cart/items', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': 'network' }, body: JSON.stringify({ nftId: 'emerald-ape-042', editionId: 'one', quantity: 2 }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'OUT_OF_STOCK', fields: { quantity: expect.any(String) } })
    await fetch('http://localhost/api/__control', { method: 'POST', body: JSON.stringify({ action: 'scenario', scenario: 'server-error' }) })
    expect((await fetch('http://localhost/api/nfts')).status).toBe(503)
    expect((await fetch('http://localhost/api/__control')).status).toBe(200)
  })
  it('uses real socket.io-client over the intercepted WebSocket for private events and reconnect', async () => {
    const { backend } = setup()
    // Import the built-in WebSocket transport after MSW patches global WebSocket.
    const { io } = await import('socket.io-client')
    const { WebSocket: BrowserWebSocket } = await import('engine.io-client')
    const login = await backend.request('POST', '/session/login', { email: 'colecionador@kurio.test', password: 'Kurio123!' }, { visitorId: 'socket' })
    const socket = io('https://realtime.kurio.test', { transports: [BrowserWebSocket], query: { token: login.token }, reconnectionDelay: 10, reconnectionDelayMax: 20 })
    resources.push(() => socket.disconnect())
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
    const guestSocket = io('https://realtime.kurio.test', { transports: [BrowserWebSocket], forceNew: true })
    resources.push(() => guestSocket.disconnect())
    await new Promise<void>((resolve, reject) => { guestSocket.once('connect', resolve); guestSocket.once('connect_error', reject) })
    const leakedEvents: unknown[] = []
    guestSocket.on('order.updated', event => leakedEvents.push(event))
    const event = new Promise<{ version: number; payload: { price: string } }>(resolve => socket.once('nft.updated', resolve))
    await fetch('http://localhost/api/__control', { method: 'POST', body: JSON.stringify({ action: 'nft-update', price: '2.11' }) })
    expect(await event).toMatchObject({ version: 2, payload: { price: '2.11' } })
    const privateEvents: Array<{ payload: { status: string } }> = []
    socket.on('order.updated', event => privateEvents.push(event))
    const context = { token: login.token, visitorId: 'socket' }
    await backend.request('POST', '/cart/items', { nftId: 'emerald-ape-042', editionId: 'ten', quantity: 1 }, context)
    const quote = await backend.request('POST', '/quote', {}, context), walletId = (await backend.request('GET', '/wallets', {}, context))[0].id
    const confirmedEvent = new Promise<void>(resolve => socket.on('order.updated', event => { if (event.payload.status === 'confirmed') resolve() }))
    await backend.request('POST', '/orders', { quoteId: quote.id, walletId, idempotencyKey: 'socket-order' }, context)
    await confirmedEvent
    expect(privateEvents.map(event => event.payload.status)).toEqual(['pending', 'confirmed'])
    expect(leakedEvents).toEqual([])
    const disconnected = new Promise<void>(resolve => socket.once('disconnect', () => resolve()))
    await backend.request('POST', '/__control', { action: 'disconnect' })
    await disconnected
    const reconnected = new Promise<void>(resolve => socket.once('connect', resolve))
    await backend.request('POST', '/__control', { action: 'reconnect' })
    await reconnected
    expect(socket.connected).toBe(true)
  }, 10000)
  it('creates an order before an Axios timeout and recovers that exact request by key', async () => {
    const { backend } = setup()
    const login = await backend.request('POST', '/session/login', { email: 'colecionador@kurio.test', password: 'Kurio123!' })
    const context = { token: login.token }
    await backend.request('POST', '/cart/items', { nftId: 'emerald-ape-042', editionId: 'one', quantity: 1 }, context)
    const quote = await backend.request('POST', '/quote', {}, context), walletId = (await backend.request('GET', '/wallets', {}, context))[0].id
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'order-timeout' })
    const headers = { Authorization: `Bearer ${login.token}`, 'Idempotency-Key': 'network-timeout' }
    const input = { quoteId: quote.id, walletId, idempotencyKey: 'network-timeout' }
    await expect(axios.post('http://localhost/api/orders', input, { timeout: 75, headers })).rejects.toMatchObject({ code: 'ECONNABORTED' })
    const recovered = await axios.get('http://localhost/api/orders/by-key/network-timeout', { headers })
    expect(recovered.data).toMatchObject({ idempotencyKey: 'network-timeout', status: 'pending', total: '1.206' })
    expect((await backend.request('POST', '/orders', input, context)).id).toBe(recovered.data.id)
  }, 3000)
  it('accepts bodyless favorite, delete-cart and logout requests used by the Axios API client', async () => {
    const { backend } = setup()
    const login = await backend.request('POST', '/session/login', { email: 'colecionador@kurio.test', password: 'Kurio123!' })
    const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }
    expect((await fetch('http://localhost/api/favorites/emerald-ape-042', { method: 'POST', headers })).status).toBe(200)
    const cart = await backend.request('POST', '/cart/items', { nftId: 'emerald-ape-042', editionId: 'one', quantity: 1 }, { token: login.token })
    const deleted = await fetch(`http://localhost/api/cart/items/${cart.items[0].id}`, { method: 'DELETE', headers })
    expect(deleted.status).toBe(200)
    expect((await deleted.json()).items).toEqual([])
    expect((await fetch('http://localhost/api/session/logout', { method: 'POST', headers })).status).toBe(200)
    expect((await fetch('http://localhost/api/profile', { headers })).status).toBe(401)
  })
  it('keeps controls reachable offline and returns deterministic form and coupon errors', async () => {
    const { backend } = setup()
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'offline' })
    await expect(fetch('http://localhost/api/nfts')).rejects.toBeInstanceOf(TypeError)
    expect((await fetch('http://localhost/api/__control')).status).toBe(200)
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'validation-error' })
    const invalid = await fetch('http://localhost/api/session/register', { method: 'POST', body: JSON.stringify({}) })
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR', fields: { email: expect.any(String), password: expect.any(String) } })
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'expired-coupon' })
    const coupon = await fetch('http://localhost/api/cart/coupon', { method: 'PUT', body: JSON.stringify({ code: 'KURIO10' }) })
    expect(coupon.status).toBe(422)
    expect(await coupon.json()).toMatchObject({ code: 'COUPON_EXPIRED', fields: { code: expect.any(String) } })
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'empty' })
    expect(await fetch('http://localhost/api/nfts').then(response => response.json())).toMatchObject({ total: 0, items: [] })
  })
  it('reproducibly returns a later search before the earlier search under variable latency', async () => {
    const { backend } = setup()
    await backend.request('POST', '/__control', { action: 'scenario', scenario: 'variable-latency' })
    const finished: string[] = []
    const first = fetch('http://localhost/api/nfts?q=Emerald').then(response => response.json()).then(result => { finished.push('first'); return result })
    const second = fetch('http://localhost/api/nfts?q=Sage').then(response => response.json()).then(result => { finished.push('second'); return result })
    const [earlier, later] = await Promise.all([first, second])
    expect(finished).toEqual(['second', 'first'])
    expect(earlier.items[0].name).toContain('Emerald')
    expect(later.items[0].name).toContain('Sage')
  })
})
