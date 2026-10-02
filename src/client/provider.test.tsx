import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./vault.js', async (orig) => {
  const { memoryVault } = await import('@supersuit/cowitness/client')
  const v = memoryVault()
  return { ...(await orig<typeof import('./vault.js')>()), linksVault: () => v }
})

import { LinksProvider } from './provider.js'
import { LinksHome } from './links-home.js'
import { DEFAULT_THEME } from './theme.js'
import { CONFIG, link, stubFetch } from '../../test/support/links-client.js'

const LINKS = [link({ id: 'a', by: 'ada', to: ['bo'] }), link({ id: 'b', by: 'bo', to: ['ada'] })]
const root = (scope: HTMLElement) => within(scope).getByRole('heading', { name: 'Links' }).parentElement!.parentElement!

afterEach(() => vi.unstubAllGlobals())

describe('LinksProvider', () => {
  it('keeps two providers side by side apart: each draws its own person and look', () => {
    stubFetch()
    render(
      <>
        <div data-testid="one">
          <LinksProvider config={{ ...CONFIG, me: 'ada' }} theme={{ paper: 'rgb(10, 10, 10)' }}><LinksHome links={LINKS} /></LinksProvider>
        </div>
        <div data-testid="two">
          <LinksProvider config={{ ...CONFIG, me: 'bo' }} theme={{ paper: 'rgb(20, 20, 20)' }}><LinksHome links={LINKS} /></LinksProvider>
        </div>
      </>,
    )
    const one = screen.getByTestId('one')
    const two = screen.getByTestId('two')
    expect(root(one)).toHaveStyle({ backgroundColor: 'rgb(10, 10, 10)' })
    expect(root(two)).toHaveStyle({ backgroundColor: 'rgb(20, 20, 20)' })
    // Each sees its own links as "From you": Ada's are a's, Bo's are b's.
    expect(within(one).getByRole('button', { name: 'From Bo' })).toBeInTheDocument()
    expect(within(one).queryByRole('button', { name: 'From Ada' })).toBeNull()
    expect(within(two).getByRole('button', { name: 'From Ada' })).toBeInTheDocument()
    expect(within(two).queryByRole('button', { name: 'From Bo' })).toBeNull()
    // Bo's link is unseen for Ada only; Ada's is unseen for Bo only.
    expect(within(within(one).getByRole('region', { name: 'Unseen' })).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/b'])
    expect(within(within(two).getByRole('region', { name: 'Unseen' })).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/links/a'])
  })

  it('gives a provider with no theme the defaults, even after another drew with one', () => {
    stubFetch()
    const first = render(<LinksProvider config={CONFIG} theme={{ paper: 'rgb(30, 30, 30)', ink: 'rgb(40, 40, 40)' }}><LinksHome links={[]} /></LinksProvider>)
    expect(root(first.container)).toHaveStyle({ backgroundColor: 'rgb(30, 30, 30)' })
    first.unmount()
    const second = render(<LinksProvider config={CONFIG}><LinksHome links={[]} /></LinksProvider>)
    // DEFAULT_THEME's paper and ink, not the first provider's.
    expect(root(second.container)).toHaveStyle({ backgroundColor: DEFAULT_THEME.paper, color: DEFAULT_THEME.ink })
  })

  it('refuses to draw a screen with no provider above it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<LinksHome links={[]} />)).toThrow(/inside <LinksProvider>/)
  })
})
