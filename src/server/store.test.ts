import { describe, expect, it, vi } from 'vitest'
import { fakeHost, PREVIEW, WHY, type M } from '../../test/support/fake-host.js'
import { createLinksStore } from './store.js'
import type { AnnotatedLink } from '../types.js'

const URL1 = 'https://example.com/a?utm_source=x'
const status = async (p: Promise<unknown>) => {
  try { await p } catch (err) { return (err as { status?: number }).status }
  return 'ok'
}
const message = async (p: Promise<unknown>) => {
  try { await p } catch (err) { return (err as Error).message }
  return 'ok'
}
const AUDIO = Buffer.from('fake audio bytes')

describe('share', () => {
  it('sends to everyone but the sharer when `to` is left out, and stores the preview', async () => {
    const { host, f } = fakeHost()
    const s = createLinksStore(host)
    const { link, earlier } = await s.share('ana', { url: URL1, why: WHY }, 'app')
    expect(link.to).toEqual(['ben', 'cy'])
    expect(link.by).toBe('ana')
    expect(link.url).toBe('https://example.com/a')
    expect(link.preview).toEqual(PREVIEW)
    expect(link.via).toBe('app')
    expect(link.seenBy).toEqual({})
    expect(link.replies).toEqual([])
    expect(earlier).toBeNull()
    expect(f.raw('links', link.id)).toMatchObject({ by: 'ana', to: ['ben', 'cy'], why: WHY, preview: PREVIEW })
  })

  it('stores a null preview when the unfurl finds nothing', async () => {
    const { host } = fakeHost()
    vi.mocked(host.unfurl!).mockResolvedValueOnce(null)
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: WHY }, 'app')
    expect(link.preview).toBeNull()
  })

  it('refuses an empty `to`, and a `to` naming someone who is not a person here', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    expect(await status(s.share('ana', { url: URL1, why: WHY, to: [] }, 'app'))).toBe(400)
    expect(await status(s.share('ana', { url: URL1, why: WHY, to: ['zed' as M] }, 'app'))).toBe(400)
    expect(await status(s.share('ana', { url: URL1, why: WHY, to: 'ben' as unknown as M[] }, 'app'))).toBe(400)
  })

  it('refuses an empty `to` before it ever looks for an earlier send (alreadySent is true of nobody)', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    // Only the sharer named: nobody is left, which must be a refusal, not an "already sent".
    expect(await status(s.share('ana', { url: URL1, why: WHY, to: ['ana'] }, 'app'))).toBe(400)
  })

  it('checks the why with its sentence BEFORE the unfurl runs', async () => {
    const { host, f } = fakeHost()
    const s = createLinksStore(host)
    expect(await message(s.share('ana', { url: URL1, why: 'look' }, 'app'))).toBe('Say a little more about why: 1 of 8 words.')
    expect(await status(s.share('ana', { url: URL1, why: 'look' }, 'app'))).toBe(400)
    expect(host.unfurl).not.toHaveBeenCalled()
    expect(f.all('links')).toEqual({})
    expect(host.announce.shared).not.toHaveBeenCalled()
  })

  it('honours the host minimum', async () => {
    const { host } = fakeHost({ minWhyWords: 2 })
    expect(await status(createLinksStore(host).share('ana', { url: URL1, why: 'watch this' }, 'app'))).toBe('ok')
  })

  it('refuses a link that is not a web address', async () => {
    const { host } = fakeHost()
    expect(await status(createLinksStore(host).share('ana', { url: 'javascript:alert(1)', why: WHY }, 'app'))).toBe(400)
  })

  it('announces after the save, to the recipients', async () => {
    const { host, f } = fakeHost()
    let savedWhenAnnounced: unknown
    vi.mocked(host.announce.shared).mockImplementationOnce(async (l) => { savedWhenAnnounced = f.raw('links', l.id) })
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    expect(host.announce.shared).toHaveBeenCalledWith(link, ['ben'])
    expect(savedWhenAnnounced).toBeDefined()
  })

  it('logs a failed announcement and still answers with the saved link', async () => {
    const { host, f } = fakeHost()
    vi.mocked(host.announce.shared).mockRejectedValueOnce(new Error('push down'))
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: WHY }, 'app')
    expect(f.raw('links', link.id)).toBeDefined()
    expect(host.log).toHaveBeenCalledWith('announce shared failed', expect.any(Error))
  })

  it('hands back the earlier send of the same page to the same people', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const first = await s.share('ana', { url: 'https://example.com/a', why: WHY, to: ['ben'] }, 'app')
    const again = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    expect(again.earlier?.id).toBe(first.link.id)
    expect(again.link.id).not.toBe(first.link.id)
    const other = await s.share('ana', { url: URL1, why: WHY, to: ['cy'] }, 'app')
    expect(other.earlier).toBeNull()
  })

  it('keeps the via it was given', async () => {
    const { host } = fakeHost()
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: WHY }, 'agent')
    expect(link.via).toBe('agent')
  })
})

