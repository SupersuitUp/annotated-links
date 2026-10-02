# @supersuit/annotated-links

Share a link only with a why. The person you send it to reads your reason first, in large type,
then the link: a YouTube video plays from the moment you meant, a page shows its card. Opening it
marks it seen, and they can reply typed or spoken. A why is at least eight words, or a voice note
in which speech was heard.

The package knows how the feature works: the record of a link, every rule (the why minimum, who
may read what, what is unseen, already-sent), reading and writing links, a guarded link-preview
fetcher, every screen, spoken whys and replies held on the phone until the server has them, and the
request handlers. The app says who the people are, where links are kept, what a share or a reply
becomes for the people told, and how it looks.

## 30 seconds

```bash
npm install @supersuit/annotated-links @supersuit/cowitness firebase-admin
```

```ts
// app/api/links/route.ts
import { createLinksHandlers } from '@supersuit/annotated-links/server'
import { host } from '@/lib/links-host'

export const runtime = 'nodejs'
export const maxDuration = 300
export const { GET, POST } = createLinksHandlers(host).links
```

```tsx
// app/links/page.tsx (a server component)
<LinksProvider config={{ apiBase: '/api/links', pagesBase: '/links', me, names }}>
  <LinksHome links={await createLinksStore(host).list(me)} />
</LinksProvider>
```

`test/consumer/` in this repository is a whole working app in about two hundred lines: every
route, every screen, and an in-memory host.

## Install

```bash
npm install @supersuit/annotated-links @supersuit/cowitness firebase-admin
```

`firebase-admin` is for the server entry; an app that only draws the screens can leave it out.
Node 20.18.1 or later (the floor of `undici` 7, which the preview fetcher uses). Peers: `react` and `react-dom` 19, `next` 16 (16.3.4 or later), `firebase-admin`
13 for the server entry, and `@supersuit/cowitness` 0.2, whose client recording primitives (the
phone vault a recording waits in, `forget`, `keepMeta`, `newRecordingId`) this package records
with. An app that also uses Cowitness's own screens keeps its own configuration; this package
opens its own vault database and never touches Cowitness's.

With Tailwind 4, add to the stylesheet that imports Tailwind:

```css
@source "../node_modules/@supersuit/annotated-links/dist";
```

## Three entry points

- `@supersuit/annotated-links`: the types and every rule, pure and safe anywhere (`whyWords`,
  `whyProblem`, `DEFAULT_MIN_WHY_WORDS`, `NOTHING_HEARD_REFUSAL`, `normalizeUrl`, `youtubeOf`, `mayRead`, `unseenFor`,
  `alreadySent`, `linksTile`, `matches`, `RuleError`).
- `@supersuit/annotated-links/server`: `createLinksStore(host)`, `createLinksHandlers(host)`,
  `unfurl`, the `AnnotatedLinksHost` type, `RuleError` and `isRuleError`, `UPLOADER_KEY`,
  `WHY_AUDIO_ID`, and the limits (`AUDIO_MAX_BYTES`, `AUDIO_MAX_SEC`, `AUDIO_TYPES`,
  `REPLY_MAX_CHARS`, `WHY_MAX_CHARS`). Server only: it imports `server-only`, so a client bundle
  that reaches it fails to build.
- `@supersuit/annotated-links/client`: `LinksProvider`, the three screens (`LinksHome`,
  `ShareLink`, `LinkDetail`), and the `LinksClientConfig` and `LinksTheme` types. The screens send,
  and resend what the phone is still holding, on their own; there is nothing else to call.

## The host (server)

The `AnnotatedLinksHost<M>` type, exported from `/server`, documents every member in its JSDoc. In
short:

