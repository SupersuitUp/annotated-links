import { indexedDbVault, memoryVault, type VaultStore } from '@supersuit/cowitness/client'
import { linksConfig } from './config.js'

// Recordings wait in the phone's own database until the server has them, in Cowitness's vault
// under this package's own database name (never Cowitness's configuration, which an app using
// both packages owns). The key says what a recording is for: a spoken why under its draft, a
// spoken reply under its link.
export const whyKey = (draftId: string) => `link-why:${draftId}`
export const replyKey = (linkId: string) => `link:${linkId}`
export const draftOfKey = (key: string) => (key.startsWith('link-why:') ? key.slice('link-why:'.length) : null)
export const linkOfKey = (key: string) => (key.startsWith('link:') ? key.slice('link:'.length) : null)

let shared: VaultStore | null = null

export function linksVault(): VaultStore {
  if (!shared) shared = indexedDbVault(linksConfig().vaultName ?? 'annotated-links') ?? memoryVault()
  return shared
}
