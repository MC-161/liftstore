import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, storedTheme } from './lib/theme'

// Before first paint, so a pinned theme never flashes the other one.
// Light unless the visitor has chosen dark.
applyTheme(storedTheme() ?? 'light')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
