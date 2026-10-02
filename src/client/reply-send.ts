import { audioOf, forget, isEmpty, type VaultStore } from '@supersuit/cowitness/client'
import type { AnnotatedLink } from '../types.js'
import { api } from './config.js'
import { audioType, postJson, putTicketed, type Ticket } from './net.js'
import { linkOfKey } from './vault.js'

export const sendText = (linkId: string, text: string) => postJson<AnnotatedLink>(api.replies(linkId), { text })

// A spoken reply: a ticket, the bytes straight to storage, then the filing. The reply id is the
// held recording's own id on every attempt, so a retry after a lost answer files it once. Any
// failure throws, and the caller keeps the recording.
export async function sendReply(linkId: string, blob: Blob, durationSec: number, replyId: string): Promise<AnnotatedLink> {
  const contentType = audioType(blob)
  const t = await postJson<Ticket>(api.replyUploadUrl(linkId), { replyId, contentType, size: blob.size, durationSec })
  await putTicketed(t, blob)
  return postJson<AnnotatedLink>(api.replies(linkId), { replyId, contentType, durationSec })
}

// Replies this phone kept because the server never confirmed them, sent quietly on the next visit
// and let go only once filed. Only finished recordings: one cut off mid-sentence was never sent.
// Answers the links as they now stand, so a screen showing one of them can redraw its thread.
export async function sendHeldReplies(store: VaultStore, send: typeof sendReply = sendReply): Promise<AnnotatedLink[]> {
  const out: AnnotatedLink[] = []
  for (const rec of await store.all()) {
    const linkId = linkOfKey(rec.noteId)
    if (!linkId || !rec.stopped || isEmpty(rec)) continue
    try {
      out.push(await send(linkId, audioOf(rec), rec.durationSec, rec.id))
      await forget(store, rec.id)
    } catch {
      // Still held; the next visit tries again.
    }
  }
  return out
}
