import { RuleError } from './errors.js'

const TRACKING = [/^utm_/i, /^si$/i, /^fbclid$/i, /^gclid$/i, /^igshid$/i, /^ref_src$/i]
const isTracking = (name: string) => TRACKING.some((re) => re.test(name))

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

// "14m0s", "1h2m3s", "840s" and "840" all mean a number of seconds; anything else means none.
function seconds(raw: string | null): number | undefined {
  if (!raw) return undefined
  const plain = /^(\d+)s?$/.exec(raw)
  if (plain) return Number(plain[1]) || undefined
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw)
  if (!parts || !(parts[1] || parts[2] || parts[3])) return undefined
  return (Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0)) || undefined
}

export function youtubeOf(url: string): { id: string; startSec?: number } | null {
  const u = parse(url)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  let id: string | undefined
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1]
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = u.pathname.split('/')
    id = first === 'watch' ? (u.searchParams.get('v') ?? undefined) : first === 'shorts' || first === 'embed' || first === 'live' ? second : undefined
  }
  if (!id || !/^[\w-]+$/.test(id)) return null
  const startSec = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'))
  return startSec ? { id, startSec } : { id }
}

// The link as it should be kept (tracking removed) and the key two shares of the same page agree on.
export function normalizeUrl(raw: string): { url: string; key: string } {
  const u = parse(raw)
  if (!u) throw new RuleError('That does not look like a web link.', 400)
  for (const name of [...u.searchParams.keys()]) if (isTracking(name)) u.searchParams.delete(name)
  u.hash = ''
  const url = u.toString().replace(/\/$/, '')
  const yt = youtubeOf(url)
  if (yt) return { url, key: `youtube:${yt.id}` }
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : ''
  const path = u.pathname.replace(/\/+$/, '')
  return { url, key: `${u.host.toLowerCase()}${path}${query}` }
}
