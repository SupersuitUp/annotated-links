import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeHost, WHY, type M } from '../../test/support/fake-host.js'
import { RuleError } from '../errors.js'
import { createLinksHandlers } from './handlers.js'

const { scheduled } = vi.hoisted(() => ({ scheduled: [] as Promise<unknown>[] }))
// after() runs once the response has gone; here it runs at once so the test can see it.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { scheduled.push(fn()) } }))

const post = (body: unknown) => new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = () => new Request('https://x')
const ctx = <P extends object>(p: P) => ({ params: Promise.resolve(p) })
const URL1 = 'https://example.com/a'
const AUDIO = Buffer.from('fake audio')

beforeEach(() => { scheduled.length = 0 })

describe('every route', () => {
  it('answers 401 to a stranger, before anything is read or written', async () => {
    const { host, f } = fakeHost()
    vi.mocked(host.member).mockResolvedValue(null)
    const h = createLinksHandlers(host)
    const id = ctx({ id: 'l1' })
    const reply = ctx({ id: 'l1', replyId: 'reply-0001' })
    const answers = [
      await h.links.GET(get()),
      await h.links.POST(post({ url: URL1, why: WHY })),
      await h.whyUploadUrl.POST(post({ id: 'why-0001', contentType: 'audio/webm', size: 10, durationSec: 4 })),
      await h.link.GET(get(), id),
      await h.seen.POST(post({}), id),
      await h.replies.POST(post({ text: 'hi' }), id),
      await h.replyUploadUrl.POST(post({ replyId: 'reply-0001', contentType: 'audio/webm', size: 10, durationSec: 4 }), id),
      await h.replyAudio.GET(get(), reply),
      await h.replyTranscribe.POST(post({}), reply),
      await h.preview.POST(post({ url: URL1 })),
    ]
    expect(answers.map((r) => r.status)).toEqual(Array(answers.length).fill(401))
    expect(f.all('links')).toEqual({})
    expect(host.unfurl).not.toHaveBeenCalled()
  })
})

