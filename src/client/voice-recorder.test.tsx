import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'

vi.mock('./vault.js', async (orig) => {
  const { memoryVault } = await import('@supersuit/cowitness/client')
  const v = memoryVault()
  return { ...(await orig<typeof import('./vault.js')>()), linksVault: () => v }
})

import { VoiceRecorder } from './voice-recorder.js'
import { linksVault } from './vault.js'
import { setUp, render } from '../../test/support/links-client.js'

// A recorder as the spec has it, the same stand-in cowitness's VoiceNote tests use.
let live: FakeRecorder | null = null
class FakeRecorder {
  static isTypeSupported = () => true
  constructor() { live = this } // eslint-disable-line @typescript-eslint/no-this-alias
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = 'audio/mp4'
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['ab'], { type: 'audio/mp4' }) }); this.onstop?.() }
}

const events: string[] = []
let level = 0
// An AudioContext whose analyser reads a steady `level` (RMS of a constant frame is that constant).
class FakeContext {
  constructor() { events.push('context') }
  createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: (f: Float32Array) => f.fill(level) } }
  createMediaStreamSource() { return { connect: () => {} } }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
}

let track: { stop: ReturnType<typeof vi.fn> }
beforeEach(() => {
  setUp()
  events.length = 0
  level = 0
  live = null
  track = { stop: vi.fn() }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeContext)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => { events.push('getUserMedia'); return { getTracks: () => [track] } }) },
  })
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const r of await linksVault().all()) await linksVault().delete(r.id)
})

// Record for `ms` of meter time, then stop, and answer what onRecorded got.
async function recordFor(ms: number) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  const onRecorded = vi.fn()
  render(<VoiceRecorder vaultKey={(id) => `link-why:d-${id}`} onRecorded={onRecorded} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
  await act(async () => { vi.advanceTimersByTime(ms) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })) })
  expect(onRecorded).toHaveBeenCalledTimes(1)
  return onRecorded.mock.calls[0][0] as { blob: Blob; durationSec: number; id: string; heard: boolean }
}

describe('VoiceRecorder', () => {
  it('makes the AudioContext inside the tap, before anything is awaited', async () => {
    render(<VoiceRecorder vaultKey={(id) => `link:l1-${id}`} onRecorded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    // Synchronously after the click, before the microphone could answer: the context came first.
    expect(events).toEqual(['context', 'getUserMedia'])
    await act(async () => {})
  })

  it('hands back the blob, its length, its held id and whether speech was heard', async () => {
    level = 0.1
    const r = await recordFor(4000)
    expect(r).toEqual({ blob: expect.any(Blob), durationSec: 4, id: expect.stringMatching(/^r-/), heard: true })
    expect(r.blob.type).toBe('audio/mp4')
    const held = await linksVault().get(r.id)
    expect(held).toMatchObject({ noteId: `link-why:d-${r.id}`, stopped: true, durationSec: 4, meta: { heard: true } })
    expect(track.stop).toHaveBeenCalled()
  })

  it('heard: false when the meter measured only silence', async () => {
    level = 0.005
    expect((await recordFor(4000)).heard).toBe(false)
  })

  it('heard: true when the meter read exactly nothing, because it was not measuring', async () => {
    level = 0
    expect((await recordFor(4000)).heard).toBe(true)
  })

  it('heard: true with no AudioContext at all', async () => {
    vi.stubGlobal('AudioContext', undefined)
    expect((await recordFor(4000)).heard).toBe(true)
  })

  it('says it is recording with aria-pressed, and announces only start and stop', async () => {
    render(<VoiceRecorder vaultKey={(id) => id} onRecorded={() => {}} />)
    expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true')
    const announced = document.querySelectorAll('[aria-live]')
    expect(announced).toHaveLength(1)
    expect(announced[0]).toHaveTextContent(/^Recording$/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })) })
    expect(document.querySelector('[aria-live]')).toHaveTextContent(/^Recording stopped$/)
  })

  it('walked away from mid-recording: the microphone off, nothing handed back, nothing held', async () => {
    const onRecorded = vi.fn()
    const { unmount } = render(<VoiceRecorder vaultKey={(id) => `link:l1-${id}`} onRecorded={onRecorded} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    expect(await linksVault().all()).toHaveLength(1)
    unmount()
    await act(async () => {})
    expect(track.stop).toHaveBeenCalled()
    expect(live?.state).toBe('inactive')
    expect(onRecorded).not.toHaveBeenCalled()
    expect(await linksVault().all()).toEqual([])
  })
})
