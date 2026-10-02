import { describe, expect, it } from 'vitest'
import { AUDIO_MAX_BYTES, AUDIO_MAX_SEC, audioPathExt, parseClip, parseClientId, parseReplyText, parseShareBody } from './parse.js'

const status = (fn: () => unknown) => {
  try { fn() } catch (err) { return (err as { status?: number }).status }
  return 'ok'
}

describe('parse', () => {
  it('takes a client id of 8 to 64 safe characters', () => {
    expect(parseClientId('abc-1234_x', 'id')).toBe('abc-1234_x')
    for (const bad of ['short', '../../etc/passwd', 'a'.repeat(65), 7, undefined]) expect(status(() => parseClientId(bad, 'id'))).toBe(400)
  })

  it('caps a clip at 25 MB and 300 seconds, audio types only', () => {
    expect(AUDIO_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(AUDIO_MAX_SEC).toBe(300)
    expect(parseClip({ contentType: 'audio/webm;codecs=opus', size: 10, durationSec: 3 })).toEqual({ contentType: 'audio/webm', size: 10, durationSec: 3 })
    expect(status(() => parseClip({ contentType: 'audio/webm', size: 0, durationSec: 3 }))).toBe(400)
    expect(status(() => parseClip({ contentType: 'audio/webm', size: 10, durationSec: 0 }))).toBe(400)
    expect(status(() => parseClip({ contentType: 'audio/webm', size: 10, durationSec: Number.NaN }))).toBe(400)
    expect(status(() => parseClip({ contentType: 'video/mp4', size: 10, durationSec: 3 }))).toBe(400)
    expect(audioPathExt('audio/mp4')).toBe('m4a')
  })

  it('trims a reply to 1-2000 characters', () => {
    expect(parseReplyText('  hi ')).toBe('hi')
    expect(status(() => parseReplyText(''))).toBe(400)
    expect(status(() => parseReplyText('x'.repeat(2001)))).toBe(400)
  })

  it('reads a share body, leaving `to` undefined when left out', () => {
    expect(parseShareBody({ url: 'https://a', why: 'w' })).toEqual({ url: 'https://a', why: 'w' })
    expect(parseShareBody({ url: 'https://a', to: ['ben'] })).toEqual({ url: 'https://a', why: '', to: ['ben'] })
    expect(status(() => parseShareBody({ why: 'w' }))).toBe(400)
    expect(status(() => parseShareBody({ url: 'https://a', why: 3 }))).toBe(400)
    expect(status(() => parseShareBody({ url: 'https://a', to: 'ben' }))).toBe(400)
    expect(status(() => parseShareBody({ url: 'https://a', spokenWhy: { id: 'why-0001', contentType: 'audio/webm', durationSec: 4 } }))).toBe(400)
    expect(parseShareBody({ url: 'https://a', spokenWhy: { id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true } }).spokenWhy)
      .toEqual({ id: 'why-0001', contentType: 'audio/webm', durationSec: 4, heard: true })
  })
})
