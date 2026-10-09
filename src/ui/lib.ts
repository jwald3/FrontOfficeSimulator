import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Contract, Move, Phase, Position } from '../engine/types'

/** Each phase's number, name, a short name for a crowded top bar, and its tagline. */
export const PHASE_INFO: Record<Phase, { n: string; name: string; short: string; tagline: string }> = {
  coach: { n: '1', name: 'Head Coach', short: 'Coach', tagline: 'It starts at the top.' },
  'in-house': { n: '2', name: 'In-House Decisions', short: 'In-House', tagline: 'Make room for your vision.' },
  're-sign': { n: '3', name: 'Re-Sign Your Own', short: 'Re-Sign', tagline: 'Decide who stays.' },
  'free-agency': { n: '4', name: 'Free Agency', short: 'Free Agency', tagline: 'The market is open.' },
  draft: { n: '5', name: 'The Draft', short: 'Draft', tagline: 'You are on the clock.' },
  summary: { n: '6', name: 'Your Offseason', short: 'Verdict', tagline: 'The verdict is in.' },
}

const POS_GROUP: Record<Position, 'off' | 'def' | 'st'> = {
  QB: 'off', RB: 'off', FB: 'off', WR: 'off', TE: 'off', OT: 'off', IOL: 'off',
  IDL: 'def', EDGE: 'def', LB: 'def', CB: 'def', S: 'def',
  K: 'st', P: 'st', LS: 'st',
}

export function positionGroup(pos: Position) {
  return POS_GROUP[pos] ?? 'off'
}

export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const fn = map[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}

/**
 * On a phone the detail panel sits below the list, so selecting a row scrolls
 * it into view. Desktop shows both side by side and does nothing.
 */
export function useRevealOnPhone(ref: RefObject<HTMLElement | null>, key: unknown) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (window.matchMedia('(max-width: 720px)').matches) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [ref, key])
}

/**
 * Lean every slab matching `selector` inside `root` at the same angle, whatever its
 * height. The default slant is a fixed 14px, so rows of cards with different
 * heights would lean differently and their outer edges wouldn't line up. The ratio
 * keeps a 150px card at the usual 14px.
 */
export function useEvenSlant(root: RefObject<HTMLElement | null>, selector: string, ratio = 14 / 150) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) (e.target as HTMLElement).style.setProperty('--slant', `${(e.borderBoxSize[0]?.blockSize ?? e.contentRect.height) * ratio}px`)
    })
    el.querySelectorAll<HTMLElement>(selector).forEach((c) => ro.observe(c))
    return () => ro.disconnect()
  }, [root, selector, ratio])
}

/** Moves that bring a player in get the card reveal instead of a plain result card. */
const REVEAL_KINDS = new Set<Move['kind']>(['sign', 'tag', 'tender', 'match', 'trade', 'draft', 'udfa'])

export function isReveal(move: Move, player?: Contract): player is Contract {
  return !!player && REVEAL_KINDS.has(move.kind)
}
