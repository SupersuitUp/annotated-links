import { vi } from 'vitest'
import type { AnnotatedLink } from '../../src/types.js'
import { configure, type LinksClientConfig } from '../../src/client/config.js'

export const CONFIG: LinksClientConfig = {
  apiBase: '/api/links', pagesBase: '/links', me: 'ada', names: { ada: 'Ada', bo: 'Bo', cy: 'Cy' }, minWhyWords: 8, voiceReplies: true,
}

export function setUp(over: Partial<LinksClientConfig> = {}): void {
  configure({ ...CONFIG, ...over })
}

export function link(over: Partial<AnnotatedLink> = {}): AnnotatedLink {
  return {
    id: 'l1', by: 'ada', to: ['bo'], url: 'https://example.com/post', key: 'example.com/post',
    why: 'this is exactly the onboarding problem we keep hitting', at: '2026-09-03T12:00:00.000Z',
    preview: { kind: 'page', title: 'A post', description: 'About onboarding', image: 'https://example.com/i.png', siteName: 'Example' },
    seenBy: {}, replies: [], via: 'app', ...over,
  }
}

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined

// fetch answered by the first route that returns a Response; anything unanswered is a 404, so a
// call the test did not expect is visible in the calls list rather than hanging.
export function stubFetch(...routes: Route[]) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const r of routes) {
      const out = await r(url, init)
      if (out) return out
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

export const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body ?? 'null'))
export const callsTo = (f: ReturnType<typeof stubFetch>, url: string, method = 'POST') =>
  f.mock.calls.filter(([u, i]) => String(u) === url && (i?.method ?? 'GET') === method)
