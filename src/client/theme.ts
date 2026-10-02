// The look the screens draw with, handed in by the app through <LinksProvider>. Layout is Tailwind
// classes; every colour and the heading face come from here. A token left out keeps the default,
// per provider: one provider's theme never reaches another's screens.
export interface LinksTheme {
  /** The page behind everything. */
  paper: string
  /** A raised surface: the link card, a reply, a field. */
  card: string
  ink: string
  /** Secondary text: dates, counters, hints. */
  mute: string
  hairline: string
  /** The one filled control (Share, Send) and the chosen chip. */
  primary: string
  /** Text drawn on `primary`. */
  primaryText: string
  danger: string
  /** The face the why and the headings are set in. */
  fontHeading: string
  fontBody: string
}

export const DEFAULT_THEME: LinksTheme = {
  paper: '#ffffff', card: '#f6f5f2', ink: '#1a1a1a', mute: '#6b6b6b', hairline: '#e6e3dd',
  primary: '#1a1a1a', primaryText: '#ffffff', danger: '#a33a3a',
  fontHeading: 'Georgia, serif', fontBody: 'system-ui, sans-serif',
}

// The defaults with the app's tokens on top. A token given as undefined keeps its default.
export function themeWith(t: Partial<LinksTheme> | undefined): LinksTheme {
  const next = { ...DEFAULT_THEME }
  for (const k of Object.keys(t ?? {}) as (keyof LinksTheme)[]) {
    if (t![k] !== undefined) next[k] = t![k] as string
  }
  return next
}
