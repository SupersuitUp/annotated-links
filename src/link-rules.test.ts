import { describe, expect, it } from 'vitest'
import { alreadySent, linksTile, matches, mayRead, unseenFor } from './link-rules.js'
import type { AnnotatedLink } from './types.js'

type M = 'ann' | 'ben' | 'cy'

function link(over: Partial<AnnotatedLink<M>> = {}): AnnotatedLink<M> {
  return {
    id: 'l1', by: 'ann', to: ['ben'], url: 'https://example.com/a', key: 'example.com/a',
    why: 'this reminded me of the thing we said about maps', at: '2026-01-01T10:00:00.000Z',
    preview: null, seenBy: {}, replies: [], via: 'app', ...over,
  }
}

describe('who may read a link', () => {
  it('is the sender and the people it was sent to, and nobody else', () => {
    const l = link({ by: 'ann', to: ['ben'] })
    expect(mayRead(l, 'ann')).toBe(true)
    expect(mayRead(l, 'ben')).toBe(true)
    expect(mayRead(l, 'cy')).toBe(false)
  })
})

describe('what is unseen', () => {
  it('is what was sent to the person and not yet seen by them, newest first', () => {
    const old = link({ id: 'old', at: '2026-01-01T00:00:00.000Z' })
    const fresh = link({ id: 'fresh', at: '2026-01-03T00:00:00.000Z' })
    const mid = link({ id: 'mid', at: '2026-01-02T00:00:00.000Z' })
    expect(unseenFor([old, fresh, mid], 'ben').map((l) => l.id)).toEqual(['fresh', 'mid', 'old'])
  })

  it('leaves out what the person has seen', () => {
    const seen = link({ id: 'seen', seenBy: { ben: '2026-01-02T00:00:00.000Z' } })
    expect(unseenFor([seen, link({ id: 'new' })], 'ben').map((l) => l.id)).toEqual(['new'])
  })

  it('never includes the sender\'s own links, or links sent to someone else', () => {
    const mine = link({ id: 'mine', by: 'ben', to: ['ann'] })
    const notMine = link({ id: 'other', to: ['cy'] })
    expect(unseenFor([mine, notMine], 'ben')).toEqual([])
    expect(unseenFor([mine], 'ben')).toEqual([])
  })

  it('does not reorder the list it was given', () => {
    const a = link({ id: 'a', at: '2026-01-01T00:00:00.000Z' })
    const b = link({ id: 'b', at: '2026-01-02T00:00:00.000Z' })
    const list = [a, b]
    unseenFor(list, 'ben')
    expect(list.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('a link already sent', () => {
  const sent = link({ id: 'sent', to: ['ben', 'cy'] })

  it('is found by its key, its sender and a recipient list it covers', () => {
    expect(alreadySent([sent], 'example.com/a', 'ann', ['ben'])?.id).toBe('sent')
    expect(alreadySent([sent], 'example.com/a', 'ann', ['ben', 'cy'])?.id).toBe('sent')
  })

  it('is not found for another key, another sender, or someone it did not go to', () => {
    expect(alreadySent([sent], 'example.com/b', 'ann', ['ben'])).toBeNull()
    expect(alreadySent([sent], 'example.com/a', 'ben', ['ann'])).toBeNull()
    expect(alreadySent([link({ to: ['ben'] })], 'example.com/a', 'ann', ['ben', 'cy'])).toBeNull()
  })

  it('answers with the newest when it was sent more than once', () => {
    const a = link({ id: 'a', at: '2026-01-01T00:00:00.000Z' })
    const b = link({ id: 'b', at: '2026-01-05T00:00:00.000Z' })
    expect(alreadySent([a, b], 'example.com/a', 'ann', ['ben'])?.id).toBe('b')
  })
})

describe('the tile for a person', () => {
  it('counts what they may read, what is unseen, and when the newest arrived', () => {
    const links = [
      link({ id: '1', at: '2026-01-01T00:00:00.000Z', seenBy: { ben: 'x' } }),
      link({ id: '2', at: '2026-01-04T00:00:00.000Z' }),
      link({ id: '3', to: ['cy'], at: '2026-01-09T00:00:00.000Z' }),
    ]
    expect(linksTile(links, 'ben')).toEqual({ count: 2, unseen: 1, newest: '2026-01-04T00:00:00.000Z' })
  })

  it('is empty when there is nothing', () => {
    expect(linksTile([], 'ben')).toEqual({ count: 0, unseen: 0, newest: null })
  })
})

describe('searching links', () => {
  const l = link({
    url: 'https://example.com/Maps', why: 'Cartography is wild',
    preview: { kind: 'page', title: 'The Atlas Problem', siteName: 'Longform' },
  })

  it('looks case-insensitively through the why, the title, the site and the url', () => {
    expect(matches(l, 'cartography')).toBe(true)
    expect(matches(l, 'ATLAS')).toBe(true)
    expect(matches(l, 'longform')).toBe(true)
    expect(matches(l, 'example.com/maps')).toBe(true)
    expect(matches(l, 'zebra')).toBe(false)
  })

  it('matches everything on an empty search, and copes with no preview', () => {
    expect(matches(l, '')).toBe(true)
    expect(matches(link(), 'maps')).toBe(true)
  })
})
