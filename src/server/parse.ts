import { RuleError } from '../errors.js'

// Everything a request body says is checked here before the store reads anything.

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024
export const AUDIO_MAX_SEC = 300
export const REPLY_MAX_CHARS = 2000
export const WHY_MAX_CHARS = 4000
export const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac'] as const

const EXT: Record<string, string> = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
}
export const audioPathExt = (contentType: string): string => EXT[contentType] ?? 'bin'

const CLIENT_ID_RE = /^[\w-]{8,64}$/

// An id the phone made for its own held recording. It becomes part of a storage path, so nothing
// but letters, numbers, - and _ gets in.
export function parseClientId(v: unknown, name: string): string {
  if (typeof v !== 'string' || !CLIENT_ID_RE.test(v)) throw new RuleError(`${name} must be 8 to 64 letters, numbers, - or _`, 400)
  return v
}

export function parseAudioType(v: unknown): string {
  const ct = typeof v === 'string' ? v.split(';')[0].trim() : ''
  if (!(AUDIO_TYPES as readonly string[]).includes(ct)) throw new RuleError('unsupported audio type', 400)
  return ct
}

export function parseDuration(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new RuleError('durationSec must be a number above 0', 400)
  if (v > AUDIO_MAX_SEC) throw new RuleError('a voice note can be at most five minutes', 400)
  return v
}

export function parseSize(v: unknown): number {
  if (typeof v !== 'number' || !(v > 0)) throw new RuleError('size must be a number above 0', 400)
  if (v > AUDIO_MAX_BYTES) throw new RuleError('that recording is too large', 400)
  return v
}

export function parseClip(b: { contentType: unknown; size: unknown; durationSec: unknown }): { contentType: string; size: number; durationSec: number } {
  return { contentType: parseAudioType(b.contentType), size: parseSize(b.size), durationSec: parseDuration(b.durationSec) }
}

export function parseReplyText(v: unknown): string {
  if (typeof v !== 'string') throw new RuleError('text must be a string', 400)
  const text = v.trim()
  if (!text) throw new RuleError('Write something first.', 400)
  if (text.length > REPLY_MAX_CHARS) throw new RuleError(`A reply can be at most ${REPLY_MAX_CHARS} characters.`, 400)
  return text
}

export interface ShareInput {
  url: string
  why: string
  to?: string[]
  spokenWhy?: { id: string; contentType: string; durationSec: number; heard: boolean }
}

// The shape only. Who `to` may name, the why minimum and whether voice is on are the store's.
export function parseShareBody(body: unknown): ShareInput {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.url !== 'string' || !b.url.trim()) throw new RuleError('url is required', 400)
  if (b.why !== undefined && typeof b.why !== 'string') throw new RuleError('why must be a string', 400)
  const why = ((b.why as string | undefined) ?? '').trim()
  if (why.length > WHY_MAX_CHARS) throw new RuleError(`A why can be at most ${WHY_MAX_CHARS} characters.`, 400)
  const out: ShareInput = { url: b.url, why }
  if (b.to !== undefined) {
    if (!Array.isArray(b.to) || !b.to.every((x) => typeof x === 'string')) throw new RuleError('to must be a list of people', 400)
    out.to = b.to as string[]
  }
  if (b.spokenWhy !== undefined) {
    const s = (b.spokenWhy ?? {}) as Record<string, unknown>
    if (typeof s.heard !== 'boolean') throw new RuleError('spokenWhy.heard must be true or false', 400)
    out.spokenWhy = { id: parseClientId(s.id, 'spokenWhy.id'), contentType: parseAudioType(s.contentType), durationSec: parseDuration(s.durationSec), heard: s.heard }
  }
  return out
}
