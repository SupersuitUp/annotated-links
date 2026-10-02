// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { unfurl } from './unfurl.js'

const PUBLIC = async () => ['93.184.216.34']
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })

describe('unfurl: previews', () => {
  it('asks YouTube oEmbed for a video and keeps the id and start time', async () => {
    const fetch = vi.fn(async () => Response.json({ title: 'A talk', thumbnail_url: 'https://i.ytimg.com/vi/abc123/hq.jpg' }))
    const url = 'https://www.youtube.com/watch?v=abc123&t=90'
    const p = await unfurl(url, { fetch, lookup: PUBLIC })
    expect(p).toEqual({ kind: 'youtube', youtubeId: 'abc123', startSec: 90, title: 'A talk', image: 'https://i.ytimg.com/vi/abc123/hq.jpg', siteName: 'YouTube' })
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`)
  })

  it('returns an image link as an image without reading the body', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(8)) } }, { highWaterMark: 0 })
    const res = new Response(body, { status: 200, headers: { 'content-type': 'image/png' } })
    const p = await unfurl('https://example.com/a.png', { fetch: async () => res, lookup: PUBLIC })
    expect(p).toMatchObject({ kind: 'image', image: 'https://example.com/a.png' })
    expect(pulls).toBe(0)
  })

  it('reads og tags and resolves a relative image against the final url', async () => {
    const fetch = vi.fn(async (u: string | URL | Request) =>
      String(u) === 'https://example.com/old'
        ? redirect('https://example.org/dir/new')
        : html(`<html><head><title>Plain</title>
          <meta property="og:title" content="Og &amp; Title"><meta content="About it" property="og:description">
          <meta property="og:image" content="/img/card.png"><meta property="og:site_name" content="Example Org"></head></html>`),
    )
    const p = await unfurl('https://example.com/old', { fetch: fetch as typeof globalThis.fetch, lookup: PUBLIC })
    expect(p).toEqual({ kind: 'page', title: 'Og & Title', description: 'About it', image: 'https://example.org/img/card.png', siteName: 'Example Org' })
  })

  it('falls back to <title> and the host name', async () => {
    const p = await unfurl('https://www.example.com/x', { fetch: async () => html('<title> Just a title </title>'), lookup: PUBLIC })
    expect(p).toEqual({ kind: 'page', title: 'Just a title', siteName: 'example.com' })
  })

  it('stops reading at maxBytes and still parses the head', async () => {
    let pulled = 0
    const head = '<html><head><meta property="og:title" content="Big page"></head><body>'
    const chunk = new Uint8Array(64 * 1024).fill(120)
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(head))
      },
      pull(c) {
        pulled += chunk.length
        c.enqueue(chunk)
        if (pulled >= 2 * 1024 * 1024) c.close()
      },
    })
    const res = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    const p = await unfurl('https://example.com/big', { fetch: async () => res, lookup: PUBLIC, maxBytes: 128 * 1024 })
    expect(p?.title).toBe('Big page')
    expect(pulled).toBeLessThan(512 * 1024)
  })
})

describe('unfurl: refuses private destinations', () => {
  const blocked = ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a00:1']
  for (const ip of blocked) {
    it(`a lookup answering ${ip} returns null without fetching`, async () => {
      const fetch = vi.fn()
      expect(await unfurl('https://example.com/', { fetch: fetch as never, lookup: async () => [ip] })).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  }

  it('refuses a lookup that mixes a public and a private answer', async () => {
    const fetch = vi.fn()
    expect(await unfurl('https://example.com/', { fetch: fetch as never, lookup: async () => ['93.184.216.34', '10.0.0.1'] })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a lookup that answers nothing', async () => {
    const fetch = vi.fn()
    expect(await unfurl('https://example.com/', { fetch: fetch as never, lookup: async () => [] })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  for (const literal of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/', 'http://[fe80::1]/', 'http://2130706433/']) {
    it(`refuses the literal ${literal} even when lookup says public`, async () => {
      const fetch = vi.fn()
      expect(await unfurl(literal, { fetch: fetch as never, lookup: PUBLIC })).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })
  }

  it('refuses a scheme other than http and https', async () => {
    const fetch = vi.fn()
    expect(await unfurl('file:///etc/passwd', { fetch: fetch as never, lookup: PUBLIC })).toBeNull()
    expect(await unfurl('ftp://example.com/x', { fetch: fetch as never, lookup: PUBLIC })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a redirect into a private address', async () => {
    const lookup = async (host: string) => (host === 'internal.example' ? ['10.0.0.5'] : ['93.184.216.34'])
    const fetch = vi.fn(async () => redirect('http://internal.example/admin'))
    expect(await unfurl('https://example.com/', { fetch: fetch as never, lookup })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect to a literal private address', async () => {
    const fetch = vi.fn(async () => redirect('http://169.254.169.254/'))
    expect(await unfurl('https://example.com/', { fetch: fetch as never, lookup: PUBLIC })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('follows 3 redirects and refuses a 4th', async () => {
    let n = 0
    const fetch = vi.fn(async () => (++n <= 3 ? redirect(`https://example.com/${n}`) : html('<title>ok</title>')))
    expect((await unfurl('https://example.com/', { fetch: fetch as never, lookup: PUBLIC }))?.title).toBe('ok')
    n = -1
    const loop = vi.fn(async () => redirect('https://example.com/again'))
    expect(await unfurl('https://example.com/', { fetch: loop as never, lookup: PUBLIC })).toBeNull()
    expect(loop).toHaveBeenCalledTimes(4)
  })

  it('names the package in the User-Agent and never auto-follows redirects', async () => {
    const fetch = vi.fn(async () => html('<title>t</title>'))
    await unfurl('https://example.com/', { fetch: fetch as never, lookup: PUBLIC })
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(String((init.headers as Record<string, string>)['User-Agent'])).toContain('annotated-links')
  })
})

describe('unfurl: never blocks a share', () => {
  it('resolves null within timeoutMs when fetch hangs and ignores the abort signal', async () => {
    const started = Date.now()
    const p = await unfurl('https://example.com/', { fetch: () => new Promise<Response>(() => {}), lookup: PUBLIC, timeoutMs: 60 })
    expect(p).toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('resolves null when the lookup hangs', async () => {
    expect(await unfurl('https://example.com/', { fetch: vi.fn() as never, lookup: () => new Promise<string[]>(() => {}), timeoutMs: 60 })).toBeNull()
  })

  it('resolves null when the body stalls mid-read', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('<html>')) } })
    const res = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    expect(await unfurl('https://example.com/', { fetch: async () => res, lookup: PUBLIC, timeoutMs: 60 })).toBeNull()
  })

  it('returns null on any thrown error, a bad url, or a non-2xx answer', async () => {
    expect(await unfurl('https://example.com/', { fetch: async () => { throw new Error('boom') }, lookup: PUBLIC })).toBeNull()
    expect(await unfurl('https://example.com/', { fetch: vi.fn() as never, lookup: async () => { throw new Error('dns') } })).toBeNull()
    expect(await unfurl('not a url', { fetch: vi.fn() as never, lookup: PUBLIC })).toBeNull()
    expect(await unfurl('https://example.com/', { fetch: async () => new Response('no', { status: 404 }), lookup: PUBLIC })).toBeNull()
    expect(await unfurl('https://www.youtube.com/watch?v=abc123', { fetch: async () => new Response('x', { status: 500 }), lookup: PUBLIC })).toBeNull()
  })
})
