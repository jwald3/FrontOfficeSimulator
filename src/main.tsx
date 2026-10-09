import { StrictMode } from 'react'
import { MotionGlobalConfig } from 'framer-motion'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ?instant skips every animation (QA and automated walkthroughs).
if (new URLSearchParams(location.search).has('instant')) MotionGlobalConfig.skipAnimations = true

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
