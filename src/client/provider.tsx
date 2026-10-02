'use client'

import type { ReactNode } from 'react'
import { configure, type LinksClientConfig } from './config.js'
import { setTheme, type LinksTheme } from './theme.js'

// Configures the screens before anything under it draws: where the handlers and pages are, who is
// looking, the people's names, the why minimum, whether voice is on, and the app's look.
export function LinksProvider({ config, theme, children }: { config: LinksClientConfig; theme?: Partial<LinksTheme>; children: ReactNode }) {
  configure(config)
  if (theme) setTheme(theme)
  return <>{children}</>
}
