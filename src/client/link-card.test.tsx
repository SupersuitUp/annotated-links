import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LinkCard } from './link-card.js'
import { setUp } from '../../test/support/links-client.js'

setUp()

describe('LinkCard', () => {
  it('plays YouTube inline from the no-cookie host, at the timestamp', () => {
    const { container } = render(<LinkCard url="https://youtu.be/abcdefghijk?t=840" preview={{ kind: 'youtube', youtubeId: 'abcdefghijk', startSec: 840, title: 'The talk', siteName: 'YouTube' }} />)
    const f = container.querySelector('iframe')!
    expect(f).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk?start=840')
    expect(f).toHaveAttribute('allow', 'encrypted-media; picture-in-picture')
    expect(f).toHaveAttribute('allowfullscreen')
    expect(f).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    expect(screen.getByText('The talk')).toBeInTheDocument()
  })

  it('plays YouTube from the url alone when the preview failed', () => {
    const { container } = render(<LinkCard url="https://www.youtube.com/watch?v=abcdefghijk&t=30" preview={null} />)
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk?start=30')
  })

  it('starts at 0 when a stored start is not a number', () => {
    const { container } = render(<LinkCard url="https://youtu.be/abcdefghijk" preview={{ kind: 'youtube', youtubeId: 'abcdefghijk', startSec: Number.NaN, siteName: 'YouTube' }} />)
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk?start=0')
  })

  it('shows an image as the image', () => {
    const { container } = render(<LinkCard url="https://example.com/a.png" preview={{ kind: 'image', image: 'https://example.com/a.png', siteName: 'example.com' }} />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png')
  })

  it('shows a page as a card that opens in a new tab', () => {
    render(<LinkCard url="https://example.com/post" preview={{ kind: 'page', title: 'A post', description: 'About it', image: 'https://example.com/i.png', siteName: 'Example' }} />)
    const a = screen.getByRole('link')
    expect(a).toHaveAttribute('href', 'https://example.com/post')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('A post')).toBeInTheDocument()
    expect(screen.getByText('About it')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
  })

  it('shows the hostname with no preview', () => {
    render(<LinkCard url="https://www.example.com/post" preview={null} />)
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
