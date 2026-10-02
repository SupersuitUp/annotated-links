import { describe, expect, it, vi, afterEach } from 'vitest'
import { memoryVault } from '@supersuit/cowitness/client'
import { sendHeldReplies, sendReply } from './reply-send.js'
import { sendHeldWhys } from './why-send.js'
import { bodyOf, callsTo, link, setUp, stubFetch } from '../../test/support/links-client.js'

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
    await sendReply('l1', new Blob(['abc'], { type: 'audio/mp4' }), 5, 'r-00000001')
    expect(bodyOf(callsTo(f, '/api/links/l1/reply-upload-url')[0][1])).toEqual({ replyId: 'r-00000001', contentType: 'audio/mp4', size: 3, durationSec: 5 })
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/mp4', 'x-goog-if-generation-match': '0' } })
    expect(bodyOf(callsTo(f, '/api/links/l1/replies')[0][1])).toEqual({ replyId: 'r-00000001', contentType: 'audio/mp4', durationSec: 5 })
  })

  it('throws when the filing is refused, so the caller keeps the recording', async () => {
    stubFetch((url) => (url.endsWith('reply-upload-url') ? Response.json({ uploaded: true }) : Response.json({ error: 'no' }, { status: 403 })))
    await expect(sendReply('l1', new Blob(['a'], { type: 'audio/mp4' }), 5, 'r-00000001')).rejects.toThrow('no')
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
