import Link from 'next/link'
import { DEFAULT_MIN_WHY_WORDS, whyWords } from '@supersuit/annotated-links'

// A server component using the plain entry, so the root entry is proven importable anywhere.
export default function Page() {
  return (
    <main className="p-6">
      <p>A why needs {DEFAULT_MIN_WHY_WORDS} words; &quot;one two three&quot; has {whyWords('one two three')}.</p>
      <Link href="/links">Links</Link>
    </main>
  )
}
