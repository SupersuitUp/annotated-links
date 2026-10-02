#!/usr/bin/env node
// Builds test/consumer, a minimal Next.js 16 + Tailwind 4 app that installs this package the way
// an app does: from the packed tarball, not from the source tree. A package whose tests pass but
// which breaks an app's build (a lost 'use client', a server import reaching the client entry,
// classes Tailwind never generates) fails here, before it is published.
//
// Then it starts the built app against its in-memory host and uses it: every handler at its
// documented path, the why minimum from both sides, the agent key, and the three screens.
//
//   node scripts/check-consumer.mjs            build, then exercise
//   node scripts/check-consumer.mjs --serve    build, then keep the app running (for screenshots)
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Classes only the package's components use, so finding them proves Tailwind scanned dist/.
const CLASSES = ['.aspect-video', '.line-clamp-2', '.rounded-xl']

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP = join(ROOT, 'test/consumer')
const PACK = join(APP, '.pack')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

rmSync(PACK, { recursive: true, force: true })
mkdirSync(PACK)
run('npm', ['pack', '--pack-destination', PACK], ROOT)
const tgz = readdirSync(PACK).find((f) => f.endsWith('.tgz'))
if (!tgz) { console.error('npm pack produced no tarball'); process.exit(1) }
run('npm', ['install', '--no-audit', '--no-fund'], APP)
run('npm', ['install', '--no-save', '--no-audit', '--no-fund', join(PACK, tgz)], APP)
rmSync(join(APP, '.next'), { recursive: true, force: true })
run('npx', ['next', 'build'], APP)

const static_ = join(APP, '.next/static')
const css = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? css(p) : n.endsWith('.css') ? [readFileSync(p, 'utf8')] : [] })
const built = existsSync(static_) ? css(static_).join('\n') : ''
const missing = CLASSES.filter((c) => !built.includes(c))
if (missing.length) { console.error(`the built CSS lacks ${missing.join(', ')}: Tailwind did not scan the package`); process.exit(1) }
console.log('the consumer app built against the packed package')

const port = process.env.PORT ? Number(process.env.PORT) : await new Promise((ok) => {
  const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)) })
})
const base = `http://127.0.0.1:${port}`
const server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: APP, stdio: ['ignore', 'pipe', 'inherit'] })
server.stdout.on('data', () => {})
const stop = () => { try { server.kill('SIGTERM') } catch { /* gone */ } }
process.on('exit', stop)

for (let i = 0; ; i++) {
  try { if ((await fetch(base)).ok) break } catch { /* not up yet */ }
  if (i > 120) { console.error('the consumer app did not start'); process.exit(1) }
  await new Promise((r) => setTimeout(r, 250))
}

if (process.argv.includes('--serve')) {
  console.log(`serving the consumer app at ${base} (Ctrl-C to stop)`)
  await new Promise(() => {})
}

