'use client'

import type { LinkPreview } from '../types.js'
import { youtubeOf } from '../url.js'
import { useLinks } from './context.js'

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// What the link is, drawn from its stored preview: a YouTube video plays here, from the no-cookie
// host and at the link's timestamp; an image is the image; a page is a card that opens in a new
// tab; with no preview, the site's name. A YouTube link whose preview failed still plays, from
// the url alone.
export function LinkCard({ url, preview }: { url: string; preview: LinkPreview | null }) {
  const { theme: t } = useLinks()
  const yt = preview?.kind === 'youtube' && preview.youtubeId
    ? { id: preview.youtubeId, startSec: preview.startSec }
    : !preview || preview.kind === 'youtube' ? youtubeOf(url) : null
  const site = preview?.siteName || hostOf(url)
  const box = { backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }

  if (yt) {
    const start = Number.isFinite(yt.startSec) ? Math.max(0, Math.floor(yt.startSec as number)) : 0
    return (
      <figure className="overflow-hidden rounded-xl" style={box}>
        <div className="relative aspect-video w-full">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt.id}?start=${start}`}
            title={preview?.title ?? 'YouTube video'}
            allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
        <figcaption className="px-4 py-3">
          {preview?.title && <p className="text-base font-medium leading-snug">{preview.title}</p>}
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-2" style={{ color: t.mute }}>Open on YouTube</a>
        </figcaption>
      </figure>
    )
  }

  if (preview?.kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a stranger's image, nothing for the optimizer to do */}
        <img src={preview.image ?? url} alt={preview.title ?? `An image from ${site}`} className="block h-auto w-full" />
      </a>
    )
  }

  if (preview?.kind === 'page') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl" style={box}>
        {preview.image && (
          // eslint-disable-next-line @next/next/no-img-element -- a stranger's image, nothing for the optimizer to do
          <img src={preview.image} alt="" className="block aspect-video w-full object-cover" />
        )}
        <span className="block px-4 py-3">
          {preview.title && <span className="block text-base font-medium leading-snug">{preview.title}</span>}
          {preview.description && <span className="mt-1 line-clamp-3 block text-sm leading-relaxed" style={{ color: t.mute }}>{preview.description}</span>}
          <span className="mt-2 block text-xs uppercase tracking-wide" style={{ color: t.mute }}>{site}</span>
        </span>
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl px-4 py-4" style={box}>
      <span className="block text-base font-medium">{site}</span>
      <span className="mt-1 block truncate text-sm" style={{ color: t.mute }}>{url}</span>
    </a>
  )
}
