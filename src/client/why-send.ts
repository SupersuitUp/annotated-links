import { audioOf, expired, forget, isEmpty, type VaultStore } from '@supersuit/cowitness/client'
import type { AnnotatedLink } from '../types.js'
import type { LinksApi } from './config.js'
import { audioType, isPermanent, postJson, putTicketed, type Ticket } from './net.js'
import { draftOfKey } from './vault.js'

export interface ShareDraft { url: string; why: string; to?: string[]; shareId: string }
export interface SpokenDraft { blob: Blob; durationSec: number; id: string; heard: boolean }
export interface Shared { link: AnnotatedLink; earlier: AnnotatedLink | null }

/** What a held spoken why carries once Share was pressed: enough to file the share without the screen. */
export interface HeldWhyMeta { submitted?: boolean; url?: string; why?: string; to?: string[]; heard?: boolean }

// One share. A spoken why goes up on its own ticket first and is named in the share by its id.
// `shareId` is minted once per draft and sent on every attempt, so a retry files one link.
export async function shareLink(api: LinksApi, draft: ShareDraft, spoken?: SpokenDraft): Promise<Shared> {
  let spokenWhy: { id: string; contentType: string; durationSec: number; heard: boolean } | undefined
  if (spoken) {
    const contentType = audioType(spoken.blob)
    const t = await postJson<Ticket>(api.whyUploadUrl(), { id: spoken.id, contentType, size: spoken.blob.size, durationSec: spoken.durationSec })
    await putTicketed(t, spoken.blob)
    spokenWhy = { id: spoken.id, contentType, durationSec: spoken.durationSec, heard: spoken.heard }
  }
  return postJson<Shared>(api.links(), { ...draft, ...(spokenWhy ? { spokenWhy } : {}) })
}

// Spoken whys whose Share was pressed and never confirmed (a dropped connection, a closed tab),
// filed quietly on the next visit under the same shareId and let go once the server has them.
// A recording whose Share was never pressed is a draft, not a send, and is left alone here.
// `send` is shareLink bound to the provider's addresses.
export type SendShare = (draft: ShareDraft, spoken?: SpokenDraft) => Promise<Shared>
export async function sendHeldWhys(store: VaultStore, send: SendShare): Promise<number> {
  let sent = 0
  for (const rec of await store.all()) {
    const draftId = draftOfKey(rec.noteId)
    const meta = (rec.meta ?? {}) as HeldWhyMeta
    if (!draftId || !rec.stopped || isEmpty(rec) || meta.submitted !== true || typeof meta.url !== 'string') continue
    try {
      await send(
        { url: meta.url, why: meta.why ?? '', ...(meta.to?.length ? { to: meta.to } : {}), shareId: draftId },
        { blob: audioOf(rec), durationSec: rec.durationSec, id: rec.id, heard: meta.heard === true },
      )
      await forget(store, rec.id)
      sent += 1
    } catch (err) {
      // Refused for good: nothing will ever file it. Anything else stays held for the next visit.
      if (isPermanent(err)) await forget(store, rec.id).catch(() => {})
    }
  }
  return sent
}

const HOUR_MS = 60 * 60 * 1000

// Spoken whys recorded and never shared (Share was never pressed), past cowitness's keep window or
// holding no sound, are let go so the phone's disk is not a leak. An empty one younger than an
// hour may be a recording still running in another tab, so it is left alone.
export async function sweepUnsharedWhys(store: VaultStore, now: Date = new Date()): Promise<number> {
  let swept = 0
  for (const rec of await expired(store, { now })) {
    if (!draftOfKey(rec.noteId) || ((rec.meta ?? {}) as HeldWhyMeta).submitted === true) continue
    if (isEmpty(rec) && !rec.stopped && now.getTime() - Date.parse(rec.createdAt) < HOUR_MS) continue
    await forget(store, rec.id).catch(() => {})
    swept += 1
  }
  return swept
}

/** A spoken why recorded on an earlier visit and never shared, still in the keep window. */
export interface UnsharedWhy { draftId: string; recorded: SpokenDraft }

// The newest finished, unshared spoken why, for a fresh share form to offer back.
export async function newestUnsharedWhy(store: VaultStore, now: Date = new Date()): Promise<UnsharedWhy | null> {
  const stale = new Set((await expired(store, { now })).map((r) => r.id))
  const candidates = (await store.all())
    .filter((r) => draftOfKey(r.noteId) && r.stopped && !isEmpty(r) && !stale.has(r.id) && ((r.meta ?? {}) as HeldWhyMeta).submitted !== true)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const rec = candidates[0]
  if (!rec) return null
  return {
    draftId: draftOfKey(rec.noteId)!,
    recorded: { blob: audioOf(rec), durationSec: rec.durationSec, id: rec.id, heard: ((rec.meta ?? {}) as HeldWhyMeta).heard === true },
  }
}
