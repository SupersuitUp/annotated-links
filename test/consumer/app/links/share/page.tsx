import { notFound } from 'next/navigation'
import { ShareLink } from '@supersuit/annotated-links/client'
import { PEOPLE } from '../../../lib/host'
import { Frame, me } from '../frame'

export const dynamic = 'force-dynamic'

// <pagesBase>/share?url=... opens the form with the link already in it.
export default async function SharePage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const m = await me()
  if (!m) notFound()
  const { url } = await searchParams
  return <Frame me={m}><ShareLink initialUrl={typeof url === 'string' ? url : ''} people={PEOPLE} /></Frame>
}
