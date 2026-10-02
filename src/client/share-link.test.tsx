import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('./voice-recorder.js', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded(r: { blob: Blob; durationSec: number; id: string; heard: boolean }): void }) => (
    <>
      <button type="button" onClick={() => onRecorded({ blob: new Blob(['ab'], { type: 'audio/mp4' }), durationSec: 4, id: 'r-why-heard', heard: true })}>Record 4s heard</button>
      <button type="button" onClick={() => onRecorded({ blob: new Blob(['ab'], { type: 'audio/mp4' }), durationSec: 2, id: 'r-why-short', heard: true })}>Record 2s heard</button>
      <button type="button" onClick={() => onRecorded({ blob: new Blob(['ab'], { type: 'audio/mp4' }), durationSec: 5, id: 'r-why-quiet', heard: false })}>Record 5s silent</button>
    </>
  ),
}))
vi.mock('./vault.js', async (orig) => {
  const { memoryVault } = await import('@supersuit/cowitness/client')
  const v = memoryVault()
  return { ...(await orig<typeof import('./vault.js')>()), linksVault: () => v }
})

import { ShareLink } from './share-link.js'
import { linksVault } from './vault.js'
import { bodyOf, callsTo, link, setUp, stubFetch } from '../../test/support/links-client.js'

const SEVEN = 'one two three four five six seven'
const EIGHT = 'one two three four five six seven eight'
const typeWhy = (v: string) => fireEvent.change(screen.getByLabelText('Why are you sending this?'), { target: { value: v } })
const typeUrl = (v: string) => fireEvent.change(screen.getByLabelText('Link'), { target: { value: v } })
const share = () => screen.getByRole('button', { name: 'Share' })

const previewOk = (url: string) => url === '/api/links/preview'
  ? Response.json({ kind: 'page', title: 'A post', siteName: 'Example', description: 'About it' })
  : undefined
const shareOk = (earlier: unknown = null) => (url: string, init: RequestInit | undefined) =>
  url === '/api/links' && init?.method === 'POST' ? Response.json({ link: link({ id: 'new1', why: bodyOf(init).why }), earlier }) : undefined

beforeEach(() => { setUp(); push.mockReset() })
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const r of await linksVault().all()) await linksVault().delete(r.id)
})

