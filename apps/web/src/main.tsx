import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

function setupEmbeddedViewport(): void {
  if (window.self === window.top) return
  document.documentElement.classList.add('is-embedded')

  let parentHeight = window.innerHeight
  try {
    parentHeight = window.parent.innerHeight || parentHeight
  } catch {
    // Cross-origin parent: fall back to the iframe's current viewport.
  }
  const target = Math.max(720, Math.min(920, Math.round(parentHeight * 0.82)))
  document.documentElement.style.setProperty('--embed-height', `${target}px`)

  const applyFrameHeight = (): void => {
    try {
      const frame = window.frameElement as HTMLIFrameElement | null
      if (frame) frame.style.height = `${target}px`
    } catch {
      // The parent can still read body.scrollHeight and resize the iframe itself.
    }
  }

  applyFrameHeight()
  requestAnimationFrame(applyFrameHeight)
  window.addEventListener('load', applyFrameHeight, { once: true })
}

setupEmbeddedViewport()

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