const failures = []
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const as = (who) => ({ cookie: `who=${who}` })
const call = async (method, path, { body, headers = {}, redirect = 'manual' } = {}) => {
  const res = await fetch(base + path, {
    method, redirect,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json, text, location: res.headers.get('location') }
}
const SEVEN = 'one two three four five six seven'
const EIGHT = 'one two three four five six seven eight'

try {
  // The links list, and the why minimum, refused at 7 words and filed at 8.
  const list = await call('GET', '/api/links', { headers: as('ana') })
  expect(list.status === 200 && Array.isArray(list.json) && list.json.length === 3, 'GET /api/links lists the three seeded links')
  expect((await call('GET', '/api/links', { headers: as('stranger') })).status === 401, 'GET /api/links refuses a stranger with 401')
  const seven = await call('POST', '/api/links', { headers: as('ana'), body: { url: 'https://example.net/a', why: SEVEN, shareId: 'consumer-seven' } })
  expect(seven.status === 400 && /7 of 8 words/.test(seven.json?.error ?? ''), `a 7-word why is refused (${seven.status} ${seven.json?.error})`)
  const eight = await call('POST', '/api/links', { headers: as('ana'), body: { url: 'https://example.net/a', why: EIGHT, shareId: 'consumer-eight' } })
  expect(eight.status === 200 && eight.json?.link?.why === EIGHT && eight.json.link.via === 'app', 'an 8-word why is filed')
  const id = eight.json?.link?.id
  const again = await call('POST', '/api/links', { headers: as('ana'), body: { url: 'https://example.net/other', why: `${EIGHT} nine`, shareId: 'consumer-eight' } })
  expect(again.status === 200 && again.json?.link?.id === id && again.json.link.url === eight.json.link.url, 'a resend with the same shareId returns the original link')
  const theirs = await call('POST', '/api/links', { headers: as('ben'), body: { url: 'https://example.net/a', why: EIGHT, shareId: 'consumer-eight' } })
  expect(theirs.status === 200 && theirs.json?.link?.id !== id, 'another member\'s shareId files its own link')
  const told = (await call('GET', '/api/consumer-told')).json ?? []
  expect(told.filter((t) => t.what === 'shared').length === 2 && told.every((t) => !t.to.includes(t.by)), 'each share is announced once (not again on a resend), never to its sharer')

  // The agent route: a Bearer key, never the session.
  expect((await call('POST', '/api/links/agent', { headers: as('ana'), body: { url: 'https://example.net/b', why: EIGHT } })).status === 401, 'the agent route refuses a session with no key')
  expect((await call('POST', '/api/links/agent', { headers: { authorization: 'Bearer wrong' }, body: { url: 'https://example.net/b', why: EIGHT } })).status === 401, 'the agent route refuses a wrong key')
  const agentSeven = await call('POST', '/api/links/agent', { headers: { authorization: 'Bearer consumer-agent-key' }, body: { url: 'https://example.net/b', why: SEVEN } })
  expect(agentSeven.status === 400, 'the agent route holds the same why minimum')
  const agent = await call('POST', '/api/links/agent', { headers: { authorization: 'Bearer consumer-agent-key' }, body: { url: 'https://example.net/b', why: EIGHT, shareId: 'consumer-agent-1' } })
  expect(agent.status === 200 && agent.json?.link?.via === 'agent' && agent.json.link.by === 'ana', 'the agent route files with a Bearer key, as the key\'s member')

  // Every other handler at its documented path.
  expect((await call('POST', '/api/links/preview', { headers: as('ana'), body: { url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=42' } })).json?.youtubeId === 'M7lc1UVf-VE', 'POST /api/links/preview')
  const why = await call('POST', '/api/links/why-upload-url', { headers: as('ana'), body: { id: 'consumer-why-0001', contentType: 'audio/webm', size: 2000, durationSec: 5 } })
  expect(why.status === 200 && /\/links-why\/consumer-why-0001\.webm$/.test(why.json?.url ?? '') && why.json.requiredHeaders?.['x-goog-meta-links-by'] === 'ana', 'POST /api/links/why-upload-url signs a PUT under links-why/ stamped with its uploader')
  expect((await call('GET', `/api/links/${id}`, { headers: as('ana') })).json?.id === id, 'GET /api/links/[id]')
  expect((await call('GET', `/api/links/${id}`, { headers: as('stranger') })).status === 401, 'GET /api/links/[id] refuses a stranger')
  const seen = await call('POST', `/api/links/${id}/seen`, { headers: as('ben') })
  expect(seen.status === 200 && typeof seen.json?.seenBy?.ben === 'string', 'POST /api/links/[id]/seen marks a recipient\'s first open')
  const replied = await call('POST', `/api/links/${id}/replies`, { headers: as('ben'), body: { text: 'Got it.' } })
  expect(replied.status === 200 && replied.json?.replies?.at(-1)?.text === 'Got it.', 'POST /api/links/[id]/replies files a typed reply')
  const up = await call('POST', `/api/links/${id}/reply-upload-url`, { headers: as('ben'), body: { replyId: 'consumer-reply-0001', contentType: 'audio/webm', size: 2000, durationSec: 4 } })
  expect(up.status === 200 && new RegExp(`/links-audio/${id}/consumer-reply-0001\\.webm$`).test(up.json?.url ?? ''), 'POST /api/links/[id]/reply-upload-url signs a PUT under links-audio/')
  const audio = await call('GET', '/api/links/seed-spoken/replies/why/audio', { headers: as('ana') })
  expect(audio.status === 302 && /links-why\/seed-spoken-why\.webm$/.test(audio.location ?? ''), 'GET /api/links/[id]/replies/why/audio plays the spoken why')
  const replyAudio = await call('GET', '/api/links/seed-youtube/replies/seed-voice-reply/audio', { headers: as('ana') })
  expect(replyAudio.status === 302, 'GET /api/links/[id]/replies/[replyId]/audio plays a spoken reply')
  const tr = await call('POST', '/api/links/seed-youtube/replies/seed-voice-reply/transcribe', { headers: as('ana') })
  expect(tr.status === 200 && tr.json?.replies?.find((r) => r.id === 'seed-voice-reply')?.voice?.words === 'a fake transcriber heard this', 'POST /api/links/[id]/replies/[replyId]/transcribe')

  // The screens, server-rendered.
  const home = await call('GET', '/links')
  expect(home.status === 200 && home.text.includes('Share a link') && home.text.includes('Unseen'), 'GET /links draws the Links home')
  const share = await call('GET', `/links/share?url=${encodeURIComponent('https://example.net/c')}`)
  expect(share.status === 200 && share.text.includes('Why are you sending this?') && share.text.includes('https://example.net/c'), 'GET /links/share?url= draws the form with the link in it')
  const blank = await call('GET', '/links/share')
  expect(blank.status === 200 && blank.text.replaceAll('<!-- -->', '').includes('0 of 8 words') && !blank.text.includes('Paste a web link'), 'GET /links/share draws an untouched form with no complaints')
  const detail = await call('GET', '/links/seed-youtube')
  expect(detail.status === 200 && detail.text.includes('youtube-nocookie.com/embed/M7lc1UVf-VE?start=42'), 'GET /links/[id] draws the link, playing from its start time')

  const asSender = await call('GET', '/links/seed-youtube', { headers: as('ben') })
  expect(asSender.status === 200 && asSender.text.includes('>Delete</button>') && !detail.text.includes('>Delete</button>'), 'with allowDelete on, GET /links/[id] draws Delete for its sender and not for its recipient')

  // Deleting: only the sender, and afterwards it is gone for both of them, with its recordings.
  const doomed = await call('POST', '/api/links', { headers: as('ana'), body: { url: 'https://example.net/d', why: EIGHT, to: ['ben'], shareId: 'consumer-delete' } })
  const did = doomed.json?.link?.id
  expect((await call('DELETE', `/api/links/${did}`, { headers: as('stranger') })).status === 401, 'DELETE /api/links/[id] refuses a stranger with 401')
  expect((await call('DELETE', `/api/links/${did}`, { headers: as('ben') })).status === 404, 'DELETE /api/links/[id] answers the recipient 404')
  const deleted = await call('DELETE', `/api/links/${did}`, { headers: as('ana') })
  expect(deleted.status === 204, `DELETE /api/links/[id] deletes for the sender (${deleted.status})`)
  const afterDelete = await call('GET', `/api/links/${did}`, { headers: as('ben') })
  const benList = await call('GET', '/api/links', { headers: as('ben') })
  expect(afterDelete.status === 404 && !(benList.json ?? []).some((l) => l.id === did), 'a deleted link is gone from the recipient too')
  expect((await call('DELETE', `/api/links/${did}`, { headers: as('ana') })).status === 404, 'a second DELETE answers 404, not a fault')
  const spokenGone = await call('DELETE', '/api/links/seed-spoken', { headers: as('ben') })
  // Asking to upload at the same place again shows whether the bytes are still there: present, it
  // answers { uploaded: true }; gone, it signs a fresh PUT.
  const reTicket = await call('POST', '/api/links/why-upload-url', { headers: as('ben'), body: { id: 'seed-spoken-why', contentType: 'audio/webm', size: 2000, durationSec: 5 } })
  expect(spokenGone.status === 204 && reTicket.status === 200 && typeof reTicket.json?.url === 'string', `deleting a link deletes its spoken why from storage (${spokenGone.status}, ${JSON.stringify(reTicket.json)})`)
  const toldDeleted = ((await call('GET', '/api/consumer-told')).json ?? []).filter((t) => t.what === 'deleted')
  expect(toldDeleted.length === 2 && toldDeleted.every((t) => !t.to.includes(t.by)), 'each delete reaches the optional deleted hook once, never addressed to the sender')
} finally {
  stop()
}

if (failures.length) { console.error(`${failures.length} consumer check(s) failed`); process.exit(1) }
console.log('the consumer app used every handler and screen')
