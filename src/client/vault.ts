import { forget, indexedDbVault, memoryVault, type VaultStore } from '@supersuit/cowitness/client'
import type { AnnotatedLink } from '../types.js'

// Recordings wait in the phone's own database until the server has them, in Cowitness's vault
// under this package's own database name (never Cowitness's configuration, which an app using
// both packages owns). The key says what a recording is for: a spoken why under its draft, a
// spoken reply under its link.
export const whyKey = (draftId: string) => `link-why:${draftId}`
export const replyKey = (linkId: string) => `link:${linkId}`
export const draftOfKey = (key: string) => (key.startsWith('link-why:') ? key.slice('link-why:'.length) : null)
export const linkOfKey = (key: string) => (key.startsWith('link:') ? key.slice('link:'.length) : null)

export const DEFAULT_VAULT_NAME = 'annotated-links'

// One open vault per database name, opened on first use (from an effect or a handler, never
// during render) and shared by every screen that names the same database.
const open = new Map<string, VaultStore>()

export function linksVault(name: string = DEFAULT_VAULT_NAME): VaultStore {
  let v = open.get(name)
  if (!v) {
    v = indexedDbVault(name) ?? memoryVault()
    open.set(name, v)
  }
  return v
}

// After a link is deleted, nothing this phone still holds for it may be sent again: a held reply
// would be refused, and a held spoken why would file the deleted share afresh under its shareId.
// Replies are held under the link's key. A spoken why is held under its draft, and the link names
// it only through its stored path (`.../links-why/<recording id>.<ext>`), so the recording id is
// read back from there.
export async function forgetHeldFor(store: VaultStore, link: Pick<AnnotatedLink, 'id' | 'spokenWhy'>): Promise<number> {
  const whyId = link.spokenWhy?.path.match(/links-why\/([^/]+)\.[^./]+$/)?.[1] ?? null
  let n = 0
  for (const rec of await store.all()) {
    if (linkOfKey(rec.noteId) === link.id || (whyId !== null && rec.id === whyId && draftOfKey(rec.noteId) !== null)) {
      await forget(store, rec.id).catch(() => {})
      n += 1
    }
  }
  return n
}