describe('the spoken why', () => {
  const ticket = { id: 'why-0001', contentType: 'audio/webm', size: AUDIO.length, durationSec: 4 }
  const spoken = { id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true }
  const PATH = 'p/links-why/why-0001.webm'

  it('signs a create-once PUT stamped with the uploader, under links-why', async () => {
    const { host } = fakeHost()
    const t = await createLinksStore(host).whyUploadUrl('ana', ticket)
    expect(t).toEqual({
      url: `https://signed.example/write/${PATH}`,
      requiredHeaders: {
        'Content-Type': 'audio/webm',
        'x-goog-content-length-range': `0,${25 * 1024 * 1024}`,
        'x-goog-if-generation-match': '0',
        'x-goog-meta-links-by': 'ana',
      },
    })
  })

  it('answers uploaded when the bytes are already there and are this person\'s', async () => {
    const { host, b } = fakeHost()
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    expect(await createLinksStore(host).whyUploadUrl('ana', ticket)).toEqual({ uploaded: true })
    expect(await status(createLinksStore(host).whyUploadUrl('ben', ticket))).toBe(403)
  })

  it('caps the size at 25 MB and the length at 300 seconds', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    expect(await status(s.whyUploadUrl('ana', { ...ticket, size: 25 * 1024 * 1024 + 1 }))).toBe(400)
    expect(await status(s.whyUploadUrl('ana', { ...ticket, size: 25 * 1024 * 1024 }))).toBe('ok')
    expect(await status(s.whyUploadUrl('ana', { ...ticket, durationSec: 301 }))).toBe(400)
    expect(await status(s.whyUploadUrl('ana', { ...ticket, durationSec: 300 }))).toBe('ok')
    expect(await status(s.whyUploadUrl('ana', { ...ticket, contentType: 'text/html' }))).toBe(400)
    expect(await status(s.whyUploadUrl('ana', { ...ticket, id: '../x' }))).toBe(400)
  })

  it('is 404 while voice is off, ticket and share alike', async () => {
    const { host } = fakeHost({ voiceReplies: false })
    const s = createLinksStore(host)
    expect(await status(s.whyUploadUrl('ana', ticket))).toBe(404)
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app'))).toBe(400)
  })

  it('stands in for the typed why, transcribes, stores the words, THEN announces', async () => {
    const { host, b } = fakeHost()
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const order: string[] = []
    vi.mocked(host.transcription!.transcribe).mockImplementationOnce(async () => { order.push('transcribe'); return 'hello there' })
    let announced: AnnotatedLink<M> | undefined
    vi.mocked(host.announce.shared).mockImplementationOnce(async (l) => { order.push('announce'); announced = l })
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app')
    expect(link.spokenWhy).toEqual({ path: PATH, contentType: 'audio/webm', durationSec: 4, words: 'hello there' })
    expect(order).toEqual(['transcribe', 'announce'])
    expect(announced?.spokenWhy?.words).toBe('hello there')
    expect(host.transcription!.transcribe).toHaveBeenCalledWith(AUDIO, 'audio/webm', { language: 'auto', speaker: 'ana' })
  })

  it('stores the reason when transcription fails, and the share still goes through', async () => {
    const { host, b, f } = fakeHost()
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    vi.mocked(host.transcription!.transcribe).mockRejectedValueOnce(new Error('model down'))
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app')
    expect(link.spokenWhy?.words).toBeUndefined()
    expect(link.spokenWhy?.wordsError).toBe('the recording could not be made out')
    expect(f.raw('links', link.id)).toBeDefined()
    expect(host.announce.shared).toHaveBeenCalledTimes(1)
  })

  it('keeps the recording without words when there is no transcriber', async () => {
    const { host, b } = fakeHost({ transcription: null })
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const { link } = await createLinksStore(host).share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app')
    expect(link.spokenWhy).toEqual({ path: PATH, contentType: 'audio/webm', durationSec: 4 })
  })

  it('refuses bytes that are someone else\'s, unstamped, or missing (403)', async () => {
    const { host, b } = fakeHost()
    const s = createLinksStore(host)
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app'))).toBe(403)
    b.put(PATH, AUDIO, 'audio/webm')
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app'))).toBe(403)
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ben' })
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: spoken }, 'app'))).toBe(403)
    expect(host.announce.shared).not.toHaveBeenCalled()
  })

  it('holds the spoken why to whyProblem: too short or nothing heard is refused', async () => {
    const { host, b } = fakeHost()
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    const s = createLinksStore(host)
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: { ...spoken, durationSec: 2 } }, 'app'))).toBe(400)
    expect(await status(s.share('ana', { url: URL1, why: '', spokenWhy: { ...spoken, heard: false } }, 'app'))).toBe(400)
    expect(host.unfurl).not.toHaveBeenCalled()
  })

  it('is refused on the agent path', async () => {
    const { host, b } = fakeHost()
    b.put(PATH, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    expect(await status(createLinksStore(host).share('ana', { url: URL1, why: WHY, spokenWhy: spoken }, 'agent'))).toBe(400)
  })
})

