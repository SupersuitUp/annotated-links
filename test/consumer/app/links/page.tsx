import { notFound } from 'next/navigation'
import { LinksHome } from '@supersuit/annotated-links/client'
import { store } from '../../lib/host'
import { Frame, me } from './frame'

export const dynamic = 'force-dynamic'

export default async function LinksPage() {
  const m = await me()
  if (!m) notFound()
  return <Frame me={m}><LinksHome links={await store.list(m)} me={m} /></Frame>
}
