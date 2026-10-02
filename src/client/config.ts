// Where the app mounted the handlers and the pages, who is looking, and what the people are called.
export interface LinksClientConfig {
  /** Where the link handlers are mounted: the list at <apiBase>, a link at <apiBase>/<id>. */
  apiBase: string
  /** Where the pages live: the library at <pagesBase>, a link at <pagesBase>/<id>, sharing at <pagesBase>/share. */
  pagesBase: string
  /** The person signed in. */
  me: string
  /** What each person is called on screen. */
  names: Record<string, string>
  /** Words a typed why must reach; the same number the app gives its host. Default 8. */
  minWhyWords?: number
  /** Voice, the same switch the app gives its host: the spoken why and spoken replies. */
  voiceReplies?: boolean
  /** The IndexedDB database recordings wait in until the server has them. Default "annotated-links". */
  vaultName?: string
}

let current: LinksClientConfig | null = null

export function configure(c: LinksClientConfig): void {
  current = c
}

export function linksConfig(): LinksClientConfig {
  if (!current) throw new Error('Annotated Links is not configured: render its screens inside <LinksProvider>')
  return current
}

export const nameOf = (m: string): string => linksConfig().names[m] ?? m

// The handler addresses, one place, matching the route files an app mounts.
export const api = {
  links: () => linksConfig().apiBase,
  preview: () => `${linksConfig().apiBase}/preview`,
  whyUploadUrl: () => `${linksConfig().apiBase}/why-upload-url`,
  seen: (id: string) => `${linksConfig().apiBase}/${id}/seen`,
  replies: (id: string) => `${linksConfig().apiBase}/${id}/replies`,
  replyUploadUrl: (id: string) => `${linksConfig().apiBase}/${id}/reply-upload-url`,
  replyAudio: (id: string, replyId: string) => `${linksConfig().apiBase}/${id}/replies/${replyId}/audio`,
  replyTranscribe: (id: string, replyId: string) => `${linksConfig().apiBase}/${id}/replies/${replyId}/transcribe`,
}

export const pages = {
  home: () => linksConfig().pagesBase,
  share: () => `${linksConfig().pagesBase}/share`,
  link: (id: string) => `${linksConfig().pagesBase}/${id}`,
}