describe('reading', () => {
  it('lists only what this person may read, newest first', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'))
      const a = await s.share('ana', { url: 'https://a.example/1', why: WHY, to: ['ben'] }, 'app')
      vi.setSystemTime(new Date('2026-10-01T11:00:00Z'))
      const b = await s.share('cy', { url: 'https://a.example/2', why: WHY, to: ['ana'] }, 'app')
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
      await s.share('ben', { url: 'https://a.example/3', why: WHY, to: ['cy'] }, 'app')
      expect((await s.list('ana')).map((l) => l.id)).toEqual([b.link.id, a.link.id])
    } finally { vi.useRealTimers() }
  })

  it('gets a link for its sender and its recipients, and 404s anyone else or a missing one', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    expect((await s.get('ana', link.id)).id).toBe(link.id)
    expect((await s.get('ben', link.id)).id).toBe(link.id)
    expect(await status(s.get('cy', link.id))).toBe(404)
    expect(await status(s.get('ana', 'nope'))).toBe(404)
  })

  it('previews a link for the compose screen', async () => {
    const { host } = fakeHost()
    expect(await createLinksStore(host).preview('ana', URL1)).toEqual(PREVIEW)
    expect(host.unfurl).toHaveBeenCalledWith('https://example.com/a')
    expect(await status(createLinksStore(host).preview('ana', 'ftp://x'))).toBe(400)
  })
})

describe('markSeen', () => {
  it('marks for a recipient once, keeping the first time, and announces once', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    const seen = await s.markSeen('ben', link.id)
    expect(seen.seenBy.ben).toEqual(expect.any(String))
    const again = await s.markSeen('ben', link.id)
    expect(again.seenBy.ben).toBe(seen.seenBy.ben)
    expect(host.announce.seen).toHaveBeenCalledTimes(1)
    expect(host.announce.seen).toHaveBeenCalledWith(seen, 'ben')
  })

  it('never marks for the sender opening their own link', async () => {
    const { host, f } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    const out = await s.markSeen('ana', link.id)
    expect(out.seenBy).toEqual({})
    expect((f.raw('links', link.id) as { seenBy: object }).seenBy).toEqual({})
    expect(host.announce.seen).not.toHaveBeenCalled()
  })

  it('404s someone who may not read it', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    expect(await status(s.markSeen('cy', link.id))).toBe(404)
  })
})

describe('replies', () => {
  it('takes a trimmed typed reply from anyone who may read, and tells every other reader', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben', 'cy'] }, 'app')
    const out = await s.reply('ben', link.id, { text: '  love it  ' })
    const r = out.replies[0]
    expect(r).toMatchObject({ by: 'ben', text: 'love it' })
    expect(host.announce.replied).toHaveBeenCalledWith(out, r, ['ana', 'cy'])
    await s.reply('ana', link.id, { text: 'thanks' })
    expect(vi.mocked(host.announce.replied).mock.calls[1][2]).toEqual(['ben', 'cy'])
  })

  it('refuses an empty or overlong reply, and 404s a non-reader', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    expect(await status(s.reply('ben', link.id, { text: '   ' }))).toBe(400)
    expect(await status(s.reply('ben', link.id, { text: 'x'.repeat(2001) }))).toBe(400)
    expect(await status(s.reply('ben', link.id, { text: 'x'.repeat(2000) }))).toBe('ok')
    expect(await status(s.reply('ben', link.id, { text: 5 as unknown as string }))).toBe(400)
    expect(await status(s.reply('cy', link.id, { text: 'hi' }))).toBe(404)
  })

  it('logs a failed reply announcement and keeps the reply', async () => {
    const { host } = fakeHost()
    const s = createLinksStore(host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    vi.mocked(host.announce.replied).mockRejectedValueOnce(new Error('push down'))
    const out = await s.reply('ben', link.id, { text: 'hi' })
    expect(out.replies).toHaveLength(1)
    expect(host.log).toHaveBeenCalledWith('announce replied failed', expect.any(Error))
  })
})

