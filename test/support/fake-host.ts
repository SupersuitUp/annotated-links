import { vi } from 'vitest'
import { fakeFirestore } from './fake-firestore.js'
import { fakeBucket } from './fake-bucket.js'
import type { AnnotatedLinksHost } from '../../src/server/host.js'
import type { LinkPreview } from '../../src/types.js'

export type M = 'ana' | 'ben' | 'cy'
export const PREVIEW: LinkPreview = { kind: 'page', title: 'A page', siteName: 'example.com' }

// A whole host, every part a stand-in: three people, a preview that never touches the network,
// signing visible in the URL, and a transcriber that says 'hello there'.
export function fakeHost(opts: {
  voiceReplies?: boolean
  transcription?: AnnotatedLinksHost<M>['transcription'] | null
  minWhyWords?: number
  agent?: boolean
  storage?: boolean
} = {}) {
  const f = fakeFirestore()
  const b = fakeBucket()
  const host: AnnotatedLinksHost<M> = {
    member: vi.fn(async () => 'ana' as M),
    ...(opts.agent === false ? {} : { agentMember: vi.fn(async () => 'ana' as M) }),
    people: vi.fn(async () => ['ana', 'ben', 'cy'] as M[]),
    db: () => f.db,
    collection: 'links',
    ...(opts.storage === false ? {} : { storage: { bucket: () => b.bucket, prefix: 'p/', signedUrl: vi.fn(async (path: string) => `signed:${path}`) } }),
    ...(opts.transcription === null ? {} : { transcription: opts.transcription ?? { languages: ['en'], transcribe: vi.fn(async () => 'hello there') } }),
    announce: { shared: vi.fn(async () => {}), replied: vi.fn(async () => {}), seen: vi.fn(async () => {}) },
    ...(opts.minWhyWords !== undefined ? { minWhyWords: opts.minWhyWords } : {}),
    voiceReplies: opts.voiceReplies ?? true,
    unfurl: vi.fn(async () => PREVIEW),
    log: vi.fn(),
  }
  return { host, f, b }
}

export const WHY = 'this is exactly the onboarding problem we keep talking about'
