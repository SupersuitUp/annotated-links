import 'server-only'
import { after } from 'next/server'
import { RuleError, isRuleError } from '../errors.js'
import type { AnnotatedLinksHost } from './host.js'
import { handle as handleWith } from './http.js'
import { createLinksStore, type LinksStore } from './store.js'

type IdParams = { params: Promise<{ id: string }> }
type ReplyParams = { params: Promise<{ id: string; replyId: string }> }

// The handlers an app mounts at its own addresses, one line per route file. Each route file still
// declares its own segment config, because Next.js reads it from the route file itself: every one
// sets `runtime = 'nodejs'`, and exactly the three that transcribe also set `maxDuration = 300`:
// links POST (a spoken why is transcribed before the share answers), replies POST (a spoken reply
// is transcribed in after() once it answers) and replyTranscribe. No other route needs it.
//
// Where each is mounted, under the app's apiBase (the client's `api` addresses assume exactly these):
//   links        <api>                                    whyUploadUrl     <api>/why-upload-url
//   preview      <api>/preview                            agent            <api>/agent
//   link         <api>/[id]  (GET, DELETE)                seen             <api>/[id]/seen
//   replies      <api>/[id]/replies                       replyUploadUrl   <api>/[id]/reply-upload-url
//   replyAudio   <api>/[id]/replies/[replyId]/audio       replyTranscribe  <api>/[id]/replies/[replyId]/transcribe
export function createLinksHandlers<M extends string>(host: AnnotatedLinksHost<M>, store: LinksStore<M> = createLinksStore(host)) {
  // The host's own refusals ADD to the package's: a RuleError always reaches the client with its words.
  const handle = (fn: () => Promise<Response>) => handleWith(fn, (err) => isRuleError(err) || host.isRefusal?.(err) === true)
  const signedIn = async (req?: Request): Promise<M> => {
    const m = await host.member(req)
    if (!m) throw new RuleError('sign in first', 401)
    return m
  }
  const json = (v: unknown) => Response.json(v)

  return {
    // GET: everything this person may read, newest first. POST: { url, why, to?, shareId?, spokenWhy? }.
    // Send a fresh shareId per share and the SAME one on a retry: a resend answers with the link
    // already filed (earlier: null) and announces nothing; another member's shareId is 409.
    links: {
      GET: (req?: Request) => handle(async () => json(await store.list(await signedIn(req)))),
      POST: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        return json(await store.share(m, await req.json(), 'app'))
      }),
    },
    // Body: { id, contentType, size, durationSec }. The PUT must send exactly `requiredHeaders`.
    whyUploadUrl: {
      POST: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        return json(await store.whyUploadUrl(m, await req.json()))
      }),
    },
    link: {
      GET: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        return json(await store.get(m, (await params).id))
      }),
      // Only the sender may delete. Anyone else, and an id that is not there (or no longer is), is 404.
      DELETE: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        await store.remove(m, (await params).id)
        return new Response(null, { status: 204 })
      }),
    },
    // Opening the link. Marks it for a recipient's first open only.
    seen: {
      POST: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        return json(await store.markSeen(m, (await params).id))
      }),
    },
    // Body: { text } for a typed reply, or { replyId, contentType, durationSec } for a spoken one
    // whose bytes are already in storage. A spoken reply's words are written after the answer goes.
    replies: {
      POST: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        const { id } = await params
        const body = (await req.json()) as Record<string, unknown> | null
        if (body && typeof body === 'object' && 'replyId' in body) {
          const link = await store.fileVoiceReply(m, id, body as never)
          const replyId = body.replyId as string
          const r = link.replies.find((x) => x.id === replyId)
          if (host.transcription && r?.voice && r.voice.words === undefined && r.voice.wordsError === undefined) {
            after(async () => {
              try { await store.transcribeReply(m, id, replyId) } catch (err) { try { host.log?.('reply transcription failed', err) } catch { /* dropped */ } }
            })
          }
          return json(link)
        }
        return json(await store.reply(m, id, body as never))
      }),
    },
    // Body: { replyId, contentType, size, durationSec }. The PUT must send exactly `requiredHeaders`.
    replyUploadUrl: {
      POST: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        return json(await store.replyUploadUrl(m, (await params).id, await req.json()))
      }),
    },
    // Listen: a redirect to a short-lived signed URL, behind the reader check. The reply id `why`
    // plays the link's spoken why.
    replyAudio: {
      GET: (req: Request, { params }: ReplyParams) => handle(async () => {
        const m = await signedIn(req)
        const { id, replyId } = await params
        // Resolved against the request, so a host whose signedUrl answers a path works too.
        return Response.redirect(new URL(await store.audioUrl(m, id, replyId), req.url), 302)
      }),
    },
    // Try again: transcribes a spoken reply that is already filed. No re-recording.
    replyTranscribe: {
      POST: (req: Request, { params }: ReplyParams) => handle(async () => {
        const m = await signedIn(req)
        const { id, replyId } = await params
        return json(await store.transcribeReply(m, id, replyId))
      }),
    },
    // Body: { url }. The compose screen's live preview; null when the page gives none.
    preview: {
      POST: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        const { url } = ((await req.json()) ?? {}) as { url?: unknown }
        return json(await store.preview(m, url as string))
      }),
    },
    // A share from an agent key. Never the session: no agentMember, or a key it does not know, is 401.
    // The same why minimum applies; a spoken why is refused, since an agent has no voice of yours.
    // Body: { url, why, to?, shareId? }; a plugin CLI should send a shareId so its retry files once.
    agent: {
      POST: (req: Request) => handle(async () => {
        const m = host.agentMember ? await host.agentMember(req) : null
        if (!m) throw new RuleError('a valid agent key is required', 401)
        return json(await store.share(m, await req.json(), 'agent'))
      }),
    },
  }
}

export type LinksHandlers<M extends string> = ReturnType<typeof createLinksHandlers<M>>
