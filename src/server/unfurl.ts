import { lookup as dnsLookup } from 'node:dns/promises'
import { youtubeOf } from '../url.js'
import type { LinkPreview } from '../types.js'

export interface UnfurlOptions {
  fetch?: typeof fetch
  lookup?: (host: string) => Promise<string[]>
  timeoutMs?: number
  maxBytes?: number
}

const USER_AGENT = '@supersuit/annotated-links (link preview; +https://github.com/SupersuitUp/annotated-links)'
const MAX_REDIRECTS = 3

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address)

function ipv4Octets(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  return o.every((n) => n <= 255) ? o : null
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  )
}

// Expand an IPv6 literal to eight 16-bit groups, or null when it is not one.
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (tail) {
    const o = ipv4Octets(tail[1])
    if (!o) return null
    s = s.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const groups = [...head, ...Array(fill).fill('0'), ...rest].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null
}

// True for anything that is not an ordinary public address. Unparseable input counts as private:
// when in doubt the link keeps no preview.
export function isPrivateIp(ip: string): boolean {
  const v4 = ipv4Octets(ip)
  if (v4) return privateV4(v4)
  const g = ipv6Groups(ip)
  if (!g) return true
  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  const embedded = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return privateV4(embedded) // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return privateV4(embedded) // ::a.b.c.d (deprecated compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(embedded) // NAT64
  return false
}

class Refused extends Error {}

interface Ctx {
  fetch: typeof fetch
  lookup: (host: string) => Promise<string[]>
  signal: AbortSignal
  deadline: Promise<never>
}

// Every request, including redirects and the YouTube oEmbed call, goes through here: scheme check,
// address check on the literal or the resolved answers, then a fetch that never follows on its own.
async function guardedFetch(start: string, ctx: Ctx): Promise<{ res: Response; url: URL }> {
  let current = new URL(start)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Refused('scheme')
    const host = current.hostname.replace(/^\[|\]$/g, '')
    const addresses = ipv4Octets(host) || host.includes(':') ? [host] : await Promise.race([ctx.lookup(host), ctx.deadline])
    if (!addresses.length || addresses.some(isPrivateIp)) throw new Refused('private address')
    const res = await Promise.race([
      ctx.fetch(current.toString(), { redirect: 'manual', signal: ctx.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5' } }),
      ctx.deadline,
    ])
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return { res, url: current }
    await res.body?.cancel().catch(() => {})
    current = new URL(location, current)
  }
  throw new Refused('too many redirects')
}

async function readCapped(res: Response, maxBytes: number, deadline: Promise<never>): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const all = new Uint8Array(Math.min(total, maxBytes))
  let at = 0
  for (const c of chunks) {
    const piece = c.subarray(0, Math.max(0, all.length - at))
    all.set(piece, at)
    at += piece.length
  }
  return new TextDecoder('utf-8').decode(all)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {}
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key && attrs.content !== undefined && !out.has(key)) out.set(key, decode(attrs.content).trim())
  }
  return out
}

const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined)

function parsePage(html: string, finalUrl: URL): LinkPreview {
  const meta = metaTags(html)
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = clean(meta.get('og:title')) ?? clean(meta.get('twitter:title')) ?? clean(titleTag ? decode(titleTag[1]).replace(/\s+/g, ' ') : undefined)
  const description = clean(meta.get('og:description')) ?? clean(meta.get('twitter:description')) ?? clean(meta.get('description'))
  let image: string | undefined
  const rawImage = clean(meta.get('og:image')) ?? clean(meta.get('twitter:image'))
  if (rawImage) {
    try {
      const u = new URL(rawImage, finalUrl)
      if (u.protocol === 'http:' || u.protocol === 'https:') image = u.toString()
    } catch {
      // an unusable image URL just means no image
    }
  }
  const siteName = clean(meta.get('og:site_name')) ?? finalUrl.hostname.replace(/^www\./, '')
  const preview: LinkPreview = { kind: 'page', siteName }
  if (title) preview.title = title
  if (description) preview.description = description
  if (image) preview.image = image
  return preview
}

// A preview never blocks a share: whatever goes wrong, the answer is null and the link is kept
// without one.
export async function unfurl(url: string, opts: UnfurlOptions = {}): Promise<LinkPreview | null> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const maxBytes = opts.maxBytes ?? 512 * 1024
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // The signal cancels a well-behaved fetch; the race below also covers one that ignores it.
    const signal = AbortSignal.timeout(timeoutMs)
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })
    deadline.catch(() => {})
    const ctx: Ctx = { fetch: opts.fetch ?? fetch, lookup: opts.lookup ?? defaultLookup, signal, deadline }

    const yt = youtubeOf(url)
    if (yt) {
      const { res } = await guardedFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, ctx)
      if (!res.ok) return null
      const data = (await Promise.race([res.json(), deadline])) as { title?: unknown; thumbnail_url?: unknown }
      const preview: LinkPreview = { kind: 'youtube', youtubeId: yt.id, siteName: 'YouTube' }
      if (yt.startSec) preview.startSec = yt.startSec
      if (typeof data.title === 'string' && data.title) preview.title = data.title
      if (typeof data.thumbnail_url === 'string' && data.thumbnail_url) preview.image = data.thumbnail_url
      return preview
    }

    const { res, url: finalUrl } = await guardedFetch(url, ctx)
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return null
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (type.startsWith('image/')) {
      await res.body?.cancel().catch(() => {})
      return { kind: 'image', image: finalUrl.toString(), siteName: finalUrl.hostname.replace(/^www\./, '') }
    }
    if (type && !type.includes('html')) {
      await res.body?.cancel().catch(() => {})
      return { kind: 'page', siteName: finalUrl.hostname.replace(/^www\./, '') }
    }
    return parsePage(await readCapped(res, maxBytes, deadline), finalUrl)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
