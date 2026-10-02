import { describe, expect, it } from 'vitest'
import { DEFAULT_MIN_WHY_WORDS, MIN_SPOKEN_WHY_SEC, whyProblem, whyWords } from './why.js'

const URL_ = 'https://example.com/a'
const eight = 'this made me think of our spring trip'
const seven = 'this made me think of our trip'

describe('counting the words of a why', () => {
  it('counts runs of letters and digits', () => {
    expect(whyWords('lol')).toBe(1)
    expect(whyWords('you will love this, 100%')).toBe(5)
    expect(whyWords('  ')).toBe(0)
    expect(whyWords('')).toBe(0)
  })

  it('never counts a URL or bare punctuation', () => {
    expect(whyWords('https://x.com/a')).toBe(0)
    expect(whyWords('see https://x.com/a/b?c=d now')).toBe(2)
    expect(whyWords('www.example.com/page')).toBe(0)
    expect(whyWords('!!! ... --- ???')).toBe(0)
  })
})

describe('the minimum for a typed why', () => {
  it('defaults to eight words and three seconds', () => {
    expect(DEFAULT_MIN_WHY_WORDS).toBe(8)
    expect(MIN_SPOKEN_WHY_SEC).toBe(3)
  })

  it('passes at the minimum and fails one word under, saying how far', () => {
    expect(whyWords(eight)).toBe(8)
    expect(whyProblem(eight, URL_, 8)).toBeNull()
    expect(whyProblem(seven, URL_, 8)).toBe('Say a little more about why: 7 of 8 words.')
  })

  it('does not count the link itself toward the why', () => {
    expect(whyProblem(`${URL_} ${seven}`, URL_, 8)).toBe('Say a little more about why: 7 of 8 words.')
    expect(whyProblem(`${URL_} lol ok sure`, URL_, 8)).toBe('Say a little more about why: 3 of 8 words.')
    expect(whyProblem('example.com/a', URL_, 8)).toBe('Say a little more about why: 0 of 8 words.')
  })

  it('treats a minimum below one as one', () => {
    expect(whyProblem('', URL_, 0)).toBe('Say a little more about why: 0 of 1 words.')
    expect(whyProblem('lol', URL_, -3)).toBeNull()
    expect(whyProblem('lol', URL_, 0)).toBeNull()
  })
})

describe('a spoken why', () => {
  it('stands in for the typed one when it is at least three seconds and speech was heard', () => {
    expect(whyProblem('', URL_, 8, { durationSec: 3, heard: true })).toBeNull()
    expect(whyProblem('', URL_, 8, { durationSec: 10, heard: true })).toBeNull()
  })

  it('fails under three seconds', () => {
    expect(whyProblem('', URL_, 8, { durationSec: 2.9, heard: true })).toBe(
      'Say a little more about why: the voice note is under 3 seconds.',
    )
  })

  it('fails when no speech was heard, however long it ran', () => {
    expect(whyProblem('', URL_, 8, { durationSec: 10, heard: false })).not.toBeNull()
  })

  it('is not needed when the typed why already meets the minimum', () => {
    expect(whyProblem(eight, URL_, 8, { durationSec: 1, heard: false })).toBeNull()
  })
})
