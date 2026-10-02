export interface LinkPreview {
  kind: 'youtube' | 'image' | 'page'
  title?: string
  description?: string
  image?: string
  siteName: string
  youtubeId?: string
  startSec?: number
}

export interface SpokenWhy {
  path: string
  contentType: string
  durationSec: number
  words?: string
  wordsError?: string
}

export interface Reply<M extends string = string> {
  id: string
  by: M
  at: string
  text?: string
  voice?: { path: string; contentType: string; durationSec: number; words?: string; wordsError?: string }
}

export interface AnnotatedLink<M extends string = string> {
  id: string
  by: M
  to: M[]
  url: string
  key: string
  why: string
  spokenWhy?: SpokenWhy
  at: string
  preview: LinkPreview | null
  seenBy: Partial<Record<M, string>>
  replies: Reply<M>[]
  via: 'app' | 'agent'
}
