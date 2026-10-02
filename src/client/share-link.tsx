'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { forget, keepMeta, newRecordingId } from '@supersuit/cowitness/client'
import type { AnnotatedLink, LinkPreview } from '../types.js'
import { DEFAULT_MIN_WHY_WORDS, whyProblem, whyWithoutUrl, whyWords } from '../why.js'
import { api, linksConfig, nameOf, pages } from './config.js'
import { namesOf, shortDate } from './format.js'
import { LinkCard } from './link-card.js'
import { postJson } from './net.js'
import { theme } from './theme.js'
import { VoiceRecorder, type Recorded } from './voice-recorder.js'
import { linksVault, whyKey } from './vault.js'
import { newestUnsharedWhy, sendHeldWhys, shareLink, sweepUnsharedWhys, type HeldWhyMeta, type UnsharedWhy } from './why-send.js'

export const PREVIEW_DEBOUNCE_MS = 400

const looksLikeUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim())

// The words the counter counts: the rule's own count, so the two cannot drift apart.
const typedWords = (why: string, url: string): number => whyWords(whyWithoutUrl(why, url.trim()))
export const URL_PROBLEM = 'Paste a web link (https://…)'

// Share a link. The Share button follows the why rule exactly: it is off until the typed why
// reaches the minimum, or a voice note of at least 3 seconds in which speech was heard is
// attached. The preview is a courtesy: when it fails, the share still goes, with the site's name.
// A spoken why is held on the phone until the share is confirmed, and resent on the next visit
// if the answer never came.
export function ShareLink({ initialUrl = '', people }: { initialUrl?: string; people: string[] }) {
  const { me, minWhyWords, voiceReplies } = linksConfig()
  const min = minWhyWords ?? DEFAULT_MIN_WHY_WORDS
  const router = useRouter()
  const t = theme()
  const others = useMemo(() => [...new Set(people)].filter((p) => p !== me), [people, me])

  const [url, setUrl] = useState(initialUrl)
  const [why, setWhy] = useState('')
  const [to, setTo] = useState<string[]>(others)
  const [spoken, setSpoken] = useState<Recorded | null>(null)
  const [preview, setPreview] = useState<{ for: string; value: LinkPreview | null } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ link: AnnotatedLink; earlier: AnnotatedLink } | null>(null)
  // One id per draft, minted once and sent on every attempt, so a retry files one link.
  const [draftId, setDraftId] = useState(() => newRecordingId())
  const [offer, setOffer] = useState<UnsharedWhy | null>(null)

  // Old unshared recordings go, sent-but-unconfirmed ones are sent, and a fresh form (nothing
  // handed in) offers back the newest spoken why that was recorded and never shared.
  useEffect(() => {
    let live = true
    const vault = linksVault()
    void (async () => {
      await sweepUnsharedWhys(vault)
      await sendHeldWhys(vault)
      if (!initialUrl) {
        const found = await newestUnsharedWhy(vault)
        if (live && found) setOffer(found)
      }
    })()
    return () => { live = false }
  }, [])

  const takeOffer = () => {
    if (!offer) return
    // The recording keeps its draft's id, so a resend after a lost answer files under the same shareId.
    setDraftId(offer.draftId)
    setSpoken(offer.recorded)
    setOffer(null)
  }

  useEffect(() => {
    const target = url.trim()
    if (!looksLikeUrl(target)) { setPreview(null); return }
    let live = true
    const timer = setTimeout(() => {
      postJson<LinkPreview | null>(api.preview(), { url: target })
        .then((value) => { if (live) setPreview({ for: target, value }) })
        .catch(() => { if (live) setPreview({ for: target, value: null }) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [url])

  const spokenRule = spoken ? { durationSec: spoken.durationSec, heard: spoken.heard } : undefined
  const problem = whyProblem(why, url.trim(), min, spokenRule)
  const recipients = others.length > 1 ? to : others
  const canShare = !problem && looksLikeUrl(url) && recipients.length > 0 && !sending

  const onRecorded = (r: Recorded) => {
    // A new recording replaces the last one, which nothing will send now.
    if (spoken) void forget(linksVault(), spoken.id)
    setSpoken(r)
  }
  const dropSpoken = () => {
    if (spoken) void forget(linksVault(), spoken.id)
    setSpoken(null)
  }

  const submit = async () => {
    if (!canShare) return
    setSending(true)
    setError(null)
    const draft = { url: url.trim(), why, to: recipients, shareId: draftId }
    try {
      const vault = linksVault()
      if (spoken) {
        const meta: HeldWhyMeta = { submitted: true, url: draft.url, why, to: recipients, heard: spoken.heard }
        await keepMeta(vault, spoken.id, meta as Record<string, unknown>)
      }
      const out = await shareLink(draft, spoken ?? undefined)
      if (spoken) await forget(vault, spoken.id)
      if (out.earlier) setDone({ link: out.link, earlier: out.earlier })
      else router.push(pages.link(out.link.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6" style={{ color: t.ink, fontFamily: t.fontBody }}>
        <p className="text-lg leading-snug" style={{ fontFamily: t.fontHeading }}>
          Sent. You sent this to {namesOf(done.earlier.to)} on {shortDate(done.earlier.at)}.{' '}
          <Link href={pages.link(done.earlier.id)} className="underline underline-offset-2">See the earlier one</Link>
        </p>
        <button
          type="button" onClick={() => router.push(pages.link(done.link.id))}
          className="h-12 rounded-full text-base font-medium" style={{ backgroundColor: t.primary, color: t.primaryText }}
        >
          Go to your link
        </button>
      </section>
    )
  }

  const shown = preview && preview.for === url.trim() ? preview : null
  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6" style={{ color: t.ink, fontFamily: t.fontBody }}
      onSubmit={(e) => { e.preventDefault(); void submit() }}
    >
      <h1 className="text-2xl" style={{ fontFamily: t.fontHeading }}>Share a link</h1>

      <label className="flex flex-col gap-2">
        <span className="text-sm" style={{ color: t.mute }}>Link</span>
        <input
          type="url" inputMode="url" autoComplete="off" value={url} placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
          className="h-12 rounded-xl px-3 text-base outline-none"
          style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }}
        />
      </label>

      {shown && <LinkCard url={shown.for} preview={shown.value} />}

      {others.length > 1 && (
        <div role="group" aria-label="Send to" className="flex flex-wrap gap-2">
          {others.map((p) => {
            const on = to.includes(p)
            return (
              <button
                key={p} type="button" aria-pressed={on}
                onClick={() => setTo((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]))}
                className="h-10 rounded-full px-4 text-sm"
                style={on ? { backgroundColor: t.primary, color: t.primaryText } : { backgroundColor: t.card, color: t.ink, border: `1px solid ${t.hairline}` }}
              >
                {nameOf(p)}
              </button>
            )
          })}
        </div>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-lg" style={{ fontFamily: t.fontHeading }}>Why are you sending this?</span>
        <textarea
          value={why} rows={4} onChange={(e) => setWhy(e.target.value)}
          className="rounded-xl px-3 py-3 text-base leading-relaxed outline-none"
          style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }}
        />
      </label>
      <div className="-mt-3 flex flex-col gap-1 text-sm" style={{ color: t.mute }}>
        <p>{typedWords(why, url)} of {min} words</p>
        {!looksLikeUrl(url) && <p>{URL_PROBLEM}</p>}
        {problem && <p aria-live="polite">{problem}</p>}
      </div>

      {voiceReplies && (
        spoken ? (
          <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}` }}>
            <p className="flex-1 text-sm">Voice note, {spoken.durationSec} s</p>
            <button type="button" onClick={dropSpoken} className="h-10 px-2 text-sm underline underline-offset-2" style={{ color: t.mute }}>Remove</button>
          </div>
        ) : null
      )}
      {voiceReplies && offer && !spoken && (
        <button
          type="button" onClick={takeOffer} className="h-11 self-start rounded-full px-4 text-sm"
          style={{ backgroundColor: t.card, color: t.ink, border: `1px solid ${t.hairline}` }}
        >
          Use your recorded why ({offer.recorded.durationSec} s)
        </button>
      )}
      {voiceReplies && <VoiceRecorder vaultKey={() => whyKey(draftId)} onRecorded={onRecorded} label={spoken ? 'Record again' : 'Record why'} />}

      {error && <p role="alert" className="text-sm" style={{ color: t.danger }}>{error}</p>}

      <button
        type="submit" disabled={!canShare}
        className="h-12 rounded-full text-base font-medium disabled:opacity-40"
        style={{ backgroundColor: t.primary, color: t.primaryText }}
      >
        {sending ? 'Sharing…' : 'Share'}
      </button>
    </form>
  )
}
