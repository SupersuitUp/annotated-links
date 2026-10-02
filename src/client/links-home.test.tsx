import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./vault.js', async (orig) => {
  const { memoryVault } = await import('@supersuit/cowitness/client')
  const v = memoryVault()
  return { ...(await orig<typeof import('./vault.js')>()), linksVault: () => v }
})

import { LinksHome } from './links-home.js'
import { link, setUp, stubFetch } from '../../test/support/links-client.js'

const LINKS = [
  link({ id: 'a', by: 'bo', to: ['ada'], why: 'unseen from bo about rockets', at: '2026-09-05T00:00:00.000Z' }),
  link({ id: 'b', by: 'bo', to: ['ada'], why: 'seen from bo about gardens', at: '2026-09-04T00:00:00.000Z', seenBy: { ada: 'x' } }),
  link({ id: 'c', by: 'ada', to: ['bo'], why: 'mine about rockets too', at: '2026-09-06T00:00:00.000Z', preview: null }),
]

beforeEach(() => { setUp(); stubFetch() })
afterEach(() => vi.unstubAllGlobals())

describe('LinksHome', () => {
  it('shows unseen links first, then the whole library newest first', () => {
    render(<LinksHome links={LINKS} me="ada" />)
    const unseen = screen.getByRole('region', { name: 'Unseen' })
    expect(within(unseen).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/a'])
    const library = screen.getByRole('region', { name: 'Library' })
    expect(within(library).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/c', '/links/a', '/links/b'])
  })

  it('has no Unseen section when nothing is waiting', () => {
    render(<LinksHome links={[LINKS[1], LINKS[2]]} me="ada" />)
    expect(screen.queryByRole('region', { name: 'Unseen' })).toBeNull()
  })

  it('filters the library by sender', () => {
    render(<LinksHome links={LINKS} me="ada" />)
    fireEvent.click(screen.getByRole('button', { name: 'From Bo' }))
    const library = screen.getByRole('region', { name: 'Library' })
    expect(within(library).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/a', '/links/b'])
    fireEvent.click(screen.getByRole('button', { name: 'From you' }))
    expect(within(library).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/c'])
    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }))
    expect(within(library).getAllByRole('link')).toHaveLength(3)
  })

  it('searches the why, the title and the site', () => {
    render(<LinksHome links={LINKS} me="ada" />)
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'rockets' } })
    const library = screen.getByRole('region', { name: 'Library' })
    expect(within(library).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/c', '/links/a'])
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'nothing like this' } })
    expect(within(library).getByText('No links match.')).toBeInTheDocument()
  })

  it('offers sharing a link', () => {
    render(<LinksHome links={[]} me="ada" />)
    expect(screen.getByRole('link', { name: 'Share a link' })).toHaveAttribute('href', '/links/share')
  })
})
