// Where the fake host's "signed URLs" point: one second of silence, so an audio player has
// something real to load. An app's signedUrl returns a short-lived storage URL instead.
export const runtime = 'nodejs'

export function GET() {
  const rate = 8000
  const data = rate
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(data, 40)
  b.fill(128, 44)
  return new Response(b, { headers: { 'Content-Type': 'audio/wav' } })
}
