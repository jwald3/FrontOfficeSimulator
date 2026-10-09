/** $19.70M / $930K / -$4.50M */
export function money(n: number, digits = 2): string {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  return `${sign}$${a}`
}

/** +$8.00M / -$1.20M, for deltas. */
export function signedMoney(n: number): string {
  return n > 0 ? `+${money(n)}` : money(n)
}

/** "R3 Pick 74", or "R3" for a future pick without a slot yet. */
export function pickName(pick: { round: number; overall: number | null }): string {
  return pick.overall ? `R${pick.round} Pick ${pick.overall}` : `R${pick.round}`
}
