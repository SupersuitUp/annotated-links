import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { LinksProvider } from '@supersuit/annotated-links/client'
import { NAMES, whoFrom, type M } from '../../lib/host'

// Who is looking, from the same cookie the host reads.
export async function me(): Promise<M | null> {
  return whoFrom((await cookies()).get('who')?.value)
}

// Every Links page draws inside the provider, the one place who is looking is said: where the
// handlers and pages are, who is looking, the names, the why minimum, voice, the vault's database
// name, and the app's look. The screens paint the theme's paper themselves; the main's own
// background only fills the page below them.
export function Frame({ me, children }: { me: M; children: ReactNode }) {
  return (
    <LinksProvider
      config={{ apiBase: '/api/links', pagesBase: '/links', me, names: NAMES, minWhyWords: 8, voice: true, vaultName: 'consumer-links' }}
      theme={{ paper: '#fbfaf7', primary: '#1f3a5f', fontHeading: 'Georgia, serif' }}
    >
      <main style={{ backgroundColor: '#fbfaf7', minHeight: '100dvh' }}>{children}</main>
    </LinksProvider>
  )
}
