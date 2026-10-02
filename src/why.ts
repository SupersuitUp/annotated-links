export const DEFAULT_MIN_WHY_WORDS = 8
export const MIN_SPOKEN_WHY_SEC = 3

const URL_RUN = /(?:https?:\/\/|www\.)\S+/gi

// A word is a run of letters or digits. A link and bare punctuation are never words, so pasting
// the link into the why, or typing "...", does not buy a share.
export function whyWords(why: string): number {
  return (why.replace(URL_RUN, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length
}

// Text the link itself would add to the why: the url as given, and the same without its scheme.
function withoutUrl(why: string, url: string): string {
  let out = why
  const bare = url.replace(/^https?:\/\//i, '')
  for (const form of [url, bare]) {
    if (form) out = out.split(form).join(' ')
  }
  return out
}

// null when the why is enough, else the sentence to show the person. A typed why meets `min`
// words (never below one); a spoken why stands in for it when it ran at least
// MIN_SPOKEN_WHY_SEC and speech was heard in it.
export function whyProblem(
  why: string,
  url: string,
  min: number,
  spoken?: { durationSec: number; heard: boolean },
): string | null {
  const need = Math.max(1, Math.floor(Number.isFinite(min) ? min : DEFAULT_MIN_WHY_WORDS))
  const have = whyWords(withoutUrl(why, url))
  if (have >= need) return null
  if (spoken) {
    if (spoken.durationSec < MIN_SPOKEN_WHY_SEC) {
      return `Say a little more about why: the voice note is under ${MIN_SPOKEN_WHY_SEC} seconds.`
    }
    if (!spoken.heard) return 'Say a little more about why: no words were heard in the voice note.'
    return null
  }
  return `Say a little more about why: ${have} of ${need} words.`
}
