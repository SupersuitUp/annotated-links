import type { AnnotatedLink } from './types.js'

const newestFirst = <M extends string>(a: AnnotatedLink<M>, b: AnnotatedLink<M>) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)

export function mayRead<M extends string>(l: AnnotatedLink<M>, m: M): boolean {
  return l.by === m || l.to.includes(m)
}

// Sent to this person, not yet seen by them, newest first. Their own shares are never unseen.
export function unseenFor<M extends string>(links: AnnotatedLink<M>[], m: M): AnnotatedLink<M>[] {
  return links.filter((l) => l.by !== m && l.to.includes(m) && !l.seenBy[m]).sort(newestFirst)
}

// The newest link from `by` to this page that reached everyone in `to`, so the sender can be told
// they already sent it rather than sending it twice.
export function alreadySent<M extends string>(
  links: AnnotatedLink<M>[],
  key: string,
  by: M,
  to: M[],
): AnnotatedLink<M> | null {
  const hits = links.filter((l) => l.key === key && l.by === by && to.every((m) => l.to.includes(m)))
  return hits.sort(newestFirst)[0] ?? null
}

export function linksTile<M extends string>(
  links: AnnotatedLink<M>[],
  m: M,
): { count: number; unseen: number; newest: string | null } {
  const mine = links.filter((l) => mayRead(l, m)).sort(newestFirst)
  return { count: mine.length, unseen: unseenFor(mine, m).length, newest: mine[0]?.at ?? null }
}

export function matches(l: AnnotatedLink, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [l.why, l.preview?.title, l.preview?.siteName, l.url].some((s) => s?.toLowerCase().includes(needle))
}
