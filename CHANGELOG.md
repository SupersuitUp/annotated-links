# Changelog

## 0.1.0

First release. Annotated Links lets the people in a Next.js app share a link only with a reason:
the person it is sent to reads the why first, the link is marked seen when they open it, and they
can reply typed or spoken.

- **The why rule.** A typed why of at least eight words (an app can set its own minimum), or a voice
  note of at least three seconds in which speech was heard. The link itself and bare punctuation
  never count as words, and the screen counts against the link exactly as the server keeps it. A
  voice note the app's transcriber heard nothing in cannot stand in for a short typed why. The rule
  is enforced on the server, and the Share button follows it exactly.
- **Screens.** `LinksHome` (what is waiting for you, then everything shared, searchable and
  narrowed by sender), `ShareLink` (with a live preview, and `?url=` to open it with a link already
  in it), and `LinkDetail` (the why in large type, a YouTube video playing from its timestamp, a
  page card, the replies). Every colour and face comes from the app's theme. `LinksProvider` is
  React context and the only source of who is looking (`config.me`), so two providers never bleed
  into each other.
- **Voice.** One switch, `voice`, for the spoken why and spoken replies. Recordings are held
  on the phone from their first second and resent until the server has them, upload straight to
  storage on a signed, stamped PUT, and are transcribed when the app supplies a transcriber.
- **Sharing once.** A share carries a `shareId`, so a retry after a lost answer files one link and
  tells nobody twice.
- **An agent route.** A plugin or a CLI can share on a person's behalf with a key the app checks,
  under the same why minimum, and never with a spoken why.
- **Previews that cannot hurt you.** The default fetcher refuses private addresses before it fetches
  and again at connect time, follows at most three redirects, times out, caps what it reads, and
  never throws. A preview that fails never stops a share.
- **Three entries.** The plain rules (`.`), the store, handlers and fetcher (`./server`, server
  only), and the provider and screens (`./client`).

Needs Node 20.18.1 or later (the floor of `undici` 7), React 19, Next.js 16.3.4 or later, `firebase-admin` 13 on the server, and
`@supersuit/cowitness` 0.2 for its recording primitives.
