import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { RuleError, isRuleError } from '../errors.js'
import { alreadySent, mayRead } from '../link-rules.js'
import { normalizeUrl } from '../url.js'
import { DEFAULT_MIN_WHY_WORDS, whyProblem } from '../why.js'
import type { AnnotatedLink, LinkPreview, Reply, SpokenWhy } from '../types.js'
import type { AnnotatedLinksHost } from './host.js'
import {
  AUDIO_MAX_BYTES, audioPathExt, parseAudioType, parseClientId, parseClip, parseDuration, parseReplyText, parseShareBody,
} from './parse.js'
import { unfurl as defaultUnfurl } from './unfurl.js'

// The custom metadata key a signed voice PUT must set. Storage keeps it, so filing can tell whose
// bytes they are without trusting anything the phone says.
export const UPLOADER_KEY = 'links-by'
// The reply id under which a link's spoken why is played. A real reply id is 8 to 64 characters,
// so this can never be one.
export const WHY_AUDIO_ID = 'why'
const UPLOAD_WINDOW_MS = 15 * 60 * 1000
const COULD_NOT = 'the recording could not be made out'
const NOTHING_HEARD = 'nothing was heard in that recording'
const NOTHING_HEARD_REFUSAL = 'No words were heard in the voice note. Record it again or type why.'
const nowIso = () => new Date().toISOString()

// One document per (sharer, share id). Hashed, so any person key and any client id make a valid
// Firestore document id, and two people's ids can only meet by a sha256 collision.
const shareDocId = (m: string, shareId: string) => createHash('sha256').update(`${m}:${shareId}`).digest('hex').slice(0, 40)

type Ticket = { url: string; requiredHeaders: Record<string, string> } | { uploaded: true }

