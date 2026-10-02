import { describe, expect, it, vi, afterEach } from 'vitest'
import { memoryVault } from '@supersuit/cowitness/client'
import { sendHeldReplies, sendReply } from './reply-send.js'
import { newestUnsharedWhy, sendHeldWhys, sweepUnsharedWhys } from './why-send.js'
import { SendError } from './net.js'
import { API, bodyOf, callsTo, link, setUp, stubFetch } from '../../test/support/links-client.js'

setUp()
afterEach(() => vi.unstubAllGlobals())

const rec = (id: string, noteId: string, over: Record<string, unknown> = {}) => ({
  id, noteId, mimeType: 'audio/mp4', createdAt: '', durationSec: 5, stopped: true, chunks: [new Blob(['ab'])], ...over,
})

describe('sendReply', () => {
  it('takes a ticket, PUTs the bytes with exactly the issued headers, then files it', async () => {
    const f = stubFetch((url) => {
      if (url === '/api/links/l1/reply-upload-url') return Response.json({ url: 'https://storage.test/r', requiredHeaders: { 'Content-Type': 'audio/mp4', 'x-goog-if-generation-match': '0' } })
      if (url === 'https://storage.test/r') return new Response(null, { status: 200 })
      if (url === '/api/links/l1/replies') return Response.json(link())
      return undefined
    })
    await sendReply(API, 'l1', new Blob(['abc'], { type: 'audio/mp4' }), 5, 'r-00000001')
    expect(bodyOf(callsTo(f, '/api/links/l1/reply-upload-url')[0][1])).toEqual({ replyId: 'r-00000001', contentType: 'audio/mp4', size: 3, durationSec: 5 })
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/mp4', 'x-goog-if-generation-match': '0' } })
    expect(bodyOf(callsTo(f, '/api/links/l1/replies')[0][1])).toEqual({ replyId: 'r-00000001', contentType: 'audio/mp4', durationSec: 5 })
  })

  it('throws when the filing is refused, so the caller keeps the recording', async () => {
    stubFetch((url) => (url.endsWith('reply-upload-url') ? Response.json({ uploaded: true }) : Response.json({ error: 'no' }, { status: 403 })))
    await expect(sendReply(API, 'l1', new Blob(['a'], { type: 'audio/mp4' }), 5, 'r-00000001')).rejects.toThrow('no')
  })
})

describe('sendHeldReplies', () => {
  it('sends finished replies held under link:<id>, keeps what fails, and skips whys and unfinished ones', async () => {
    const store = memoryVault()
    await store.put(rec('r-ok-000001', 'link:l1'))
    await store.put(rec('r-fail-0001', 'link:l2'))
    await store.put(rec('r-cut-00001', 'link:l1', { stopped: false }))
    await store.put(rec('r-why-00001', 'link-why:d1'))
    const send = vi.fn(async (linkId: string) => { if (linkId === 'l2') throw new Error('offline'); return link({ id: linkId }) })
    const sent = await sendHeldReplies(store, send)
    expect(sent.map((l) => l.id)).toEqual(['l1'])
    expect(send).toHaveBeenCalledWith('l1', expect.any(Blob), 5, 'r-ok-000001')
    expect((await store.all()).map((r) => r.id).sort()).toEqual(['r-cut-00001', 'r-fail-0001', 'r-why-00001'])
  })
})

describe('sendHeldWhys', () => {
  it('resends a spoken why whose share was pressed but never confirmed, under its draft\'s shareId', async () => {
    const store = memoryVault()
    await store.put(rec('r-why-00001', 'link-why:draft-0001', { meta: { submitted: true, url: 'https://example.com', why: '', to: ['bo'], heard: true } }))
    await store.put(rec('r-why-00002', 'link-why:draft-0002', { meta: { url: 'https://example.com', why: '', heard: true } }))
    const send = vi.fn(async () => ({ link: link(), earlier: null }))
    expect(await sendHeldWhys(store, send)).toBe(1)
    expect(send).toHaveBeenCalledWith(
      { url: 'https://example.com', why: '', to: ['bo'], shareId: 'draft-0001' },
      { blob: expect.any(Blob), durationSec: 5, id: 'r-why-00001', heard: true },
    )
    expect((await store.all()).map((r) => r.id)).toEqual(['r-why-00002'])
  })
})

