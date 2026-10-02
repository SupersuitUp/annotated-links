import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./voice-recorder.js', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded(r: { blob: Blob; durationSec: number; id: string; heard: boolean }): void }) => (
    <button type="button" onClick={() => onRecorded({ blob: new Blob(['ab'], { type: 'audio/webm;codecs=opus' }), durationSec: 6, id: 'r-reply-0001', heard: true })}>Record reply</button>
  ),
}))
vi.mock('./vault.js', async (orig) => {
  const { memoryVault } = await import('@supersuit/cowitness/client')
  const v = memoryVault()
  return { ...(await orig<typeof import('./vault.js')>()), linksVault: () => v }
})

import { StrictMode } from 'react'
import { LinkDetail } from './link-detail.js'
import { linksVault } from './vault.js'
import { bodyOf, callsTo, link, setUp, stubFetch } from '../../test/support/links-client.js'

beforeEach(() => setUp())
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const r of await linksVault().all()) await linksVault().delete(r.id)
})

describe('LinkDetail', () => {
  it('puts the why above the link card, in the heading face', () => {
    stubFetch()
    render(<LinkDetail link={link()} me="ada" />)
    const why = screen.getByText('this is exactly the onboarding problem we keep hitting')
    const card = screen.getByRole('link', { name: /A post/ })
    expect(why.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('plays a spoken why from the why address, with its words beneath', () => {
    stubFetch()
    const { container } = render(<LinkDetail link={link({ why: '', spokenWhy: { path: 'p', contentType: 'audio/mp4', durationSec: 9, words: 'the part at fourteen minutes' } })} me="bo" />)
    expect(container.querySelector('audio')).toHaveAttribute('src', '/api/links/l1/replies/why/audio')
    expect(screen.getByText('the part at fourteen minutes')).toBeInTheDocument()
  })

  it('shows the sender "Seen" once a recipient opened it, and nothing before', () => {
    stubFetch()
    const { rerender } = render(<LinkDetail link={link()} me="ada" />)
    expect(screen.queryByText('Seen')).toBeNull()
    rerender(<LinkDetail key="2" link={link({ seenBy: { bo: '2026-09-03T13:00:00.000Z' } })} me="ada" />)
    expect(screen.getByText('Seen')).toBeInTheDocument()
  })

  it('does not show "Seen" to the recipient', () => {
    stubFetch()
    render(<LinkDetail link={link({ seenBy: { bo: '2026-09-03T13:00:00.000Z' } })} me="bo" />)
    expect(screen.queryByText('Seen')).toBeNull()
  })

  it('marks it seen once when a recipient opens it, even under StrictMode', async () => {
    const f = stubFetch((url) => (url === '/api/links/l1/seen' ? Response.json(link({ seenBy: { bo: 'x' } })) : undefined))
    render(<StrictMode><LinkDetail link={link()} me="bo" /></StrictMode>)
    await waitFor(() => expect(callsTo(f, '/api/links/l1/seen')).toHaveLength(1))
  })

  it('never marks it seen for the sender', async () => {
    const f = stubFetch()
    render(<LinkDetail link={link()} me="ada" />)
    await act(async () => {})
    expect(callsTo(f, '/api/links/l1/seen')).toHaveLength(0)
  })

  it('sends a typed reply and adds it to the thread', async () => {
    const f = stubFetch((url, init) => url === '/api/links/l1/replies'
      ? Response.json(link({ replies: [{ id: 'x1', by: 'ada', at: '2026-09-03T14:00:00.000Z', text: bodyOf(init).text }] }))
      : undefined)
    render(<LinkDetail link={link()} me="ada" />)
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'watching it tonight' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(await screen.findByText('watching it tonight')).toBeInTheDocument()
    expect(bodyOf(callsTo(f, '/api/links/l1/replies')[0][1])).toEqual({ text: 'watching it tonight' })
    expect(screen.getByLabelText('Reply')).toHaveValue('')
  })

  it('keeps a typed reply in the box and says why when the send fails', async () => {
    stubFetch((url) => (url === '/api/links/l1/replies' ? Response.json({ error: 'that link is gone' }, { status: 404 }) : undefined))
    render(<LinkDetail link={link()} me="ada" />)
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'watching it tonight' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(await screen.findByText('that link is gone')).toBeInTheDocument()
    expect(screen.getByLabelText('Reply')).toHaveValue('watching it tonight')
  })

  it('sends a spoken reply through its ticket and lets go of the held copy once filed', async () => {
    const f = stubFetch((url, init) => {
      if (url === '/api/links/l1/reply-upload-url') return Response.json({ uploaded: true })
      if (url === '/api/links/l1/replies') return Response.json(link({ replies: [{ id: bodyOf(init).replyId, by: 'ada', at: '2026-09-03T14:00:00.000Z', voice: { path: 'p', contentType: 'audio/webm', durationSec: 6 } }] }))
      return undefined
    })
    render(<LinkDetail link={link()} me="ada" />)
    await act(async () => {})
    // The recorder held it under the link's key as it recorded; the stand-in does what the real one does.
    await linksVault().put({ id: 'r-reply-0001', noteId: 'link:l1', mimeType: 'audio/webm', createdAt: '', durationSec: 6, stopped: true, chunks: [new Blob(['ab'])] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record reply' })) })
    await waitFor(() => expect(callsTo(f, '/api/links/l1/replies')).toHaveLength(1))
    expect(bodyOf(callsTo(f, '/api/links/l1/replies')[0][1])).toEqual({ replyId: 'r-reply-0001', contentType: 'audio/webm', durationSec: 6 })
    await waitFor(async () => expect(await linksVault().get('r-reply-0001')).toBeUndefined())
    expect(document.querySelector('audio[src="/api/links/l1/replies/r-reply-0001/audio"]')).not.toBeNull()
  })

  it('resends a reply held from an earlier visit when the page opens', async () => {
    await linksVault().put({ id: 'r-held-00001', noteId: 'link:l1', mimeType: 'audio/mp4', createdAt: '', durationSec: 5, stopped: true, chunks: [new Blob(['ab'])] })
    const f = stubFetch((url, init) => {
      if (url === '/api/links/l1/reply-upload-url') return Response.json({ uploaded: true })
      if (url === '/api/links/l1/replies') return Response.json(link({ replies: [{ id: bodyOf(init).replyId, by: 'ada', at: 'x', voice: { path: 'p', contentType: 'audio/mp4', durationSec: 5 } }] }))
      return undefined
    })
    render(<LinkDetail link={link()} me="ada" />)
    await waitFor(() => expect(callsTo(f, '/api/links/l1/replies')).toHaveLength(1))
    await waitFor(async () => expect(await linksVault().get('r-held-00001')).toBeUndefined())
  })

  it('names who replied, and shows a reply\'s missing words with Try again', async () => {
    const f = stubFetch((url) => url === '/api/links/l1/replies/v1/transcribe'
      ? Response.json(link({ replies: [{ id: 'v1', by: 'bo', at: 'x', voice: { path: 'p', contentType: 'audio/mp4', durationSec: 5, words: 'got it now' } }] }))
      : undefined)
    render(<LinkDetail link={link({ replies: [{ id: 'v1', by: 'bo', at: '2026-09-03T14:00:00.000Z', voice: { path: 'p', contentType: 'audio/mp4', durationSec: 5, wordsError: 'the recording could not be made out' } }] })} me="ada" />)
    expect(screen.getByText('Bo')).toBeInTheDocument()
    expect(screen.getByText(/the recording could not be made out/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByText('got it now')).toBeInTheDocument()
    expect(callsTo(f, '/api/links/l1/replies/v1/transcribe')).toHaveLength(1)
  })
})