describe('spoken replies', () => {
  const RID = 'reply-0001'
  const setup = async (opts: Parameters<typeof fakeHost>[0] = {}) => {
    const h = fakeHost(opts)
    const s = createLinksStore(h.host)
    const { link } = await s.share('ana', { url: URL1, why: WHY, to: ['ben'] }, 'app')
    const path = `p/links-replies/${link.id}/${RID}.webm`
    return { ...h, s, link, path }
  }
  const clip = { replyId: RID, contentType: 'audio/webm', durationSec: 5 }

  it('signs a stamped ticket for a reader, and 404s a non-reader', async () => {
    const { s, link, path } = await setup()
    const t = await s.replyUploadUrl('ben', link.id, { ...clip, size: AUDIO.length })
    expect(t).toMatchObject({ url: `https://signed.example/write/${path}`, requiredHeaders: { 'x-goog-meta-links-by': 'ben' } })
    expect(await status(s.replyUploadUrl('cy', link.id, { ...clip, size: AUDIO.length }))).toBe(404)
    expect(await status(s.replyUploadUrl('ben', link.id, { ...clip, size: 25 * 1024 * 1024 + 1 }))).toBe(400)
    expect(await status(s.replyUploadUrl('ben', link.id, { ...clip, size: 10, durationSec: 301 }))).toBe(400)
  })

  it('files the reply, announces it, and is a no-op when filed again by the same person', async () => {
    const { s, link, path, b, host } = await setup()
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ben' })
    const out = await s.fileVoiceReply('ben', link.id, clip)
    expect(out.replies[0]).toMatchObject({ id: RID, by: 'ben', voice: { path, contentType: 'audio/webm', durationSec: 5 } })
    expect(host.announce.replied).toHaveBeenCalledTimes(1)
    const again = await s.fileVoiceReply('ben', link.id, clip)
    expect(again.replies).toHaveLength(1)
    expect(host.announce.replied).toHaveBeenCalledTimes(1)
  })

  it('refuses bytes stamped for someone else or not stamped (403), and missing bytes (404)', async () => {
    const { s, link, path, b } = await setup()
    expect(await status(s.fileVoiceReply('ben', link.id, clip))).toBe(404)
    b.put(path, AUDIO, 'audio/webm')
    expect(await status(s.fileVoiceReply('ben', link.id, clip))).toBe(403)
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ana' })
    expect(await status(s.fileVoiceReply('ben', link.id, clip))).toBe(403)
  })

  it('transcribes a filed reply into words, or a reason', async () => {
    const { s, link, path, b, host } = await setup()
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ben' })
    await s.fileVoiceReply('ben', link.id, clip)
    const out = await s.transcribeReply('ana', link.id, RID)
    expect(out.replies[0].voice?.words).toBe('hello there')
    vi.mocked(host.transcription!.transcribe).mockRejectedValueOnce(new Error('down'))
    const failed = await s.transcribeReply('ana', link.id, RID)
    expect(failed.replies[0].voice?.wordsError).toBe('the recording could not be made out')
    expect(failed.replies[0].voice?.words).toBeUndefined()
    expect(await status(s.transcribeReply('cy', link.id, RID))).toBe(404)
    expect(await status(s.transcribeReply('ana', link.id, 'reply-none'))).toBe(404)
  })

  it('signs the audio of a reply, and of the spoken why under the id "why"', async () => {
    const { s, link, path, b } = await setup()
    b.put(path, AUDIO, 'audio/webm', { 'links-by': 'ben' })
    await s.fileVoiceReply('ben', link.id, clip)
    expect(await s.audioUrl('ana', link.id, RID)).toBe(`signed:${path}`)
    expect(await status(s.audioUrl('cy', link.id, RID))).toBe(404)
    expect(await status(s.audioUrl('ana', link.id, 'why'))).toBe(404)
  })

  it('is 404 on every voice route while voice is off', async () => {
    const { s, link } = await setup({ voiceReplies: false })
    expect(await status(s.replyUploadUrl('ben', link.id, { ...clip, size: 10 }))).toBe(404)
    expect(await status(s.fileVoiceReply('ben', link.id, clip))).toBe(404)
    expect(await status(s.transcribeReply('ben', link.id, RID))).toBe(404)
    expect(await status(s.audioUrl('ben', link.id, RID))).toBe(404)
  })
})

describe('the host', () => {
  it('refuses voice with no storage at creation, naming what is missing', () => {
    const { host } = fakeHost({ storage: false })
    expect(() => createLinksStore(host)).toThrow(/storage/)
    expect(() => createLinksStore({ ...host, voiceReplies: false })).not.toThrow()
  })
})
