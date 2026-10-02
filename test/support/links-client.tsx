import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import type { AnnotatedLink } from '../../src/types.js'
import { apiAt, type LinksClientConfig } from '../../src/client/config.js'
import { LinksProvider } from '../../src/client/provider.js'
import type { LinksTheme } from '../../src/client/theme.js'

export const CONFIG: LinksClientConfig = {
  apiBase: '/api/links', pagesBase: '/links', me: 'ada', names: { ada: 'Ada', bo: 'Bo', cy: 'Cy' }, minWhyWords: 8, voice: true,
}
export const API = apiAt(CONFIG.apiBase)

// The config the next render() wraps its screen in. Set per test; nothing in the package is global.
let current: { config: LinksClientConfig; theme?: Partial<LinksTheme> } = { config: CONFIG }

export function setUp(over: Partial<LinksClientConfig> = {}, theme?: Partial<LinksTheme>): void {
  current = { config: { ...CONFIG, ...over }, theme }
}

// Testing Library's render, inside a LinksProvider holding the config setUp() last set. A
// rerender keeps the same provider.
export function render(ui: ReactElement, opts: Omit<RenderOptions, 'wrapper'> = {}) {
  const { config, theme } = current
  const wrapper = ({ children }: { children: ReactNode }) => <LinksProvider config={config} theme={theme}>{children}</LinksProvider>
  return rtlRender(ui, { ...opts, wrapper })
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
