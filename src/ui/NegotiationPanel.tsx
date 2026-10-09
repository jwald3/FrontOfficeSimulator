import { motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { buildContract, STRUCTURES, type Terms } from '../engine/contracts'
import { money } from '../engine/format'
import { evaluateOffer, type Band, type Personality } from '../engine/negotiation'
import { rollRange } from '../engine/rng'
import { evaluatePackage } from '../engine/trades'
import type { RawMarketPlayer } from '../engine/types'
import { useCap } from '../game/store'
import { useHotkeys } from './lib'
import { DepthBadge, Key, PlayerArt } from './parts'
import './resign.css'

export interface Table {
  pers: Personality
  ask: Terms
  minimum: number
}

const READ: Record<Band, { label: string; line: string }> = {
  insulting: { label: 'Ice cold', line: "That isn't a serious offer. Come back with something real." },
  short: { label: 'Cool', line: "We're not close yet. He knows what the market says he's worth." },
  close: { label: 'Warm', line: "You're in the neighborhood. A little more gets this done." },
  deal: { label: 'Hot', line: '' },
}

function readBand(score: number): Band {
  if (score >= 1) return 'deal'
  if (score >= 0.95) return 'close'
  if (score >= 0.85) return 'short'
  return 'insulting'
}

export function NegHero({ p, table, sub }: { p: RawMarketPlayer; table: Table; sub: string }) {
  const { ask, pers } = table
  return (
    <div className="neg-hero">
      <PlayerArt id={p.id} name={p.name} pos={p.pos} size={88} />
      <div>
        <div className="eyebrow">{p.pos} · Age {p.age} · {sub}</div>
        <div className="display card-name">{p.name}</div>
        <div className="neg-ask">
          Asking <b className="num">{money(ask.aav)}</b>/yr · {ask.years} yr{ask.years > 1 ? 's' : ''} ·{' '}
          {Math.round(ask.guaranteePct * 100)}% gtd · prefers {pers.wantsCashNow ? 'cash up front' : 'total value'}
        </div>
      </div>
      <DepthBadge chart={p.chart} size="md" />
    </div>
  )
}

/**
 * The contract table: years, money, guarantees and structure, with a live
 * cap preview and the agent's (deliberately fuzzy) read of the offer.
 */
export function NegotiationPanel({
  p,
  table,
  seed,
  season,
  minBase,
  lastBand,
  offers,
  locked,
  onSubmit,
  children,
}: {
  p: RawMarketPlayer
  table: Table
  seed: number
  season: number
  minBase: (year: number) => number
  lastBand?: Band
  offers: number
  locked: boolean
  onSubmit: (terms: Terms) => void
  children?: ReactNode
}) {
  const cap = useCap()!
  const { ask, minimum, pers } = table
  const [terms, setTerms] = useState<Terms>({ ...ask, structure: 'backloaded' })
  const set = (patch: Partial<Terms>) => setTerms((t) => ({ ...t, ...patch }))
  const maxAav = Math.max(ask.aav, p.marketRange?.high ?? ask.aav) * 1.4

  const built = buildContract(terms, season, minBase)
  const capHit = built.years[0].base + built.years[0].bonus + built.years[0].other
  const score = evaluateOffer(ask, pers, terms).score
  // A fixed per-player bias keeps the exact acceptance line hidden.
  const biased = score + rollRange(seed, `read:${p.id}`, -0.035, 0.035)
  const band = readBand(biased)
  const needle = Math.max(0, Math.min(1, (biased - 0.75) / 0.35))

  const submit = () => onSubmit(terms)
  useHotkeys({ enter: submit }, !locked)

  return (
    <div className="negotiation">
      {offers > 0 && lastBand && lastBand !== 'deal' && (
        <div className="agent">
          <span className="agent-tag display">Agent</span>
          <span>{READ[lastBand].line}</span>
        </div>
      )}

      <div className="field">
        <label>Years</label>
        <div className="seg seg-years">
          {[1, 2, 3, 4, 5].map((y) => (
            <button key={y} className="seg-btn" aria-selected={terms.years === y} onClick={() => set({ years: y })}>
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Per year</label>
        <div className="slider-row">
          <button className="nudge" onClick={() => setTerms((t) => ({ ...t, aav: Math.max(minimum, t.aav - 250_000) }))} aria-label="Lower">−</button>
          <input
            type="range"
            min={minimum}
            max={maxAav}
            step={50_000}
            value={terms.aav}
            onChange={(e) => set({ aav: Number(e.target.value) })}
            aria-label="Average per year"
          />
          <button className="nudge" onClick={() => setTerms((t) => ({ ...t, aav: Math.min(maxAav, t.aav + 250_000) }))} aria-label="Raise">+</button>
          <span className="num slider-val">{money(terms.aav)}</span>
        </div>
      </div>

      <div className="field">
        <label>Guaranteed</label>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={terms.guaranteePct}
            onChange={(e) => set({ guaranteePct: Number(e.target.value) })}
            aria-label="Guaranteed share"
          />
          <span className="num slider-val">{Math.round(terms.guaranteePct * 100)}%</span>
        </div>
      </div>

      <div className="field">
        <label>Structure</label>
        <div className="structs">
          {STRUCTURES.map((s) => (
            <button key={s.id} className="struct" aria-pressed={terms.structure === s.id} onClick={() => set({ structure: s.id })} title={s.blurb}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="meter" data-band={band}>
        <div className="meter-head">
          <span className="eyebrow">Agent read</span>
          <span className="display meter-label">{READ[band].label}</span>
        </div>
        <div className="meter-track">
          <motion.i className="meter-needle" animate={{ left: `${needle * 100}%` }} transition={{ type: 'spring', stiffness: 260, damping: 26 }} />
        </div>
      </div>

      <div className="neg-impact">
        <div>
          <span className="cb-lbl">{season} cap hit</span>
          <span className="num">{money(capHit)}</span>
        </div>
        <div>
          <span className="cb-lbl">Effective space after</span>
          <span className={`num ${cap.effectiveSpace - capHit < 0 ? 'neg' : 'pos'}`}>{money(cap.effectiveSpace - capHit)}</span>
        </div>
        <div>
          <span className="cb-lbl">Total value</span>
          <span className="num">{money(terms.aav * terms.years)}</span>
        </div>
      </div>

      <div className="neg-actions">
        <button className="btn ghost" onClick={() => setTerms({ ...ask })}>Match ask</button>
        <button className="btn submit" onClick={submit}>Submit offer <Key>ENTER</Key></button>
      </div>

      {children}
    </div>
  )
}

export function Patience({ left, of = 4 }: { left: number; of?: number }) {
  return (
    <span className="pips" title={`${left} rounds of patience left`}>
      {Array.from({ length: of }, (_, i) => <i key={i} data-on={i < left} />)}
    </span>
  )
}

/**
 * A rough read on a package against what the other side wants: deliberately
 * fuzzy (the bands sit 3% high, the needle tops out at 125%), like an agent read.
 */
export function ReadMeter({ ask, offered }: { ask: number; offered: number }) {
  const band = offered ? evaluatePackage(ask * 1.03, offered) : 'insulting'
  const fill = Math.min(1, offered / (ask * 1.25))
  const label = { insulting: 'Not close', short: 'Getting there', close: 'Close', deal: 'Strong offer' }[band]
  return (
    <div className="meter" data-band={band}>
      <div className="meter-head">
        <span className="eyebrow">Their read</span>
        <span className="display meter-label">{label}</span>
      </div>
      <div className="meter-track">
        <motion.i className="meter-needle" animate={{ left: `${fill * 100}%` }} />
      </div>
    </div>
  )
}
