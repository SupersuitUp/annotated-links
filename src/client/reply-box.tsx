'use client'

import { useState } from 'react'
import { forget } from '@supersuit/cowitness/client'
import type { AnnotatedLink } from '../types.js'
import { linksConfig } from './config.js'
import { sendReply, sendText } from './reply-send.js'
import { theme } from './theme.js'
import { linksVault, replyKey } from './vault.js'
import { VoiceRecorder, type Recorded } from './voice-recorder.js'

// A reply under a link, typed or (when voice is on) spoken. A spoken reply is held on the phone
// under `link:<id>` from its first second and let go only once the server has filed it; a send
// that fails leaves it held, and the next visit sends it.
export function ReplyBox({ linkId, onSent }: { linkId: string; onSent(link: AnnotatedLink): void }) {
  const { voiceReplies } = linksConfig()
  const t = theme()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const sendTyped = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setNote(null)
    try {
      onSent(await sendText(linkId, body))
      setText('')
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  const sendSpoken = async (r: Recorded) => {
    setNote(null)
    setSending(true)
    try {
      onSent(await sendReply(linkId, r.blob, r.durationSec, r.id))
      await forget(linksVault(), r.id)
    } catch {
      setNote('The voice reply did not send. It is kept on this phone and will be sent the next time you open this link.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void sendTyped() }}>
        <label className="flex flex-1 flex-col">
          <span className="sr-only">Reply</span>
          <textarea
            value={text} rows={2} placeholder="Reply" onChange={(e) => setText(e.target.value)}
            className="rounded-xl px-3 py-2 text-base leading-relaxed outline-none"
            style={{ backgroundColor: t.card, border: `1px solid ${t.hairline}`, color: t.ink }}
          />
        </label>
        <button
          type="submit" disabled={!text.trim() || sending}
          className="h-11 shrink-0 rounded-full px-5 text-sm font-medium disabled:opacity-40"
          style={{ backgroundColor: t.primary, color: t.primaryText }}
        >
          Send
        </button>
      </form>
      {voiceReplies && <VoiceRecorder vaultKey={() => replyKey(linkId)} onRecorded={(r) => void sendSpoken(r)} label="Record a reply" />}
      {note && <p role="alert" className="text-sm" style={{ color: t.danger }}>{note}</p>}
    </div>
  )
}
