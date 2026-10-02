'use client'

import { createContext, useContext } from 'react'
import type { VaultStore } from '@supersuit/cowitness/client'
import { apiAt, pagesAt, type LinksApi, type LinksClientConfig, type LinksPages } from './config.js'
import { themeWith, type LinksTheme } from './theme.js'
import { linksVault } from './vault.js'

// Everything a screen reads, from the nearest <LinksProvider>. Nothing here is module state, so
// two providers on one page (or one after another) each draw with their own config and look.
export interface Links {
  config: LinksClientConfig
  me: string
  theme: LinksTheme
  api: LinksApi
  pages: LinksPages
  nameOf(m: string): string
  /** The phone's vault for this config. Call it from an effect or a handler, never during render. */
  vault(): VaultStore
}

export function linksFrom(config: LinksClientConfig, theme?: Partial<LinksTheme>): Links {
  return {
    config,
    me: config.me,
    theme: themeWith(theme),
    api: apiAt(config.apiBase),
    pages: pagesAt(config.pagesBase),
    nameOf: (m) => config.names[m] ?? m,
    vault: () => linksVault(config.vaultName),
  }
}

export const LinksContext = createContext<Links | null>(null)

export function useLinks(): Links {
  const v = useContext(LinksContext)
  if (!v) throw new Error('Annotated Links is not configured: render its screens inside <LinksProvider>')
  return v
}
