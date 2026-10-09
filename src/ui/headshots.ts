import { useSyncExternalStore } from 'react'

/**
 * Player id → NFL.com headshot, built by scripts/headshots.mjs. Loaded once in the
 * background; until it arrives (or if it fails) PlayerArt keeps its silhouette.
 */
let paths: Record<string, string> = {}
const listeners = new Set<() => void>()

fetch(`${import.meta.env.BASE_URL}data/headshots.json`)
  .then((res) => (res.ok ? res.json() : {}))
  .then((data: Record<string, string>) => {
    paths = data
    listeners.forEach((l) => l())
  })
  .catch(() => {})

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Requested sizes snap to a few widths so the CDN and browser caches are shared across screens. */
const WIDTHS = [96, 192, 384]

export function useHeadshot(id: string | undefined, size: number): string | undefined {
  const path = useSyncExternalStore(subscribe, () => (id ? paths[id] : undefined))
  if (!path) return undefined
  const want = size * Math.min(window.devicePixelRatio || 1, 2)
  const w = WIDTHS.find((x) => x >= want) ?? WIDTHS[WIDTHS.length - 1]
  const [kind, ...rest] = path.split('/')
  return `https://static.www.nfl.com/image/${kind}/f_auto,q_auto,w_${w},h_${w},c_fill,g_north/${rest.join('/')}`
}
