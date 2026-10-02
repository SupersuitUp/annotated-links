import type { Firestore } from 'firebase-admin/firestore'
import { normalizeUrl, type AnnotatedLink, type LinkPreview } from '@supersuit/annotated-links'
import { createLinksHandlers, createLinksStore, UPLOADER_KEY, type AnnotatedLinksHost } from '@supersuit/annotated-links/server'
import { fakeBucket } from './fake-bucket'
import { fakeFirestore } from './fake-firestore'

// The consumer app's host: two people, everything kept in memory, nothing sent anywhere. It is a
// stand-in for an app's real host, seeded with three links so the screens have something to draw.
// Who is asking comes from a `who` cookie (no cookie is Ana, an unknown name is a stranger), and
// the agent route takes `Authorization: Bearer <AGENT_KEY>`.
export type M = 'ana' | 'ben'
export const PEOPLE: M[] = ['ana', 'ben']
export const NAMES: Record<M, string> = { ana: 'Ana', ben: 'Ben' }
export const AGENT_KEY = process.env.CONSUMER_AGENT_KEY ?? 'consumer-agent-key'

export const whoFrom = (cookie: string | undefined | null): M | null => {
  if (cookie === undefined || cookie === null || cookie === '') return 'ana'
  return (PEOPLE as string[]).includes(cookie) ? (cookie as M) : null
}
const cookieOf = (req: Request | undefined, name: string) =>
  req?.headers.get('cookie')?.split(';').map((s) => s.trim().split('=')).find(([k]) => k === name)?.[1]

const day = (n: number) => new Date(Date.UTC(2026, 8, 20 + n, 15, 0, 0)).toISOString()
const YOUTUBE = 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=42'
const PAGE = 'https://example.com/og/onboarding-notes'
const PLAIN = 'https://plain.example.org/field-notes'
const WHY_AUDIO = 'consumer/links-why/seed-spoken-why.webm'
const REPLY_AUDIO = 'consumer/links-audio/seed-youtube/seed-voice-reply.webm'

function seedLinks(): AnnotatedLink<M>[] {
  const base = (url: string) => ({ url: normalizeUrl(url).url, key: normalizeUrl(url).key })
  return [
    {
      id: 'seed-youtube', by: 'ben', to: ['ana'], ...base(YOUTUBE),
      why: 'Watch from 0:42: this is how the player should start on the moment that matters, not the intro.',
      at: day(0), via: 'app', seenBy: { ana: day(0) },
      preview: { kind: 'youtube', title: 'YouTube Developers Live: Embedded Web Player Customization', siteName: 'YouTube', youtubeId: 'M7lc1UVf-VE', startSec: 42 },
      replies: [
        { id: 'seed-typed-reply', by: 'ana', at: day(1), text: 'Starting at the moment is the whole point. Saving this for the player work.' },
        { id: 'seed-voice-reply', by: 'ben', at: day(1), voice: { path: REPLY_AUDIO, contentType: 'audio/webm', durationSec: 7, words: 'Yes, and the start time survives the share, which is the bit I cared about.' } },
      ],
    },
    {
      id: 'seed-page', by: 'ana', to: ['ben'], ...base(PAGE),
      why: 'The second section says what we keep circling: people skip setup when the first screen asks for nothing.',
      at: day(2), via: 'app', seenBy: {}, replies: [],
      preview: {
        kind: 'page', title: 'Notes on onboarding that asks for nothing', siteName: 'Example Journal', image: '/og-sample.svg',
        description: 'Why the best first screen is one with no form on it, and what to do instead.',
      },
    },
    {
      id: 'seed-spoken', by: 'ben', to: ['ana'], ...base(PLAIN), why: '',
      spokenWhy: { path: WHY_AUDIO, contentType: 'audio/webm', durationSec: 12, words: 'I said this one out loud because it is long: the part about field notes is how I want us to write things down.' },
      at: day(3), via: 'app', seenBy: {}, replies: [], preview: null,
    },
  ]
}

// The fake can return a preview without the network: a YouTube link plays, /og/ pages have an
// image, everything else has none. A preview never blocks a share either way.
async function fakeUnfurl(url: string): Promise<LinkPreview | null> {
  const u = new URL(url)
  if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) {
    return { kind: 'youtube', siteName: 'YouTube', title: 'A video', youtubeId: u.searchParams.get('v')!, startSec: Number(u.searchParams.get('t') ?? 0) || undefined }
  }
  if (u.pathname.startsWith('/og/')) return { kind: 'page', siteName: u.hostname, title: 'A page with a picture', image: '/og-sample.svg' }
  return null
}

type State = { f: ReturnType<typeof fakeFirestore>; b: ReturnType<typeof fakeBucket>; told: { what: string; by: M; to: M[] }[] }
// One state per server process, shared by every route bundle (each bundle has its own module copy).
const g = globalThis as { __annotatedLinksConsumer?: State }
export function state(): State {
  if (!g.__annotatedLinksConsumer) {
    const f = fakeFirestore()
    const b = fakeBucket()
    f.seed('links', Object.fromEntries(seedLinks().map(({ id, ...rest }) => [id, rest])))
    const bytes = Buffer.from('fake webm bytes')
    b.put(WHY_AUDIO, bytes, 'audio/webm', { [UPLOADER_KEY]: 'ben' })
    b.put(REPLY_AUDIO, bytes, 'audio/webm', { [UPLOADER_KEY]: 'ben' })
    g.__annotatedLinksConsumer = { f, b, told: [] }
  }
  return g.__annotatedLinksConsumer
}

export const host: AnnotatedLinksHost<M> = {
  member: async (req) => whoFrom(cookieOf(req, 'who')),
  agentMember: async (req) => (req.headers.get('authorization') === `Bearer ${AGENT_KEY}` ? 'ana' : null),
  people: async () => PEOPLE,
  db: () => state().f.db as Firestore,
  collection: 'links',
  // signedUrl answers a path, which the audio route resolves against the request.
  storage: { bucket: () => state().b.bucket, prefix: 'consumer/', signedUrl: async (path) => `/consumer-audio/${path}` },
  transcription: { transcribe: async () => 'a fake transcriber heard this' },
  announce: {
    shared: async (l, to) => { state().told.push({ what: 'shared', by: l.by, to }) },
    replied: async (_l, r, to) => { state().told.push({ what: 'replied', by: r.by, to }) },
    seen: async (l, by) => { state().told.push({ what: 'seen', by, to: [l.by] }) },
    deleted: async (l, by) => { state().told.push({ what: 'deleted', by, to: l.to }) },
  },
  voice: true,
  unfurl: fakeUnfurl,
  log: (message, err) => console.error(message, err),
}

export const handlers = createLinksHandlers(host)
export const store = createLinksStore(host)
