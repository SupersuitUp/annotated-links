// The one way the screens talk to the handlers. A refusal arrives as { error } with a 4xx and is
// thrown with those words, so a screen shows the person exactly what the server said.
export class SendError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function errorOf(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: unknown }
    if (typeof b?.error === 'string' && b.error.trim()) return b.error
  } catch { /* not JSON */ }
  return `Something went wrong (${res.status}). Try again.`
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new SendError('That did not reach the server. Check the connection and try again.', 0)
  }
  if (!res.ok) throw new SendError(await errorOf(res), res.status)
  return (await res.json()) as T
}

// A DELETE, answered with no body. A refusal is thrown with the server's words, as postJson does.
export async function deleteAt(url: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { method: 'DELETE' })
  } catch {
    throw new SendError('That did not reach the server. Check the connection and try again.', 0)
  }
  if (!res.ok) throw new SendError(await errorOf(res), res.status)
}

// A refusal that will be the same on every attempt: the recording it was for can be let go. A
// dropped connection (0), a server fault (5xx) or a signed-out session (401) is worth another try.
export const PERMANENT_REFUSALS: readonly number[] = [400, 403, 404, 409]
export const isPermanent = (err: unknown): boolean => err instanceof SendError && PERMANENT_REFUSALS.includes(err.status)

export type Ticket = { url: string; requiredHeaders: Record<string, string> } | { uploaded: true }

// The bytes go straight to storage on the issued URL, with exactly the issued headers. A ticket
// that says they are already there (an earlier attempt whose answer was lost) sends nothing.
export async function putTicketed(t: Ticket, blob: Blob): Promise<void> {
  if ('uploaded' in t) return
  let res: Response
  try {
    res = await fetch(t.url, { method: 'PUT', headers: t.requiredHeaders, body: blob })
  } catch {
    throw new SendError('The recording did not upload. It is kept on this phone and will be sent again.', 0)
  }
  if (!res.ok) throw new SendError('The recording did not upload. It is kept on this phone and will be sent again.', res.status)
}

// The type the server files a recording under: the recorder's type without its codec parameters.
export const audioType = (blob: Blob): string => (blob.type || 'audio/webm').split(';')[0].trim()