describe('ShareLink', () => {
  it('keeps Share off at 7 words and turns it on at 8', () => {
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    typeWhy(SEVEN)
    expect(share()).toBeDisabled()
    typeWhy(EIGHT)
    expect(share()).toBeEnabled()
  })

  it('counts the words live, "n of min words"', () => {
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    expect(screen.getByText('0 of 8 words')).toBeInTheDocument()
    typeWhy('three words here')
    expect(screen.getByText('3 of 8 words')).toBeInTheDocument()
    expect(screen.getByText('Say a little more about why: 3 of 8 words.')).toBeInTheDocument()
  })

  it('says what is missing on an empty form: the link, and the why', () => {
    stubFetch(previewOk)
    render(<ShareLink people={['ada', 'bo']} />)
    expect(screen.getByText('Paste a web link (https://…)')).toBeInTheDocument()
    expect(screen.getByText('Say a little more about why: 0 of 8 words.')).toBeInTheDocument()
    typeUrl('not a link')
    expect(screen.getByText('Paste a web link (https://…)')).toBeInTheDocument()
    typeUrl('https://example.com/post')
    expect(screen.queryByText('Paste a web link (https://…)')).toBeNull()
  })

  it('does not count the pasted link as words, the same as the rule', () => {
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    typeWhy('see example.com/post please')
    expect(screen.getByText('2 of 8 words')).toBeInTheDocument()
  })

  it('offers back a why recorded on an earlier visit and never shared, under its own draft', async () => {
    await linksVault().put({ id: 'r-earlier-01', noteId: 'link-why:draft-earlier', mimeType: 'audio/mp4', createdAt: new Date().toISOString(), durationSec: 6, stopped: true, chunks: [new Blob(['ab'])], meta: { heard: true } })
    const f = stubFetch(previewOk, (url) => (url === '/api/links/why-upload-url' ? Response.json({ uploaded: true }) : undefined), shareOk())
    render(<ShareLink people={['ada', 'bo']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use your recorded why (6 s)' }))
    typeUrl('https://example.com/post')
    expect(share()).toBeEnabled()
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/links/new1'))
    const body = bodyOf(callsTo(f, '/api/links')[0][1])
    expect(body.shareId).toBe('draft-earlier')
    expect(body.spokenWhy).toEqual({ id: 'r-earlier-01', contentType: 'audio/mp4', durationSec: 6, heard: true })
  })

  it('does not offer an earlier why when a link was handed in', async () => {
    await linksVault().put({ id: 'r-earlier-01', noteId: 'link-why:draft-earlier', mimeType: 'audio/mp4', createdAt: new Date().toISOString(), durationSec: 6, stopped: true, chunks: [new Blob(['ab'])], meta: { heard: true } })
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Use your recorded why/ })).toBeNull()
  })

  it('counts the minimum the app set', () => {
    setUp({ minWhyWords: 3 })
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    typeWhy('three words here')
    expect(screen.getByText('3 of 3 words')).toBeInTheDocument()
    expect(share()).toBeEnabled()
  })

  it('turns Share on with an empty box and a 4 s recording in which speech was heard', () => {
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    expect(share()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Record 4s heard' }))
    expect(share()).toBeEnabled()
  })

  it('keeps Share off for a voice note under 3 s, or one with nothing heard, and says which', () => {
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record 2s heard' }))
    expect(share()).toBeDisabled()
    expect(screen.getByText('Say a little more about why: the voice note is under 3 seconds.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record 5s silent' }))
    expect(share()).toBeDisabled()
    expect(screen.getByText('Say a little more about why: no words were heard in the voice note.')).toBeInTheDocument()
  })

  it('has no record button when voice is off', () => {
    setUp({ voiceReplies: false })
    stubFetch(previewOk)
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    expect(screen.queryByRole('button', { name: 'Record 4s heard' })).toBeNull()
  })

  it('asks for the preview once, 400 ms after the typing stops', async () => {
    vi.useFakeTimers()
    const f = stubFetch(previewOk)
    render(<ShareLink people={['ada', 'bo']} />)
    typeUrl('https://example.com/p')
    await act(async () => { vi.advanceTimersByTime(200) })
    typeUrl('https://example.com/post')
    await act(async () => { vi.advanceTimersByTime(399) })
    expect(callsTo(f, '/api/links/preview')).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(callsTo(f, '/api/links/preview')).toHaveLength(1)
    expect(bodyOf(callsTo(f, '/api/links/preview')[0][1])).toEqual({ url: 'https://example.com/post' })
    vi.useRealTimers()
    expect(await screen.findByText('A post')).toBeInTheDocument()
  })

  it('still shares when the preview fails, showing the site by its name', async () => {
    const f = stubFetch((url) => (url === '/api/links/preview' ? Response.json({ error: 'boom' }, { status: 500 }) : undefined), shareOk())
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    await waitFor(() => expect(callsTo(f, '/api/links/preview')).toHaveLength(1))
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    typeWhy(EIGHT)
    expect(share()).toBeEnabled()
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/links/new1'))
  })

  it('shares to the one other person with a shareId, and routes to the new link', async () => {
    const f = stubFetch(previewOk, shareOk())
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    expect(screen.queryByRole('group', { name: 'Send to' })).toBeNull()
    typeWhy(EIGHT)
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/links/new1'))
    const body = bodyOf(callsTo(f, '/api/links')[0][1])
    expect(body).toMatchObject({ url: 'https://example.com/post', why: EIGHT, to: ['bo'] })
    expect(body.shareId).toMatch(/^[\w-]{8,64}$/)
  })

  it('sends the SAME shareId on a retry after a failure, and shows the server\'s words', async () => {
    let fail = true
    const f = stubFetch(previewOk, (url, init) => {
      if (url !== '/api/links' || init?.method !== 'POST') return undefined
      if (fail) { fail = false; return Response.json({ error: 'that is not a web address' }, { status: 400 }) }
      return Response.json({ link: link({ id: 'new1' }), earlier: null })
    })
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    typeWhy(EIGHT)
    await act(async () => { fireEvent.click(share()) })
    expect(await screen.findByText('that is not a web address')).toBeInTheDocument()
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/links/new1'))
    const ids = callsTo(f, '/api/links').map(([, i]) => bodyOf(i).shareId)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
  })

  it('with more than one other person, chips default to everyone else and can be narrowed', async () => {
    const f = stubFetch(previewOk, shareOk())
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo', 'cy']} />)
    const bo = screen.getByRole('button', { name: 'Bo' })
    const cy = screen.getByRole('button', { name: 'Cy' })
    expect(bo).toHaveAttribute('aria-pressed', 'true')
    expect(cy).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Ada' })).toBeNull()
    fireEvent.click(cy)
    typeWhy(EIGHT)
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(bodyOf(callsTo(f, '/api/links')[0][1]).to).toEqual(['bo'])
  })

  it('uploads a spoken why through its ticket before sharing, then lets the recording go', async () => {
    const order: string[] = []
    const f = stubFetch(previewOk, (url, init) => {
      if (url === '/api/links/why-upload-url') { order.push('ticket'); return Response.json({ url: 'https://storage.test/put', requiredHeaders: { 'Content-Type': 'audio/mp4' } }) }
      if (url === 'https://storage.test/put') { order.push('put'); return new Response(null, { status: 200 }) }
      if (url === '/api/links' && init?.method === 'POST') { order.push('share'); return Response.json({ link: link({ id: 'new1' }), earlier: null }) }
      return undefined
    })
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record 4s heard' }))
    // The recorder held it under the draft's key; the stand-in does what the real one does.
    await linksVault().put({ id: 'r-why-heard', noteId: 'link-why:x', mimeType: 'audio/mp4', createdAt: '', durationSec: 4, stopped: true, chunks: [new Blob(['ab'])] })
    await act(async () => { fireEvent.click(share()) })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/links/new1'))
    expect(order).toEqual(['ticket', 'put', 'share'])
    expect(bodyOf(callsTo(f, '/api/links/why-upload-url')[0][1])).toEqual({ id: 'r-why-heard', contentType: 'audio/mp4', size: 2, durationSec: 4 })
    const put = f.mock.calls.find(([u]) => String(u) === 'https://storage.test/put')!
    expect(put[1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/mp4' } })
    expect(bodyOf(callsTo(f, '/api/links')[0][1]).spokenWhy).toEqual({ id: 'r-why-heard', contentType: 'audio/mp4', durationSec: 4, heard: true })
    expect(await linksVault().get('r-why-heard')).toBeUndefined()
  })

  it('keeps a spoken why on the phone when the share fails, marked as sent for the next visit', async () => {
    stubFetch(previewOk, (url) => (url === '/api/links/why-upload-url' ? Response.json({ error: 'offline' }, { status: 503 }) : undefined))
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record 4s heard' }))
    await linksVault().put({ id: 'r-why-heard', noteId: 'link-why:x', mimeType: 'audio/mp4', createdAt: '', durationSec: 4, stopped: true, chunks: [new Blob(['ab'])] })
    await act(async () => { fireEvent.click(share()) })
    expect(await screen.findByText('offline')).toBeInTheDocument()
    const held = await linksVault().get('r-why-heard')
    expect(held?.meta).toMatchObject({ submitted: true, url: 'https://example.com/post', to: ['bo'], heard: true })
    expect(push).not.toHaveBeenCalled()
  })

  it('says when it was already sent, links the earlier one, then goes on to the new link', async () => {
    stubFetch(previewOk, shareOk(link({ id: 'old1', at: '2026-09-03T12:00:00.000Z', to: ['bo'] })))
    render(<ShareLink initialUrl="https://example.com/post" people={['ada', 'bo']} />)
    typeWhy(EIGHT)
    await act(async () => { fireEvent.click(share()) })
    expect(await screen.findByText(/You sent this to Bo on Sep 3\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the earlier one' })).toHaveAttribute('href', '/links/old1')
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Go to your link' }))
    expect(push).toHaveBeenCalledWith('/links/new1')
  })
})
