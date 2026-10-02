import { state } from '../../../lib/host'

// The consumer's own check reads who each announcement went to. Not part of the package.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export function GET() {
  return Response.json(state().told)
}
