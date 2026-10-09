import { AnimatePresence, motion } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import { useGame } from './game/store'
import { Boundary } from './ui/Boundary'
import { play } from './ui/sound'
import { Game } from './ui/Game'
import { Title } from './ui/Title'
// Editors only, so it loads on demand rather than with the game.
const Editorial = lazy(() => import('./ui/Editorial').then((m) => ({ default: m.Editorial })))
import './ui/app.css'
import './ui/mobile.css'

export default function App() {
  const screen = useGame((s) => s.screen)
  const load = useGame((s) => s.load)
  const quitToTitle = useGame((s) => s.quitToTitle)
  useEffect(() => void load(), [load])
  // A soft click on every button press; silent unless sound is on.
  useEffect(() => {
    const onDown = (e: PointerEvent) => (e.target as HTMLElement).closest('button') && play('click')
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  return (
    <>
      <div className="stadium" aria-hidden />
      <div className="app">
        <AnimatePresence mode="wait">
          {screen === 'loading' && <Loading key="loading" />}
          {screen === 'error' && <LoadError key="error" />}
          {screen === 'title' && (
            <motion.div key="title" className="fill" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
              <Title />
            </motion.div>
          )}
          {screen === 'editorial' && (
            <motion.div key="editorial" className="fill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={<Loading />}>
                <Editorial />
              </Suspense>
            </motion.div>
          )}
          {screen === 'game' && (
            <motion.div key="game" className="fill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              <Boundary onReset={quitToTitle}>
                <Game />
              </Boundary>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

function Loading() {
  return (
    <motion.div className="loading" exit={{ opacity: 0 }}>
      <div className="display loading-mark">Front <span>Office</span></div>
      <div className="loading-bar"><span /></div>
      <div className="eyebrow">Loading the league</div>
    </motion.div>
  )
}

function LoadError() {
  const error = useGame((s) => s.error)
  const load = useGame((s) => s.load)
  return (
    <div className="loading">
      <div className="display loading-mark">Fumble.</div>
      <p className="muted">The offseason data didn't load: {error}</p>
      <button className="btn" onClick={() => void load()}>Try again</button>
    </div>
  )
}
