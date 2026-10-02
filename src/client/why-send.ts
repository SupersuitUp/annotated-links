import { audioOf, forget, isEmpty, type VaultStore } from '@supersuit/cowitness/client'
import type { AnnotatedLink } from '../types.js'
import { api } from './config.js'
import { audioType, postJson, putTicketed, type Ticket } from './net.js'
import { draftOfKey } from './vault.js'

export interface ShareDraft { url: string; why: string; to?: string[]; shareId: string }
export interface SpokenDraft { blob: Blob; durationSec: number; id: string; heard: boolean }
export interface Shared { link: AnnotatedLink; earlier: AnnotatedLink | null }

/** What a held spoken why carries once Share was pressed: enough to file the share without the screen. */
export interface HeldWhyMeta { submitted?: boolean; url?: string; why?: string; to?: string[]; heard?: boolean }

// One share. A spoken why goes up on its own ticket first and is named in the share by its id.
// `shareId` is minted once per draft and sent on every attempt, so a retry files one link.
export async function shareLink(draft: ShareDraft, spoken?: SpokenDraft): Promise<Shared> {
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
export async function sendHeldWhys(store: VaultStore, send: typeof shareLink = shareLink): Promise<number> {
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
    } catch {
      // Still held; the next visit tries again.
    }
  }
  return sent
}
