'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AnnotatedLink, Reply } from '../types.js'
import { useLinks } from './context.js'
import { namesOf, shortDate } from './format.js'
import { LinkCard } from './link-card.js'
import { deleteAt, postJson } from './net.js'
import { ReplyBox } from './reply-box.js'
import { sendHeldReplies, sendReply } from './reply-send.js'

// A recording and its words beneath, played through the reader-checked audio route. With no
// words yet it says so; with a reason in place of words it shows the reason, and `onRetry` (when
// given) offers to transcribe it again.
function Spoken({ src, words, wordsError, onRetry, large }: {
  src: string; words?: string; wordsError?: string; onRetry?(): Promise<void>; large?: boolean
}) {
  const { theme: t } = useLinks()
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

// The sender's way to take a link back, for everyone it went to. Nothing is deleted until the
// second tap, and a refusal shows the server's own words. A recipient never sees it.
function DeleteLink({ link }: { link: AnnotatedLink }) {
  const { theme: t, api, pages } = useLinks()
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const whom = link.to.length === 1 ? 'both of you' : 'everyone you sent it to'

  const remove = async () => {
    setBusy(true)
    setNote(null)
    try {
      await deleteAt(api.link(link.id))
      router.replace(pages.home())
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not go through. Try again.')
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="self-start text-sm underline underline-offset-2" style={{ color: t.mute }}>
        Delete
      </button>
    )
  }
  return (
    <div role="group" aria-label="Delete this link" className="flex flex-col gap-3 rounded-xl px-3 py-3" style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}` }}>
      <p className="text-base">Delete this link for {whom}?</p>
      <div className="flex gap-3">
        <button
          type="button" disabled={busy} onClick={remove}
          className="flex h-11 items-center rounded-full px-4 text-sm font-medium disabled:opacity-40"
          style={{ backgroundColor: t.card, color: t.danger, border: `1px solid ${t.danger}` }}
        >Delete</button>
        <button
          type="button" disabled={busy} onClick={() => { setAsking(false); setNote(null) }}
          className="flex h-11 items-center rounded-full px-4 text-sm font-medium"
          style={{ backgroundColor: t.card, color: t.ink, border: `1px solid ${t.hairline}` }}
        >Keep</button>
      </div>
      {note && <p role="alert" className="text-sm" style={{ color: t.danger }}>{note}</p>}
    </div>
  )
}

// One link, read the way the sender meant it: the why first, in large type (a spoken why plays
// there with its words under it), then what the link is, then the conversation. A recipient's
// first open marks it seen; the sender sees "Seen" once someone has. Who is looking comes from the
// provider's config.
export function LinkDetail({ link: initial }: { link: AnnotatedLink }) {
  const { me, theme: t, api, nameOf, vault } = useLinks()
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
    void sendHeldReplies(vault(), (...a) => sendReply(api, ...a)).then((sent) => {
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
    <article className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6" style={{ backgroundColor: t.paper, color: t.ink, fontFamily: t.fontBody }}>
      <header className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: t.mute }}>
          {mine ? `You sent this to ${namesOf(link.to, nameOf)}` : `${nameOf(link.by)} sent you this`} · {shortDate(link.at)}
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
            title={link.to.length > 1 ? `Seen by ${namesOf(seen, nameOf)}` : undefined}
          >
            {link.to.length > 1 && seen.length < link.to.length ? `Seen by ${namesOf(seen, nameOf)}` : 'Seen'}
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

      {mine && <DeleteLink link={link} />}
    </article>
  )
}