describe('held recordings refused for good are let go; anything else stays held', () => {
  const refusal = (status: number) => new SendError('refused', status)

  it.each([400, 403, 404, 409])('a reply refused %i is forgotten', async (status) => {
    const store = memoryVault()
    await store.put(rec('r-rep-00001', 'link:l1'))
    await sendHeldReplies(store, vi.fn(async () => { throw refusal(status) }))
    expect(await store.all()).toEqual([])
  })

  it.each([0, 401, 500, 503])('a reply that failed with %i stays held', async (status) => {
    const store = memoryVault()
    await store.put(rec('r-rep-00001', 'link:l1'))
    await sendHeldReplies(store, vi.fn(async () => { throw refusal(status) }))
    expect(await store.all()).toHaveLength(1)
  })

  it.each([400, 403, 404, 409])('a spoken why refused %i is forgotten', async (status) => {
    const store = memoryVault()
    await store.put(rec('r-why-00001', 'link-why:draft-0001', { meta: { submitted: true, url: 'https://example.com', heard: true } }))
    await sendHeldWhys(store, vi.fn(async () => { throw refusal(status) }))
    expect(await store.all()).toEqual([])
  })

  it.each([0, 401, 500, 503])('a spoken why that failed with %i stays held', async (status) => {
    const store = memoryVault()
    await store.put(rec('r-why-00001', 'link-why:draft-0001', { meta: { submitted: true, url: 'https://example.com', heard: true } }))
    await sendHeldWhys(store, vi.fn(async () => { throw refusal(status) }))
    expect(await store.all()).toHaveLength(1)
  })

  it('a plain Error (no status) stays held', async () => {
    const store = memoryVault()
    await store.put(rec('r-rep-00001', 'link:l1'))
    await sendHeldReplies(store, vi.fn(async () => { throw new Error('offline') }))
    expect(await store.all()).toHaveLength(1)
  })
})

describe('unshared spoken whys', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z')
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

  it('sweeps unshared whys past the keep window, and never a submitted one, a reply, or a fresh one', async () => {
    const store = memoryVault()
    await store.put(rec('r-old-unshared', 'link-why:d1', { createdAt: daysAgo(31), meta: { heard: true } }))
    await store.put(rec('r-old-submitted', 'link-why:d2', { createdAt: daysAgo(31), meta: { submitted: true, url: 'https://x.test' } }))
    await store.put(rec('r-old-reply', 'link:l1', { createdAt: daysAgo(31) }))
    await store.put(rec('r-fresh-unshared', 'link-why:d3', { createdAt: daysAgo(2) }))
    await store.put(rec('r-empty-running', 'link-why:d4', { createdAt: daysAgo(0), chunks: [], stopped: false }))
    await store.put(rec('r-empty-stopped', 'link-why:d5', { createdAt: daysAgo(0), chunks: [] }))
    expect(await sweepUnsharedWhys(store, NOW)).toBe(2)
    expect((await store.all()).map((r) => r.id).sort()).toEqual(['r-empty-running', 'r-fresh-unshared', 'r-old-reply', 'r-old-submitted'])
  })

  it('finds the newest finished unshared why still in the window, with its draft id and heard', async () => {
    const store = memoryVault()
    await store.put(rec('r-older', 'link-why:d-older1', { createdAt: daysAgo(3), meta: { heard: true } }))
    await store.put(rec('r-newer', 'link-why:d-newer1', { createdAt: daysAgo(1), durationSec: 7, meta: { heard: true } }))
    await store.put(rec('r-sent', 'link-why:d-sent01', { createdAt: daysAgo(0), meta: { submitted: true, url: 'https://x.test' } }))
    await store.put(rec('r-stale', 'link-why:d-stale1', { createdAt: daysAgo(40) }))
    const found = await newestUnsharedWhy(store, NOW)
    expect(found).toEqual({ draftId: 'd-newer1', recorded: { blob: expect.any(Blob), durationSec: 7, id: 'r-newer', heard: true } })
    expect(await newestUnsharedWhy(memoryVault(), NOW)).toBeNull()
  })
})
