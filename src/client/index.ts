'use client'

// What an app needs, and nothing it does not: the provider, the three screens, and the types it
// configures them with. The screens send and resend everything themselves.
// Named exports only: Next.js refuses `export *` inside a client boundary.
export { LinksProvider } from './provider.js'
export type { LinksClientConfig } from './config.js'
export type { LinksTheme } from './theme.js'
export { LinksHome } from './links-home.js'
export { ShareLink } from './share-link.js'
export { LinkDetail } from './link-detail.js'