- `member(req)`: who is signed in for this request (the app's session), or `null`.
- `agentMember(req)`: optional. Who an agent key acts as, or `null`. Only the agent route calls it.
- `people()`: everyone in the app. A share with no `to` goes to all of them but the sharer.
- `db()` and `collection`: the Firestore collection links are kept in. Called on use, never at
  import, so building an app needs no credentials.
- `storage`: `{ bucket(), prefix, signedUrl(path) }`, required when voice is on. The audio route
  redirects to what `signedUrl` answers, resolved against the request, so an absolute URL or a path
  on the app's own origin both work.
- `transcription`: optional `{ transcribe(audio, contentType, { language, speaker }), languages? }`.
  The package always asks for `language: 'auto'`; `languages` is optional and not read. Without a
  transcriber, spoken whys and replies stay playable with no words under them. With one, a voice
  note it hears nothing in cannot stand in for a short typed why: the share is refused with "No
  words were heard in the voice note. Record it again or type why." and nothing is filed or
  announced. A transcriber that fails, rather than hearing nothing, does not block the share.
- `announce.shared(link, to)`, `announce.replied(link, reply, to)`, optional `announce.seen(link, by)`
  and optional `announce.deleted(link, by)`: what each moment becomes (a push, in most apps). Leave
  `deleted` out and a deleted link simply disappears for its recipients, with nobody told. The package never sends one itself. Each is
  awaited after the write is saved, and a failure goes to `log` and never changes the answer.
- `minWhyWords`: words a typed why must reach. Default 8.
- `voice`: voice, ALL of it. It governs spoken replies AND the spoken why. Off (the
  default): every voice route answers 404 and a share carrying a spoken why is refused. On:
  `storage` is required, and a host without it throws when the store is made, not on a person's
  first tap.
- `unfurl`: the preview fetcher. Default: the package's guarded `unfurl`.
- `isRefusal(err)`: optional. Which of the app's OWN errors are refusals whose words reach the
  person. The package's `RuleError` always is; this adds to it. A refusal answers with its status
  when that is 400-499 (403 when it has none); anything else is an opaque 500.
- `log(message, err)`: optional. Where failures the person must not see are reported.

### Previews never block a share

A share is filed whether or not its preview could be made: a page that is slow, broken, huge or
refused is filed with no preview and drawn as its site's name, and a YouTube link still plays from
the url alone. The default `unfurl` refuses private addresses (loopback, the private ranges,
link-local and cloud metadata, CGNAT, IPv6 private and mapped forms) both before it fetches and
again at connect time, inside the socket's own address lookup, so a name that resolves to a public
address on the check and a private one on the connect is still refused. It follows at most three
redirects, each one checked the same way, gives up after five seconds, and reads a capped body.

### Sharing once: `shareId`

A share carries `shareId` (8 to 64 letters, numbers, `-` or `_`). Mint ONE per draft and send the
same one on every attempt at that draft:

- A resend with the same id by the same person answers with the link already filed, untouched,
  with `earlier: null`, even if the url or the why in the resend differ. Nothing is transcribed or
  announced again. This is what makes a retry after a lost answer safe.
- Ids are scoped to the sharer: the stored document is named from the sharer and the id together,
  so another member sending the same id files their own link. A stored link under that name that
  belongs to someone else answers 409 and is never taken over.
- A share with a spoken why and no `shareId` uses the spoken why's id. With neither, every send
  files a new link.

The package's own screens and `shareLink` do this already. A plugin CLI that calls the agent route
should send a `shareId` so its own retry files once.

### What the host is responsible for

The package hands these decisions to the host and cannot check them for you.

- **`member` enforces membership.** The package acts for whoever `member` returns; anyone it
  returns can share, read what was sent to them, and reply. `member` is where a signed-out
  visitor, or a signed-in stranger, is turned away (return `null`, and every route answers 401).
- **`agentMember` is for the agent route only.** It is never consulted anywhere else, and the agent
  route never falls back to the session. Check the key in constant time and map it to exactly one
  member. Without `agentMember`, the agent route answers 401 to everyone.
- **Announcements go only to `to`.** `to` is already everyone who should hear about it, never the
  person who acted. Tell exactly those people: a link is readable only by its sharer and its
  recipients, and telling anyone else puts a private message on a stranger's lock screen.
- **A why written by an agent must be the person's own words.** The agent route enforces the same
  minimum, and refuses a spoken why, but it cannot tell whether eight words came from the person or
  were composed by a model. The app's agent tooling must refuse to compose a why: it passes along
  what the person said, or it does not share. A link whose why nobody meant is the thing this
  package exists to prevent.
- **Let the bucket's CORS accept the uploader header.** The phone PUTs a recording straight to the
  bucket with `x-goog-meta-links-by`, which stamps the bytes with who the upload was issued to, and
  filing refuses bytes stamped for someone else with 403. A browser preflights any header that is
  not simple, and the bucket answers only for request headers its CORS `responseHeader` names, so
  a file without `x-goog-meta-links-by` makes every voice PUT fail on every phone while typed shares
  keep working. Apply this (`gcloud storage buckets update gs://<bucket> --cors-file=cors.json`),
  with your own origins:

  ```json
  [
    {
      "origin": ["https://your-app.example"],
      "method": ["PUT"],
      "responseHeader": [
        "Content-Type",
        "x-goog-content-length-range",
        "x-goog-if-generation-match",
        "x-goog-meta-links-by"
      ],
      "maxAgeSeconds": 3600
    }
  ]
  ```

  Check it against the real bucket before relying on voice: record a why on a phone and confirm the
  PUT succeeds.
- **Clean up abandoned uploads.** Recordings live at:
  - spoken whys: `<prefix>links-why/<id>.<ext>`
  - spoken replies: `<prefix>links-audio/<link>/<replyId>.<ext>`

  A phone uploads before it files, so a why recorded and uploaded but never shared leaves bytes no
  link points to. A storage age rule cannot tell those from filed ones, so run the rule from the
  app's own timer: delete objects under `<prefix>links-why/` older than a day that no link's
  `spokenWhy.path` names, and objects under `<prefix>links-audio/<link>/` whose reply id is not in
  that link's replies, or whose link no longer exists. Deleting a link removes its recordings
  itself; one that storage fails to remove at that moment is logged and left for this rule.

## Mounting the handlers

Every route file is `export const runtime = 'nodejs'` plus one line such as
`export const { GET, POST } = handlers.links`, or `export const { GET, DELETE } = handlers.link` for
`<api>/[id]/route.ts`. A route file that does not re-export a method simply does not answer it, so
an app that leaves out `DELETE` has no delete. Next.js reads segment config from the route file
itself, so the `maxDuration` lines below go in the file too. Exactly the three routes that
transcribe need it; no other route does. `<api>` is your `apiBase`.

| `createLinksHandlers(host)` | Route file | Segment config |
|---|---|---|
| `.links.GET`, `.links.POST` | `<api>/route.ts` | `maxDuration = 300` (a spoken why is transcribed before the share answers) |
| `.preview.POST` | `<api>/preview/route.ts` | |
| `.whyUploadUrl.POST` | `<api>/why-upload-url/route.ts` | |
| `.agent.POST` | `<api>/agent/route.ts` | |
| `.link.GET`, `.link.DELETE` | `<api>/[id]/route.ts` | |
| `.seen.POST` | `<api>/[id]/seen/route.ts` | |
| `.replies.POST` | `<api>/[id]/replies/route.ts` | `maxDuration = 300` (a spoken reply is transcribed after it answers) |
| `.replyUploadUrl.POST` | `<api>/[id]/reply-upload-url/route.ts` | |
| `.replyAudio.GET` | `<api>/[id]/replies/[replyId]/audio/route.ts` | |
| `.replyTranscribe.POST` | `<api>/[id]/replies/[replyId]/transcribe/route.ts` | `maxDuration = 300` |

`preview`, `why-upload-url` and `agent` are static segments beside `[id]`, which Next.js matches
first. The voice routes answer 404 while `voice` is off.

What each takes:

- `links` POST: `{ url, why, to?, shareId?, spokenWhy? }`, answering `{ link, earlier }`, where
  `earlier` is the newest link this person already sent to the same page and people, or `null`.
- `agent` POST: `{ url, why, to?, shareId? }` with `Authorization: Bearer <key>` (or whatever your
  `agentMember` reads). A spoken why is refused.
- `whyUploadUrl` and `replyUploadUrl`: `{ id | replyId, contentType, size, durationSec }`, answering
  `{ url, requiredHeaders }`, or `{ uploaded: true }` when the bytes are already there. The PUT must
  send `requiredHeaders` exactly as issued: they are signed, and they carry `x-goog-meta-links-by`.
- `link` DELETE: no body. Only the link's sender may delete it; it answers 204 with nothing in it.
  Anyone else, a recipient included, gets 404, the same answer as a link they cannot read, so
  whether it exists never leaks, and a second delete is 404 too. The link is gone for everyone it
  was sent to, from their library and their unseen count, together with its spoken why and every
  spoken reply (the paths the record names). A later share under the same `shareId` files a new
  link; it never brings the deleted one back.
- `replies` POST: `{ text }` for a typed reply, or `{ replyId, contentType, durationSec }` for a
  spoken one whose bytes are already uploaded. A spoken reply's words are written after it answers.
- `replyAudio` GET: a 302 to a short-lived signed URL (resolved against the request), behind the
  reader check. The reply id `why`
  plays the link's spoken why: `<api>/<id>/replies/why/audio`.
- `replyTranscribe` POST: transcribes a filed spoken reply again, with no re-recording.

## The screens (client)

Pages live under your `pagesBase`: the library at `<pagesBase>`, a link at `<pagesBase>/<id>`, and
the share form at `<pagesBase>/share`, which takes `?url=` so a share sheet or a bookmarklet can
open it with the link already in it:

```tsx
// app/links/share/page.tsx
export default async function SharePage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams
  return <LinksProvider config={config}><ShareLink initialUrl={url ?? ''} people={people} /></LinksProvider>
}
```

`LinksHome` takes `links` (from `store.list(me)`). `LinkDetail` takes `link` (from
`store.get(me, id)`); for its sender it ends with Delete, which asks "Delete this link for both of
you?" (Delete, Keep), then calls the `DELETE` route and goes back to `<pagesBase>`. A recipient sees
no Delete. Mount `DELETE` on `<api>/[id]` or the confirmed tap answers with the route's refusal. `ShareLink` takes `people` and an optional `initialUrl`. Read in a server
component, and render inside `LinksProvider`.

**Who is looking has one source: the provider's `config.me`.** No screen takes a `me` prop, so the
person a page was read for and the person it is drawn for cannot disagree. The provider is React
context: nothing is set globally, so two providers on one page, or one rendered after another,
each draw with their own config and their own look.

**Config:**

| Config value | What it is |
|---|---|
| `apiBase` | Where the handlers are mounted (see the table above). |
| `pagesBase` | Where the pages live: `<pagesBase>`, `<pagesBase>/<id>`, `<pagesBase>/share`. |
| `me` | The member key of the person looking. The only place the screens learn it. |
| `names` | Each member key's display name. Passed from the server, so names never ship to a signed-out visitor. |
| `minWhyWords` | Optional. The same number the host has. Default 8. |
| `voice` | Optional. The same switch the host has: the spoken why and spoken replies. |
| `vaultName` | Optional. The IndexedDB database recordings wait in until the server has them. Default `annotated-links`. |

A screen given a different minimum or voice switch from the server offers what the server refuses.

**Theme:** pass any of these to `LinksProvider` as `theme`; a token left out keeps a neutral default.
The theme belongs to that provider alone: a provider with no `theme` draws with the defaults
whatever another provider was given.

| Token | What it colours |
|---|---|
| `paper` | The page behind everything: the background of each screen. |
| `card` | A raised surface: the link card, a reply, a field. |
| `ink` | Text. |
| `mute` | Secondary text: dates, counters, hints. |
| `hairline` | Borders and dividers. |
| `primary` | The one filled control (Share, Send) and the chosen chip. |
| `primaryText` | Text drawn on `primary`. |
| `danger` | Errors, and the confirmed Delete. |
| `fontHeading` | The face the why and the headings are set in. |
| `fontBody` | Everything else. |

## Developing

```bash
npm run check   # typecheck, tests, build, private words, comment dates, and the consumer app
```

`npm run check:consumer` packs the package, installs the tarball into `test/consumer`, builds it,
then starts it against an in-memory host and uses every route and screen.
`node scripts/check-consumer.mjs --serve` leaves it running for a look in a browser.