export function createLinksStore<M extends string>(host: AnnotatedLinksHost<M>) {
  const voice = host.voice === true
  // Voice on with nowhere to keep it would fail on a person's first tap; it fails here instead.
  if (voice && !host.storage) throw new Error('annotated-links: voice is on but the host has no storage')
  const min = host.minWhyWords ?? DEFAULT_MIN_WHY_WORDS
  const preview = host.unfurl ?? defaultUnfurl
  const links = () => host.db().collection(host.collection)
  const linkFrom = (doc: DocumentSnapshot): AnnotatedLink<M> => ({ id: doc.id, ...(doc.data() as Omit<AnnotatedLink<M>, 'id'>) })
  const stored = ({ id: _id, ...rest }: AnnotatedLink<M>) => rest
  const report = (what: string, err: unknown) => { try { host.log?.(what, err) } catch { /* a log that throws is dropped too */ } }
  // An announcement runs after the write is saved, so its failure never turns a saved link or reply
  // into an error: the phone would send it again.
  const quietly = async (what: string, fn: () => Promise<void> | void) => {
    try { await fn() } catch (err) { report(`announce ${what} failed`, err) }
  }

  const voiceOn = () => { if (!voice) throw new RuleError('voice is not on here', 404) }
  const storage = () => host.storage!
  const whyPath = (id: string, ct: string) => `${storage().prefix}links-why/${id}.${audioPathExt(ct)}`
  const replyPath = (linkId: string, replyId: string, ct: string) => `${storage().prefix}links-audio/${linkId}/${replyId}.${audioPathExt(ct)}`

  // Existence is private: a link this person may not read answers exactly as a missing one does.
  async function readable(m: M, id: string): Promise<AnnotatedLink<M>> {
    if (typeof id !== 'string' || !id) throw new RuleError('link not found', 404)
    const doc = await links().doc(id).get()
    if (!doc.exists) throw new RuleError('link not found', 404)
    const l = linkFrom(doc)
    if (!mayRead(l, m)) throw new RuleError('link not found', 404)
    return l
  }

  // Read, change, write in one transaction, with the readability check inside it. `change` returns
  // null for "nothing to write".
  async function rewrite(m: M, id: string, change: (l: AnnotatedLink<M>) => AnnotatedLink<M> | null): Promise<{ link: AnnotatedLink<M>; wrote: boolean }> {
    const ref = links().doc(id)
    return host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new RuleError('link not found', 404)
      const l = linkFrom(doc)
      if (!mayRead(l, m)) throw new RuleError('link not found', 404)
      const next = change(l)
      if (!next) return { link: l, wrote: false }
      tx.set(ref, stored(next))
      return { link: next, wrote: true }
    })
  }

  // The bytes at a voice path are this person's only if the signed PUT that put them there was
  // issued to them: that PUT had to send the uploader header, and storage keeps it.
  async function ownUpload(m: M, path: string): Promise<{ size: number; contentType?: string }> {
    const [md] = await storage().bucket().file(path).getMetadata()
    const meta = (md as { metadata?: Record<string, unknown> }).metadata
    if (meta?.[UPLOADER_KEY] !== m) throw new RuleError('that recording is not yours to send', 403)
    return { size: Number(md.size), contentType: typeof md.contentType === 'string' ? md.contentType : undefined }
  }
  const exists = async (path: string) => (await storage().bucket().file(path).exists())[0]

  // A create-once signed PUT, stamped with its uploader. When the bytes are already there (a resend)
  // nothing is signed, and they must be this person's.
  async function ticket(m: M, path: string, contentType: string): Promise<Ticket> {
    if (await exists(path)) {
      await ownUpload(m, path)
      return { uploaded: true }
    }
    const extensionHeaders = {
      'x-goog-content-length-range': `0,${AUDIO_MAX_BYTES}`, 'x-goog-if-generation-match': '0', [`x-goog-meta-${UPLOADER_KEY}`]: m as string,
    }
    const [url] = await storage().bucket().file(path).getSignedUrl({
      version: 'v4', action: 'write', expires: Date.now() + UPLOAD_WINDOW_MS, contentType, extensionHeaders,
    })
    return { url, requiredHeaders: { 'Content-Type': contentType, ...extensionHeaders } }
  }

  // Bytes that went up, are this person's, are the type they were sent as, and fit the cap.
  async function assertFiled(m: M, path: string, contentType: string, missing: RuleError): Promise<void> {
    if (!(await exists(path))) throw missing
    const up = await ownUpload(m, path)
    if (up.contentType && up.contentType.split(';')[0].trim() !== contentType) throw new RuleError('that recording is not the type it was sent as', 400)
    if (!(up.size > 0 && up.size <= AUDIO_MAX_BYTES)) throw new RuleError('that recording is too large', 400)
  }

  // Never throws: a transcription that fails leaves a reason in place of the words. `silent` says the
  // transcriber ran and heard nothing, which is a different thing from the transcriber failing.
  async function hear(path: string, contentType: string, speaker: M): Promise<{ heard: { words: string } | { wordsError: string }; silent: boolean }> {
    const t = host.transcription!
    try {
      const [audio] = await storage().bucket().file(path).download()
      const out = (await t.transcribe(audio, contentType, { language: 'auto', speaker })).trim()
      return out ? { heard: { words: out }, silent: false } : { heard: { wordsError: NOTHING_HEARD }, silent: true }
    } catch (err) {
      report(`transcription failed: ${path}`, err)
      return { heard: { wordsError: isRuleError(err) || host.isRefusal?.(err) === true ? (err as Error).message : COULD_NOT }, silent: false }
    }
  }
  const words = async (path: string, contentType: string, speaker: M) => (await hear(path, contentType, speaker)).heard

  async function list(m: M): Promise<AnnotatedLink<M>[]> {
    const [mine, toMe] = await Promise.all([links().where('by', '==', m).get(), links().where('to', 'array-contains', m).get()])
    const byId = new Map<string, AnnotatedLink<M>>()
    for (const d of [...mine.docs, ...toMe.docs]) byId.set(d.id, linkFrom(d))
    return [...byId.values()].filter((l) => mayRead(l, m)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }

  const get = (m: M, id: string) => readable(m, id)

  async function share(
    m: M, body: { url: string; why: string; to?: M[]; shareId?: string; spokenWhy?: { id: string; contentType: string; durationSec: number; heard: boolean } }, via: 'app' | 'agent',
  ): Promise<{ link: AnnotatedLink<M>; earlier: AnnotatedLink<M> | null }> {
    const input = parseShareBody(body)
    if (input.spokenWhy && via === 'agent') throw new RuleError('an agent shares with a typed why only', 400)
    if (input.spokenWhy && !voice) throw new RuleError('voice notes are not on here', 400)
    // A resend after a lost answer must not file twice or tell anyone twice. The phone names the
    // share (`shareId`, else its spoken why's id) and the document id follows from it and the
    // sharer, so a second send finds the first one and hands it back untouched.
    const shareId = input.shareId ?? input.spokenWhy?.id
    const ref = links().doc(shareId ? shareDocId(m, shareId) : randomUUID())
    if (shareId) {
      const prior = await ref.get()
      if (prior.exists) return resent(m, linkFrom(prior))
    }
    const { url, key } = normalizeUrl(input.url)
    const people = await host.people()
    const to = input.to === undefined
      ? people.filter((p) => p !== m)
      : [...new Set(input.to)].filter((p) => p !== m) as M[]
    for (const p of to) if (!people.includes(p)) throw new RuleError('you can only send a link to someone here', 400)
    // Before anything looks for an earlier send: "already sent" is true of nobody.
    if (to.length === 0) throw new RuleError('Choose who to send it to.', 400)
    // The why is checked before anything is fetched or stored.
    const problem = whyProblem(input.why, url, min, input.spokenWhy ? { durationSec: input.spokenWhy.durationSec, heard: input.spokenWhy.heard } : undefined)
    if (problem) throw new RuleError(problem, 400)

    let spokenWhy: SpokenWhy | undefined
    if (input.spokenWhy) {
      const { id, contentType, durationSec } = input.spokenWhy
      const path = whyPath(id, contentType)
      await assertFiled(m, path, contentType, new RuleError('that voice note is not yours to send, or did not finish uploading', 403))
      spokenWhy = { path, contentType, durationSec }
    }

    const card: LinkPreview | null = await preview(url).catch(() => null)
    const earlier = alreadySent((await links().where('by', '==', m).get()).docs.map(linkFrom), key, m, to)
    // Transcribed before anyone is told, so the push can lead with the words. A voice note the
    // transcriber heard nothing in cannot stand in for a short typed why: the phone's meter can call
    // silence speech (an unmeasured iPhone recording counts as heard), so the words decide. Refused
    // before the transaction, so nothing is filed or announced. A transcriber that FAILED proves
    // nothing about the recording, and the share still goes.
    if (spokenWhy && host.transcription) {
      const { heard, silent } = await hear(spokenWhy.path, spokenWhy.contentType, m)
      if (silent && whyProblem(input.why, url, min) !== null) throw new RuleError(NOTHING_HEARD_REFUSAL, 400)
      spokenWhy = { ...spokenWhy, ...heard }
    }

    const link: AnnotatedLink<M> = {
      id: ref.id, by: m, to, url, key, why: input.why, ...(spokenWhy ? { spokenWhy } : {}),
      at: nowIso(), preview: card, seenBy: {}, replies: [], via,
    }
    // Created once, inside a transaction: two overlapping sends of one share can never both file.
    let filed: { link: AnnotatedLink<M>; earlier: null } | null
    try {
      filed = await host.db().runTransaction(async (tx) => {
        const doc = await tx.get(ref)
        if (doc.exists) return resent(m, linkFrom(doc))
        tx.create(ref, stored(link))
        return null
      })
    } catch (err) {
      // ALREADY_EXISTS (gRPC 6): the overlapping send won the create. Hand back what it filed.
      if ((err as { code?: unknown }).code !== 6) throw err
      const won = await ref.get()
      if (!won.exists) throw err
      filed = resent(m, linkFrom(won))
    }
    if (filed) return filed
    await quietly('shared', () => host.announce.shared(link, to))
    return { link, earlier }
  }

  // The same share sent again by its sharer: the link as filed, with no earlier (it was told at the
  // first send). Anyone else's share under that id is a conflict, never a takeover.
  function resent(m: M, l: AnnotatedLink<M>): { link: AnnotatedLink<M>; earlier: null } {
    if (l.by !== m) throw new RuleError('that share id is already in use', 409)
    return { link: l, earlier: null }
  }

  async function whyUploadUrl(m: M, body: { id: string; contentType: string; size: number; durationSec: number }): Promise<Ticket> {
    voiceOn()
    const b = (body ?? {}) as Record<string, unknown>
    const id = parseClientId(b.id, 'id')
    const { contentType } = parseClip(b as { contentType: unknown; size: unknown; durationSec: unknown })
    return ticket(m, whyPath(id, contentType), contentType)
  }

  // Only a recipient's first open marks it, and the sender's own open never does.
  async function markSeen(m: M, id: string): Promise<AnnotatedLink<M>> {
    const at = nowIso()
    const { link, wrote } = await rewrite(m, id, (l) => {
      if (l.by === m || !l.to.includes(m) || l.seenBy[m]) return null
      return { ...l, seenBy: { ...l.seenBy, [m]: at } }
    })
    if (wrote && host.announce.seen) await quietly('seen', () => host.announce.seen!(link, m))
    return link
  }

  // Everyone who may read it but the person who replied.
  const othersOf = (l: AnnotatedLink<M>, m: M): M[] => [...new Set([l.by, ...l.to])].filter((p) => p !== m)

  async function reply(m: M, id: string, body: { text: string }): Promise<AnnotatedLink<M>> {
    const text = parseReplyText((body ?? {} as { text?: unknown }).text)
    const r: Reply<M> = { id: randomUUID(), by: m, at: nowIso(), text }
    const { link } = await rewrite(m, id, (l) => ({ ...l, replies: [...l.replies, r] }))
    await quietly('replied', () => host.announce.replied(link, r, othersOf(link, m)))
    return link
  }

  async function replyUploadUrl(m: M, id: string, body: { replyId: string; contentType: string; size: number; durationSec: number }): Promise<Ticket> {
    voiceOn()
    const b = (body ?? {}) as Record<string, unknown>
    const replyId = parseClientId(b.replyId, 'replyId')
    const { contentType } = parseClip(b as { contentType: unknown; size: unknown; durationSec: unknown })
    const l = await readable(m, id)
    if (l.replies.some((r) => r.id === replyId)) return { uploaded: true }
    return ticket(m, replyPath(l.id, replyId, contentType), contentType)
  }

  // Filed once per reply id: the same person filing it again gets the link back (a resend after a
  // lost answer); anyone else is refused, so an id can never be taken over.
  async function fileVoiceReply(m: M, id: string, body: { replyId: string; contentType: string; durationSec: number }): Promise<AnnotatedLink<M>> {
    voiceOn()
    const b = (body ?? {}) as Record<string, unknown>
    const replyId = parseClientId(b.replyId, 'replyId')
    const contentType = parseAudioType(b.contentType)
    const durationSec = parseDuration(b.durationSec)
    const before = await readable(m, id)
    const prior = before.replies.find((r) => r.id === replyId)
    if (prior) {
      if (prior.by !== m || !prior.voice) throw new RuleError('that reply already exists', 409)
      return before
    }
    const path = replyPath(before.id, replyId, contentType)
    await assertFiled(m, path, contentType, new RuleError('that recording did not finish uploading', 404))
    const r: Reply<M> = { id: replyId, by: m, at: nowIso(), voice: { path, contentType, durationSec } }
    const { link, wrote } = await rewrite(m, id, (l) => {
      const there = l.replies.find((x) => x.id === replyId)
      if (there) {
        if (there.by !== m || !there.voice) throw new RuleError('that reply already exists', 409)
        return null
      }
      return { ...l, replies: [...l.replies, r] }
    })
    if (wrote) await quietly('replied', () => host.announce.replied(link, r, othersOf(link, m)))
    return link
  }

  // Words for a spoken reply, from anyone who may read the link: the auto run after filing, or Try again.
  async function transcribeReply(m: M, id: string, replyId: string): Promise<AnnotatedLink<M>> {
    voiceOn()
    if (!host.transcription) throw new RuleError('transcription is not on here', 404)
    const l = await readable(m, id)
    const r = l.replies.find((x) => x.id === replyId)
    if (!r?.voice) throw new RuleError('reply not found', 404)
    const heard = await words(r.voice.path, r.voice.contentType, r.by)
    const { link } = await rewrite(m, id, (cur) => {
      const at = cur.replies.findIndex((x) => x.id === replyId)
      const v = cur.replies[at]?.voice
      if (!v) return null
      const { words: _w, wordsError: _e, ...bare } = v
      const replies = [...cur.replies]
      replies[at] = { ...cur.replies[at], voice: { ...bare, ...heard } }
      return { ...cur, replies }
    })
    return link
  }

  // A short-lived read URL for a reply's recording, or for the spoken why under WHY_AUDIO_ID.
  async function audioUrl(m: M, id: string, replyId: string): Promise<string> {
    voiceOn()
    const l = await readable(m, id)
    const path = replyId === WHY_AUDIO_ID ? l.spokenWhy?.path : l.replies.find((r) => r.id === replyId)?.voice?.path
    if (!path) throw new RuleError('recording not found', 404)
    return storage().signedUrl(path)
  }

  // The compose screen's live preview. Never throws for a bad page, only for a link that is not one.
  async function previewFor(_m: M, raw: string): Promise<LinkPreview | null> {
    if (typeof raw !== 'string') throw new RuleError('url is required', 400)
    return preview(normalizeUrl(raw).url).catch(() => null)
  }

  return { list, get, share, whyUploadUrl, markSeen, reply, replyUploadUrl, fileVoiceReply, transcribeReply, audioUrl, preview: previewFor }
}

export type LinksStore<M extends string> = ReturnType<typeof createLinksStore<M>>
