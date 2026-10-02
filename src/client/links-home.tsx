'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { AnnotatedLink } from '../types.js'
import { matches, unseenFor } from '../link-rules.js'
import { nameOf, pages } from './config.js'
import { shortDate } from './format.js'
import { sendHeldReplies } from './reply-send.js'
import { theme } from './theme.js'
import { linksVault } from './vault.js'
import { sendHeldWhys, sweepUnsharedWhys } from './why-send.js'

const newestFirst = (a: AnnotatedLink, b: AnnotatedLink) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function Row({ l, me }: { l: AnnotatedLink; me: string }) {
  const t = theme()
  const from = l.by === me ? 'You' : nameOf(l.by)
  const title = l.preview?.title ?? l.preview?.siteName ?? hostOf(l.url)
  return (
    <li>
      <Link href={pages.link(l.id)} className="flex gap-3 rounded-xl px-3 py-3" style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }}>
        {l.preview?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stranger's image, nothing for the optimizer to do
          <img src={l.preview.image} alt="" className="aspect-square h-14 w-14 shrink-0 rounded-lg object-cover" />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-base leading-snug" style={{ fontFamily: t.fontHeading }}>
            {l.why.trim() || (l.spokenWhy ? (l.spokenWhy.words ?? 'A voice note on why') : '')}
          </span>
          <span className="truncate text-sm" style={{ color: t.mute }}>{title}</span>
          <span className="text-xs" style={{ color: t.mute }}>{from} · {shortDate(l.at)}</span>
        </span>
      </Link>
    </li>
  )
}

// The Links tile's page: what is waiting for this person first, then everything ever shared
// between them, newest first, narrowed by who sent it and searched across the why, the title,
// the site and the address. Opening it also sends anything this phone was still holding.
export function LinksHome({ links, me }: { links: AnnotatedLink[]; me: string }) {
  const t = theme()
  const [from, setFrom] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const vault = linksVault()
    void sweepUnsharedWhys(vault).then(() => sendHeldWhys(vault)).then(() => sendHeldReplies(vault))
  }, [])

  const unseen = useMemo(() => unseenFor(links, me), [links, me])
  const senders = useMemo(() => {
    const s = [...new Set(links.map((l) => l.by))]
    return [...s.filter((m) => m !== me).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), ...s.filter((m) => m === me)]
  }, [links, me])
  const library = useMemo(
    () => [...links].sort(newestFirst).filter((l) => (from === null || l.by === from) && matches(l, q)),
    [links, from, q],
  )

  const chip = (on: boolean) => on
    ? { backgroundColor: t.primary, color: t.primaryText }
    : { backgroundColor: t.card, color: t.ink, border: `1px solid ${t.hairline}` }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6" style={{ color: t.ink, fontFamily: t.fontBody }}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl" style={{ fontFamily: t.fontHeading }}>Links</h1>
        <Link href={pages.share()} className="flex h-11 items-center rounded-full px-4 text-sm font-medium" style={{ backgroundColor: t.primary, color: t.primaryText }}>
          Share a link
        </Link>
      </div>

      {unseen.length > 0 && (
        <section aria-labelledby="links-unseen" className="flex flex-col gap-3">
          <h2 id="links-unseen" className="text-sm font-medium uppercase tracking-wide" style={{ color: t.mute }}>Unseen</h2>
          <ul className="flex flex-col gap-2">{unseen.map((l) => <Row key={l.id} l={l} me={me} />)}</ul>
        </section>
      )}

      <section aria-labelledby="links-library" className="flex flex-col gap-3">
        <h2 id="links-library" className="text-sm font-medium uppercase tracking-wide" style={{ color: t.mute }}>Library</h2>
        <label className="flex flex-col">
          <span className="sr-only">Search links</span>
          <input
            type="search" value={q} placeholder="Search" onChange={(e) => setQ(e.target.value)}
            className="h-11 rounded-xl px-3 text-base outline-none"
            style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }}
          />
        </label>
        {senders.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={from === null} onClick={() => setFrom(null)} className="h-9 rounded-full px-3 text-sm" style={chip(from === null)}>Everyone</button>
            {senders.map((m) => (
              <button key={m} type="button" aria-pressed={from === m} onClick={() => setFrom(m)} className="h-9 rounded-full px-3 text-sm" style={chip(from === m)}>
                {m === me ? 'From you' : `From ${nameOf(m)}`}
              </button>
            ))}
          </div>
        )}
        {library.length > 0
          ? <ul className="flex flex-col gap-2">{library.map((l) => <Row key={l.id} l={l} me={me} />)}</ul>
          : <p className="text-sm" style={{ color: t.mute }}>{links.length ? 'No links match.' : 'Nothing shared yet.'}</p>}
      </section>
    </div>
  )
}
