import { notFound } from 'next/navigation'
import { LinkDetail } from '@supersuit/annotated-links/client'
import { store } from '../../../lib/host'
import { Frame, me } from '../frame'

export const dynamic = 'force-dynamic'

export default async function LinkPage({ params }: { params: Promise<{ id: string }> }) {
  const m = await me()
  if (!m) notFound()
  const link = await store.get(m, (await params).id).catch(() => null)
  if (!link) notFound()
  return <Frame me={m}><LinkDetail link={link} me={m} /></Frame>
}
