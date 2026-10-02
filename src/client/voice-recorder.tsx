'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AUDIO_BITS_PER_SECOND, MIC_CONSTRAINTS, RECORD_MAX_SEC, analyserListener, beginRecording, endRecording, forget, formatClock,
  keepChunk, keepMeta, newAudioContext, newRecordingId, pickMimeType, shouldKeep, startTally, tally, type Listener, type SpeechTally,
} from '@supersuit/cowitness/client'
import { theme } from './theme.js'
import { linksVault } from './vault.js'

export interface Recorded { blob: Blob; durationSec: number; id: string; heard: boolean }

// Cowitness's VoiceNote, assembled from its exported pieces rather than used whole, for two reasons
// that are both about VoiceNote's internals: it opens its vault through Cowitness's own
// configuration (so it throws outside a CowitnessProvider, and would write into that app's
// Cowitness database inside one), and it cannot say whether speech was heard. Here the level is
// read off the same stream and tallied, and `heard` is Cowitness's own `shouldKeep`: speech was
// measured, or the meter was not measuring at all (no AudioContext, or one Safari left suspended,
// which reads exactly zero). An unmeasured recording counts as heard rather than refusing words
// nobody listened for; the server still files only bytes that arrived and are this person's.
//
// Every second of sound goes into the phone's vault as it is made, under `vaultKey(id)`, so a
// dropped connection or a closed app never loses it. Walking away mid-recording (unmounting) turns
// the microphone off and forgets it.
export function VoiceRecorder({ vaultKey, onRecorded, label = 'Record' }: {
  vaultKey(id: string): string; onRecorded(rec: Recorded): void; label?: string
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'failed'>('idle')
  const [sec, setSec] = useState(0)
  const [said, setSaid] = useState(false)
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; id: string; started: number; listener: Listener | null; tally: SpeechTally } | null>(null)
  const mounted = useRef(true)
  const t = theme()

  const discard = () => {
    const cur = rec.current
    rec.current = null
    if (!cur) return
    cur.r.ondataavailable = null
    cur.r.onstop = null
    try { if (cur.r.state === 'recording') cur.r.stop() } catch { /* already stopped */ }
    cur.stream.getTracks().forEach((x) => x.stop())
    cur.listener?.close()
    void forget(linksVault(), cur.id)
  }

  useEffect(() => {
    if (state !== 'recording') return
    const iv = setInterval(() => {
      const cur = rec.current
      if (!cur) return
      const now = Date.now()
      if (cur.listener) cur.tally = tally(cur.tally, cur.listener.level(), now)
      const s = (now - cur.started) / 1000
      setSec(s)
      if (s >= RECORD_MAX_SEC) stop()
    }, 100)
    return () => clearInterval(iv)
  }, [state])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; discard() }
  }, [])

  const start = async () => {
    // Made inside the tap: Safari starts a context created outside a user gesture suspended.
    const ctx = newAudioContext()
    let stream: MediaStream | null = null
    let id: string | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      if (!mounted.current) { stream.getTracks().forEach((x) => x.stop()); void ctx?.close().catch(() => {}); return }
      const mimeType = pickMimeType((x) => MediaRecorder.isTypeSupported(x))
      const r = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
      const vault = linksVault()
      const newId = newRecordingId()
      id = newId
      const started = Date.now()
      const chunks: Blob[] = []
      await beginRecording(vault, { id: newId, noteId: vaultKey(newId), mimeType: r.mimeType || mimeType })
      if (!mounted.current) { stream.getTracks().forEach((x) => x.stop()); void ctx?.close().catch(() => {}); void forget(vault, newId); return }
      const opened = stream
      r.ondataavailable = (e) => { chunks.push(e.data); void keepChunk(vault, newId, e.data, (Date.now() - started) / 1000) }
      r.onstop = () => {
        const cur = rec.current
        const durationSec = Math.max(1, Math.round((Date.now() - started) / 1000))
        const heard = cur?.listener ? shouldKeep(cur.tally) : true
        opened.getTracks().forEach((x) => x.stop())
        cur?.listener?.close()
        rec.current = null
        void endRecording(vault, newId, durationSec)
        void keepMeta(vault, newId, { heard })
        onRecorded({ blob: new Blob(chunks, { type: r.mimeType || mimeType }), durationSec, id: newId, heard })
      }
      rec.current = { r, stream, id: newId, started, listener: analyserListener(stream, ctx), tally: startTally() }
      r.start(1000)
      setState('recording')
    } catch {
      stream?.getTracks().forEach((x) => x.stop())
      void ctx?.close().catch(() => {})
      if (id) void forget(linksVault(), id).catch(() => {})
      if (mounted.current) setState('failed')
    }
  }
  const stop = () => { if (rec.current?.r.state === 'recording') rec.current.r.stop(); setState('idle'); setSaid(true) }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button" aria-pressed={state === 'recording'} onClick={state === 'recording' ? stop : start}
        className="h-11 shrink-0 rounded-full px-4 text-sm font-medium"
        style={{ backgroundColor: state === 'recording' ? t.danger : t.card, color: state === 'recording' ? t.primaryText : t.ink, border: `1px solid ${t.hairline}` }}
      >
        {state === 'recording' ? 'Stop' : label}
      </button>
      {/* The clock is for the eye; a screen reader hears only that recording started or stopped. */}
      {state === 'recording' && <p aria-hidden="true" className="text-sm tabular-nums" style={{ color: t.mute }}>{formatClock(sec)}</p>}
      <p aria-live="polite" className="sr-only">{state === 'recording' ? 'Recording' : said ? 'Recording stopped' : ''}</p>
      {state === 'failed' && <p role="alert" className="text-sm" style={{ color: t.danger }}>The microphone did not open. Check the permission and try again.</p>}
    </div>
  )
}
