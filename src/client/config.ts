// Where the app mounted the handlers and the pages, who is looking, and what the people are called.
// Handed to <LinksProvider>, which is the only source of all of it, `me` included: the screens take
// no `me` prop of their own, so the person looking can never disagree between two places.
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
  voice?: boolean
  /** The IndexedDB database recordings wait in until the server has them. Default "annotated-links". */
  vaultName?: string
}

// The handler addresses, one place, matching the route files an app mounts.
export function apiAt(base: string) {
  return {
    links: () => base,
    preview: () => `${base}/preview`,
    whyUploadUrl: () => `${base}/why-upload-url`,
    seen: (id: string) => `${base}/${id}/seen`,
    replies: (id: string) => `${base}/${id}/replies`,
    replyUploadUrl: (id: string) => `${base}/${id}/reply-upload-url`,
    replyAudio: (id: string, replyId: string) => `${base}/${id}/replies/${replyId}/audio`,
    replyTranscribe: (id: string, replyId: string) => `${base}/${id}/replies/${replyId}/transcribe`,
  }
}
export type LinksApi = ReturnType<typeof apiAt>

export function pagesAt(base: string) {
  return {
    home: () => base,
    share: () => `${base}/share`,
    link: (id: string) => `${base}/${id}`,
  }
}
export type LinksPages = ReturnType<typeof pagesAt>
