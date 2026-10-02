import { indexedDbVault, memoryVault, type VaultStore } from '@supersuit/cowitness/client'

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
