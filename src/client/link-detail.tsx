'use client'

import { useEffect, useRef, useState } from 'react'
import type { AnnotatedLink, Reply } from '../types.js'
import { api, nameOf } from './config.js'
import { namesOf, shortDate } from './format.js'
import { LinkCard } from './link-card.js'
import { postJson } from './net.js'
import { ReplyBox } from './reply-box.js'
import { sendHeldReplies } from './reply-send.js'
import { theme } from './theme.js'
import { linksVault } from './vault.js'

// A recording and its words beneath, played through the reader-checked audio route. With no
// words yet it says so; with a reason in place of words it shows the reason, and `onRetry` (when
// given) offers to transcribe it again.
function Spoken({ src, words, wordsError, onRetry, large }: {
  src: string; words?: string; wordsError?: string; onRetry?(): Promise<void>; large?: boolean
}) {
  const t = theme()
  const [busy, setBusy] = useState(false)
  return (
    <figure className="flex flex-col gap-2">
      <audio src={src} controls preload="metadata" className="w-full" />
      <figcaption
        className={large ? 'whitespace-pre-wrap text-2xl leading-snug' : 'whitespace-pre-wrap text-base leading-relaxed'}
        style={large ? { fontFamily: t.fontHeading, color: t.ink } : { color: t.ink }}
      >
        {words ? words : wordsError ? (
          <span className="text-sm" style={{ color: t.mute }}>
            {wordsError}
            {onRetry && (
              <>{' '}<button
                type="button" disabled={busy} className="underline underline-offset-2"
                onClick={async () => { setBusy(true); try { await onRetry() } finally { setBusy(false) } }}
              >Try again</button></>
            )}
          </span>
        ) : null}
      </figcaption>
    </figure>
  )
}

// One link, read the way the sender meant it: the why first, in large type (a spoken why plays
// there with its words under it), then what the link is, then the conversation. A recipient's
// first open marks it seen; the sender sees "Seen" once someone has.
export function LinkDetail({ link: initial, me }: { link: AnnotatedLink; me: string }) {
  const t = theme()
  const [link, setLink] = useState(initial)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const markedFor = useRef<string | null>(null)

  useEffect(() => {
    const recipient = initial.by !== me && initial.to.includes(me)
    if (!recipient || initial.seenBy[me] || markedFor.current === initial.id) return
    markedFor.current = initial.id
    postJson<AnnotatedLink>(api.seen(initial.id), {}).catch(() => { /* the next open marks it */ })
  }, [initial.id, me])

  useEffect(() => {
    let live = true
    void sendHeldReplies(linksVault()).then((sent) => {
      const mine = sent.filter((l) => l.id === initial.id)
      if (live && mine.length) setLink(mine[mine.length - 1])
    })
    return () => { live = false }
  }, [initial.id])

  const retranscribe = async (replyId: string) => {
    setRetryNote(null)
    try {
      setLink(await postJson<AnnotatedLink>(api.replyTranscribe(link.id, replyId), {}))
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : 'That did not go through. Try again.')
    }
  }

  const seen = (Object.keys(link.seenBy) as string[]).filter((m) => link.seenBy[m])
  const mine = link.by === me

  return (
    <article className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6" style={{ color: t.ink, fontFamily: t.fontBody }}>
      <header className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: t.mute }}>
          {mine ? `You sent this to ${namesOf(link.to)}` : `${nameOf(link.by)} sent you this`} · {shortDate(link.at)}
        </p>
        {link.why.trim() && (
          <h1 className="whitespace-pre-wrap text-3xl leading-tight" style={{ fontFamily: t.fontHeading }}>{link.why}</h1>
        )}
        {link.spokenWhy && (
          <Spoken src={api.replyAudio(link.id, 'why')} words={link.spokenWhy.words} wordsError={link.spokenWhy.wordsError} large={!link.why.trim()} />
        )}
        {mine && seen.length > 0 && (
          <span
            className="self-start rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: t.card, color: t.mute, border: `1px solid ${t.hairline}` }}
            title={link.to.length > 1 ? `Seen by ${namesOf(seen)}` : undefined}
          >
            {link.to.length > 1 && seen.length < link.to.length ? `Seen by ${namesOf(seen)}` : 'Seen'}
          </span>
        )}
      </header>

      <LinkCard url={link.url} preview={link.preview} />

      <section aria-label="Replies" className="flex flex-col gap-4">
        {link.replies.map((r: Reply) => (
          <div key={r.id} className="flex flex-col gap-1 rounded-xl px-3 py-3" style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}` }}>
            <p className="text-xs" style={{ color: t.mute }}>
              <span className="font-medium" style={{ color: t.ink }}>{r.by === me ? 'You' : nameOf(r.by)}</span>
            </p>
            {r.text && <p className="whitespace-pre-wrap text-base leading-relaxed">{r.text}</p>}
            {r.voice && (
              <Spoken
                src={api.replyAudio(link.id, r.id)} words={r.voice.words} wordsError={r.voice.wordsError}
                onRetry={() => retranscribe(r.id)}
              />
            )}
          </div>
        ))}
        {retryNote && <p role="alert" className="text-sm" style={{ color: t.danger }}>{retryNote}</p>}
        <ReplyBox linkId={link.id} onSent={setLink} />
      </section>
    </article>
  )
}
