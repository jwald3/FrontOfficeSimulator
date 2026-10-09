/**
 * Synthesized sound effects (Web Audio): no audio files, nothing to license.
 * Everything is quiet by design — this is a front office, not a stadium — and
 * nothing plays until the player turns sound on.
 */

export type Cue = 'click' | 'whoosh' | 'stamp' | 'crowd' | 'cash' | 'buzz' | 'ring' | 'tick' | 'horn' | 'flip'

const STORAGE_KEY = 'front-office:sound'
let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = readSetting()

function readSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function soundEnabled(): boolean {
  return enabled
}

export function setSoundEnabled(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Preference just won't persist.
  }
  if (on) audio()?.resume()
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.32
    master.connect(ctx.destination)
  }
  return ctx
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function tone(c: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, peak: number, endFreq?: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(master!)
  o.start(start)
  o.stop(start + dur + 0.05)
}

function noise(c: AudioContext, start: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, endFreq?: number, attack = 0.01) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, dur + 0.1)
  const f = c.createBiquadFilter()
  f.type = filter
  f.frequency.setValueAtTime(freq, start)
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, start + dur)
  f.Q.value = 0.8
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(f).connect(g).connect(master!)
  src.start(start)
  src.stop(start + dur + 0.1)
}

const CUES: Record<Cue, (c: AudioContext, t: number) => void> = {
  click: (c, t) => tone(c, 'triangle', 1400, t, 0.05, 0.12, 900),
  flip: (c, t) => noise(c, t, 0.18, 0.25, 'bandpass', 3000, 900),
  whoosh: (c, t) => noise(c, t, 0.45, 0.35, 'bandpass', 400, 2600, 0.12),
  stamp: (c, t) => {
    tone(c, 'sine', 120, t, 0.25, 0.9, 50)
    noise(c, t, 0.12, 0.4, 'lowpass', 1800)
  },
  // A crowd swell: broadband noise through a voice-range band, slow attack.
  crowd: (c, t) => {
    noise(c, t, 1.8, 0.35, 'bandpass', 900, 1300, 0.35)
    noise(c, t + 0.1, 1.6, 0.2, 'bandpass', 2200, 1800, 0.4)
  },
  cash: (c, t) => [660, 880, 1320].forEach((f, i) => tone(c, 'triangle', f, t + i * 0.07, 0.18, 0.25)),
  buzz: (c, t) => tone(c, 'square', 110, t, 0.35, 0.18, 90),
  ring: (c, t) => {
    for (let i = 0; i < 2; i++) {
      const s = t + i * 0.42
      tone(c, 'sine', 440, s, 0.3, 0.18)
      tone(c, 'sine', 480, s, 0.3, 0.18)
    }
  },
  tick: (c, t) => tone(c, 'square', 2000, t, 0.02, 0.08),
  horn: (c, t) => [147, 185, 220].forEach((f) => tone(c, 'sawtooth', f, t, 1.1, 0.12)),
}

export function play(cue: Cue) {
  if (!enabled) return
  const c = audio()
  if (!c || !master) return
  if (c.state === 'suspended') void c.resume()
  CUES[cue](c, c.currentTime + 0.01)
}
