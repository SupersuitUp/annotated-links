import type { Firestore } from 'firebase-admin/firestore'
import type { getStorage } from 'firebase-admin/storage'
import type { AnnotatedLink, Reply } from '../types.js'
import type { unfurl } from './unfurl.js'

// The bucket type comes from firebase-admin's own surface: @google-cloud/storage is its transitive
// dependency, and pnpm does not hoist it, so importing it directly would not resolve in every app.
export type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>

// Everything the app hands Annotated Links. The package knows how a link with a why works; the app
// says who the people are, where links are kept, and what a share or a reply becomes for the people
// told.
//
// Shares are filed once per `shareId`: a client (the app, a plugin CLI, the agent route) sends
// `{ shareId }` (8 to 64 letters, numbers, - or _) with a share, and a resend of the same id by the
// same person answers with the link already filed (earlier: null), without transcribing or telling
// anyone again. A share with a spoken why and no shareId uses the spoken why's id. Another person's
// link under that id is 409. With neither, every send files a new link.
export interface AnnotatedLinksHost<M extends string> {
  /** Who is signed in for this request (the app's session), or null for a stranger. The app enforces membership. */
  member(req?: Request): Promise<M | null>
  /**
   * Who an agent key acts as (a Bearer key, an admin key), or null when the key is missing or wrong.
   * Only the agent route calls it, and the agent route never falls back to the session. Absent: the
   * agent route answers 401 to everyone.
   */
  agentMember?(req: Request): Promise<M | null>
  /** Everyone in the app. A share with no `to` goes to all of them but the sharer. */
  people(): Promise<M[]>
  /** Called on use, never at import, so building an app needs no credentials. */
  db(): Firestore
  /** The collection links are kept in. */
  collection: string
  /**
   * Where voice is kept: spoken whys at `${prefix}links-why/<id>.<ext>`, spoken replies at
   * `${prefix}links-audio/<link>/<reply>.<ext>`. Required when `voice` is on.
   */
  storage?: { bucket(): Bucket; prefix: string; signedUrl(path: string): Promise<string> }
  /** Optional: without it, spoken whys and replies stay playable with no words under them. */
  transcription?: {
    /**
     * Optional, and not read by the package: it always asks for `language: 'auto'`. A host may keep
     * its own list here for its transcriber.
     */
    languages?: readonly string[]
    transcribe(audio: Buffer, contentType: string, opts: { language: string; speaker: M }): Promise<string>
  }
  /**
   * What a share or a reply becomes (a push, in most apps); the package never sends one itself.
   * Each is awaited after the write is saved, and a throw or rejection goes to `log` and never
   * changes the route's answer. `to` is already everyone who should hear it, never the actor.
   */
  announce: {
    shared(l: AnnotatedLink<M>, to: M[]): Promise<void>
    replied(l: AnnotatedLink<M>, r: Reply<M>, to: M[]): Promise<void>
    /** Optional: a recipient opened the link for the first time. */
    seen?(l: AnnotatedLink<M>, by: M): Promise<void>
    /**
     * Optional: the sender deleted the link, which is gone for everyone it was sent to. Called with
     * the link as it stood, after the document and its recordings are gone. Leave it out to tell nobody.
     */
    deleted?(l: AnnotatedLink<M>, by: M): Promise<void>
  }
  /** Words a typed why must reach. Default DEFAULT_MIN_WHY_WORDS. */
  minWhyWords?: number
  /**
   * Voice, all of it: spoken replies AND the spoken why. Off (the default): every voice route
   * answers 404 and a share carrying a spoken why is refused. On: `storage` is required.
   */
  voice?: boolean
  /** The preview fetcher. Tests inject one; the default is the package's guarded `unfurl`. */
  unfurl?: typeof unfurl
  /**
   * Which of the app's OWN errors are refusals whose words go back to a person. This package's own
   * RuleError is always a refusal; this check ADDS to that, so an error is never shown just because
   * it carries a 4xx status. A refusal answers with its `status` when that is 400-499 (403 when it
   * has none); anything else is an opaque 500.
   */
  isRefusal?(err: unknown): boolean
  /** Where failures the person must not see are reported, such as an `announce` that throws. Without it they are dropped. */
  log?(message: string, err: unknown): void
}
