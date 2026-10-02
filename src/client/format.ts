import { nameOf } from './config.js'

// "Sep 3": a date the way a person says it, in the reader's own zone.
export const shortDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "Bo", "Bo and Cy", "Bo, Cy and Di".
export const namesOf = (people: string[]): string => {
  const n = people.map(nameOf)
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}
