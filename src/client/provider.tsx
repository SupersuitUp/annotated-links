'use client'

import { useMemo, type ReactNode } from 'react'
import type { LinksClientConfig } from './config.js'
import { LinksContext, linksFrom } from './context.js'
import type { LinksTheme } from './theme.js'

// Hands the screens under it everything they draw with: where the handlers and pages are, who is
// looking, the people's names, the why minimum, whether voice is on, and the app's look. It is
// React context, so nothing is set globally and two providers never see each other's values.
export function LinksProvider({ config, theme, children }: { config: LinksClientConfig; theme?: Partial<LinksTheme>; children: ReactNode }) {
  const value = useMemo(() => linksFrom(config, theme), [config, theme])
  return <LinksContext.Provider value={value}>{children}</LinksContext.Provider>
}
