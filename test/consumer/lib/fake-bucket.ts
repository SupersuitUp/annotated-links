import type { Bucket } from '@supersuit/annotated-links/server'

// An in-memory stand-in for the slice of a Cloud Storage bucket the store uses. A signed URL names
// its action and path, so a check can see exactly what was signed.
export function fakeBucket() {
  const objects = new Map<string, { bytes: Buffer; contentType?: string; metadata?: Record<string, string> }>()
  const file = (name: string) => ({
    name,
    exists: async () => [objects.has(name)] as [boolean],
    getMetadata: async () => {
      const o = objects.get(name)
      if (!o) throw new Error('No such object')
      return [{ size: String(o.bytes.length), contentType: o.contentType, ...(o.metadata ? { metadata: o.metadata } : {}) }]
    },
    download: async () => {
      const o = objects.get(name)
      if (!o) throw new Error('No such object')
      return [o.bytes] as [Buffer]
    },
    getSignedUrl: async (opts: { action: string }) => [`https://signed.example/${opts.action}/${name}`] as [string],
  })
  return {
    bucket: { file } as unknown as Bucket,
    put(name: string, bytes: Buffer, contentType?: string, metadata?: Record<string, string>) { objects.set(name, { bytes, contentType, metadata }) },
  }
}
