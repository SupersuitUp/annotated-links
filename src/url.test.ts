import { describe, expect, it } from 'vitest'
import { RuleError } from './errors.js'
import { normalizeUrl, youtubeOf } from './url.js'

describe('normalizing a link', () => {
  it('refuses anything that is not http or https', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x', 'data:text/html,hi', 'file:///etc/passwd', 'not a url', '']) {
      let err: unknown
      try { normalizeUrl(bad) } catch (e) { err = e }
      expect(err, bad).toBeInstanceOf(RuleError)
      expect((err as RuleError).status).toBe(400)
    }
  })

  it('strips tracking parameters and keeps the ones that change the page', () => {
    const { url, key } = normalizeUrl('https://Example.com/post?utm_source=x&utm_medium=y&si=1&fbclid=2&gclid=3&igshid=4&ref_src=5&id=7&t=30')
    expect(url).toBe('https://example.com/post?id=7&t=30')
    expect(key).toBe('example.com/post?id=7&t=30')
  })

  it('lowercases the host and drops the trailing slash and the fragment in the key', () => {
    expect(normalizeUrl('https://EXAMPLE.com/Path/').key).toBe('example.com/Path')
    expect(normalizeUrl('https://example.com/').key).toBe('example.com')
    expect(normalizeUrl('https://example.com/a#section').key).toBe('example.com/a')
    expect(normalizeUrl('  http://example.com/a  ').url).toBe('http://example.com/a')
  })

  it('gives the same key whatever order the parameters come in', () => {
    expect(normalizeUrl('https://example.com/a?b=1&c=2').key).toBe(normalizeUrl('https://example.com/a?c=2&b=1').key)
  })

  it('keys every form of one YouTube video the same', () => {
    expect(normalizeUrl('https://youtu.be/abc?t=840').key).toBe('youtube:abc')
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc&t=14m').key).toBe('youtube:abc')
    expect(normalizeUrl('https://m.youtube.com/watch?v=abc&si=zzz').key).toBe('youtube:abc')
    expect(normalizeUrl('https://www.youtube.com/shorts/abc').key).toBe('youtube:abc')
  })

  it('keeps the start time on the YouTube url itself', () => {
    expect(normalizeUrl('https://youtu.be/abc?t=840&si=q').url).toBe('https://youtu.be/abc?t=840')
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc&t=14m&utm_source=x').url).toBe('https://www.youtube.com/watch?v=abc&t=14m')
  })
})

describe('reading a YouTube link', () => {
  it('finds the id and the start second in every form', () => {
    expect(youtubeOf('https://youtu.be/abc?t=840')).toEqual({ id: 'abc', startSec: 840 })
    expect(youtubeOf('https://www.youtube.com/watch?v=abc&t=14m0s')).toEqual({ id: 'abc', startSec: 840 })
    expect(youtubeOf('https://www.youtube.com/watch?v=abc&start=840')).toEqual({ id: 'abc', startSec: 840 })
    expect(youtubeOf('https://www.youtube.com/watch?v=abc&t=1h2m3s')).toEqual({ id: 'abc', startSec: 3723 })
    expect(youtubeOf('https://www.youtube.com/watch?v=abc&t=840s')).toEqual({ id: 'abc', startSec: 840 })
    expect(youtubeOf('https://www.youtube.com/embed/abc')).toEqual({ id: 'abc' })
  })

  it('has no start second when none is given', () => {
    expect(youtubeOf('https://youtu.be/abc')).toEqual({ id: 'abc' })
  })

  it('is null for anything else', () => {
    expect(youtubeOf('https://example.com/watch?v=abc')).toBeNull()
    expect(youtubeOf('https://www.youtube.com/')).toBeNull()
    expect(youtubeOf('https://notyoutube.com/watch?v=abc')).toBeNull()
    expect(youtubeOf('nonsense')).toBeNull()
  })
})