describe('links', () => {
  it('shares and lists', async () => {
    const { host } = fakeHost()
    const h = createLinksHandlers(host)
    const res = await h.links.POST(post({ url: URL1, why: WHY, to: ['ben'] }))
    expect(res.status).toBe(200)
    const { link, earlier } = await res.json()
    expect(link).toMatchObject({ by: 'ana', to: ['ben'], via: 'app' })
    expect(earlier).toBeNull()
    expect((await (await h.links.GET(get())).json()).map((l: { id: string }) => l.id)).toEqual([link.id])
  })

  it('answers a short why with its sentence as a 400', async () => {
    const { host } = fakeHost()
    const res = await createLinksHandlers(host).links.POST(post({ url: URL1, why: 'look' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Say a little more about why: 1 of 8 words.' })
  })

  it('answers an unreadable body 400 and an internal failure an opaque 500', async () => {
    const { host } = fakeHost()
    const h = createLinksHandlers(host)
    const bad = new Request('https://x', { method: 'POST', body: '{nope' })
    expect((await h.links.POST(bad)).status).toBe(400)
    vi.mocked(host.people).mockRejectedValueOnce(new Error('db exploded at 10.0.0.4'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await h.links.POST(post({ url: URL1, why: WHY }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'something went wrong' })
    err.mockRestore()
  })

  it('passes the host\'s own refusals through with their words when isRefusal says so', async () => {
    class HostError extends Error { status = 409 }
    const { host } = fakeHost()
    vi.mocked(host.people).mockRejectedValue(new HostError('busy'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    const plain = await createLinksHandlers(host).links.POST(post({ url: URL1, why: WHY }))
    expect(plain.status).toBe(500)
    const res = await createLinksHandlers({ ...host, isRefusal: (e) => e instanceof HostError }).links.POST(post({ url: URL1, why: WHY }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'busy' })
  })
})

describe('one link', () => {
  it('reads, marks seen, and replies; a non-reader gets 404', async () => {
    const { host } = fakeHost()
    const h = createLinksHandlers(host)
    const { link } = await (await h.links.POST(post({ url: URL1, why: WHY, to: ['ben'] }))).json()
    const id = ctx({ id: link.id })
    vi.mocked(host.member).mockResolvedValue('ben')
    expect((await h.link.GET(get(), id)).status).toBe(200)
    const seen = await (await h.seen.POST(post({}), id)).json()
    expect(seen.seenBy.ben).toEqual(expect.any(String))
    const replied = await (await h.replies.POST(post({ text: 'great' }), id)).json()
    expect(replied.replies[0]).toMatchObject({ by: 'ben', text: 'great' })
    vi.mocked(host.member).mockResolvedValue('cy' as M)
    expect((await h.link.GET(get(), id)).status).toBe(404)
    expect((await h.seen.POST(post({}), id)).status).toBe(404)
    expect((await h.replies.POST(post({ text: 'x' }), id)).status).toBe(404)
  })

  it('previews for the compose screen', async () => {
    const { host } = fakeHost()
    const res = await createLinksHandlers(host).preview.POST(post({ url: URL1 }))
    expect(await res.json()).toMatchObject({ siteName: 'example.com' })
  })
})

describe('voice', () => {
  const RID = 'reply-0001'
  it('files a spoken reply, transcribes it after the answer, and redirects to its audio', async () => {
    const { host, b, f } = fakeHost()
    const h = createLinksHandlers(host)
    const { link } = await (await h.links.POST(post({ url: URL1, why: WHY, to: ['ben'] }))).json()
    const id = ctx({ id: link.id })
    vi.mocked(host.member).mockResolvedValue('ben')
    const t = await (await h.replyUploadUrl.POST(post({ replyId: RID, contentType: 'audio/webm', size: AUDIO.length, durationSec: 4 }), id)).json()
    expect(t.requiredHeaders['x-goog-meta-links-by']).toBe('ben')
    const path = `p/links-audio/${link.id}/${RID}.webm`
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ben' })
    const res = await h.replies.POST(post({ replyId: RID, contentType: 'audio/webm', durationSec: 4 }), id)
    expect(res.status).toBe(200)
    await Promise.all(scheduled)
    expect((f.raw('links', link.id) as { replies: { voice: { words: string } }[] }).replies[0].voice.words).toBe('hello there')
    const audio = await h.replyAudio.GET(get(), ctx({ id: link.id, replyId: RID }))
    expect(audio.status).toBe(302)
    expect(audio.headers.get('location')).toBe(`signed:${path}`)
    const again = await (await h.replyTranscribe.POST(post({}), ctx({ id: link.id, replyId: RID }))).json()
    expect(again.replies[0].voice.words).toBe('hello there')
  })

  it('answers 404 on every voice route while voice is off', async () => {
    const { host } = fakeHost({ voice: false })
    const h = createLinksHandlers(host)
    const { link } = await (await h.links.POST(post({ url: URL1, why: WHY, to: ['ben'] }))).json()
    const id = ctx({ id: link.id })
    const reply = ctx({ id: link.id, replyId: RID })
    expect((await h.whyUploadUrl.POST(post({ id: 'why-0001', contentType: 'audio/webm', size: 10, durationSec: 4 }))).status).toBe(404)
    expect((await h.replyUploadUrl.POST(post({ replyId: RID, contentType: 'audio/webm', size: 10, durationSec: 4 }), id)).status).toBe(404)
    expect((await h.replies.POST(post({ replyId: RID, contentType: 'audio/webm', durationSec: 4 }), id)).status).toBe(404)
    expect((await h.replyAudio.GET(get(), reply)).status).toBe(404)
    expect((await h.replyTranscribe.POST(post({}), reply)).status).toBe(404)
  })

  it('serves the spoken why under the reply id "why"', async () => {
    const { host, b } = fakeHost()
    const h = createLinksHandlers(host)
    const path = 'p/links-why/why-0001.webm'
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const res = await h.links.POST(post({ url: URL1, why: '', to: ['ben'], spokenWhy: { id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true } }))
    expect(res.status).toBe(200)
    const { link } = await res.json()
    expect(link.spokenWhy.words).toBe('hello there')
    const audio = await h.replyAudio.GET(get(), ctx({ id: link.id, replyId: 'why' }))
    expect(audio.status).toBe(302)
  })

  it('redirects to a relative signed URL resolved against the request, rather than failing', async () => {
    const { host, b } = fakeHost()
    vi.mocked(host.storage!.signedUrl).mockImplementation(async (path: string) => `/files/${path}`)
    const h = createLinksHandlers(host)
    b.put('p/links-why/why-0001.webm', AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const { link } = await (await h.links.POST(post({ url: URL1, why: '', to: ['ben'], spokenWhy: { id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true } }))).json()
    const audio = await h.replyAudio.GET(new Request('https://app.example/api/links/x/replies/why/audio'), ctx({ id: link.id, replyId: 'why' }))
    expect(audio.status).toBe(302)
    expect(audio.headers.get('location')).toBe('https://app.example/files/p/links-why/why-0001.webm')
  })
})

describe('the agent route', () => {
  it('401s when the host has no agentMember, or it answers null', async () => {
    const none = fakeHost({ agent: false })
    expect((await createLinksHandlers(none.host).agent.POST(post({ url: URL1, why: WHY }))).status).toBe(401)
    const { host } = fakeHost()
    vi.mocked(host.agentMember!).mockResolvedValue(null)
    expect((await createLinksHandlers(host).agent.POST(post({ url: URL1, why: WHY }))).status).toBe(401)
    expect(host.unfurl).not.toHaveBeenCalled()
  })

  it('never takes the session as an agent key', async () => {
    const { host } = fakeHost()
    vi.mocked(host.agentMember!).mockResolvedValue(null)
    await createLinksHandlers(host).agent.POST(post({ url: URL1, why: WHY }))
    expect(host.member).not.toHaveBeenCalled()
  })

  it('shares as the agent\'s person, via agent, with the same why check', async () => {
    const { host } = fakeHost()
    vi.mocked(host.agentMember!).mockResolvedValue('ben')
    const h = createLinksHandlers(host)
    const short = await h.agent.POST(post({ url: URL1, why: 'look' }))
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: 'Say a little more about why: 1 of 8 words.' })
    expect(host.unfurl).not.toHaveBeenCalled()
    const res = await h.agent.POST(post({ url: URL1, why: WHY, to: ['ana'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).link).toMatchObject({ by: 'ben', to: ['ana'], via: 'agent' })
  })

  it('refuses a spoken why', async () => {
    const { host, b } = fakeHost()
    b.put('p/links-why/why-0001.webm', AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const res = await createLinksHandlers(host).agent.POST(post({ url: URL1, why: WHY, spokenWhy: { id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true } }))
    expect(res.status).toBe(400)
  })
})

describe('refusals', () => {
  it('RuleError reaches the client with its words', async () => {
    const { host } = fakeHost()
    vi.mocked(host.people).mockRejectedValueOnce(new RuleError('not today', 409))
    const res = await createLinksHandlers(host).links.POST(post({ url: URL1, why: WHY }))
    expect(res.status).toBe(409)
  })
})
