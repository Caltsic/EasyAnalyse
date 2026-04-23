import { createRoot } from 'react-dom/client'
import { applyTheme, getInitialTheme } from './lib/theme'
import './index.css'

void import('@fontsource/manrope/latin-400.css')
void import('@fontsource/manrope/latin-500.css')
void import('@fontsource/manrope/latin-600.css')

const rootElement = document.getElementById('root')!
applyTheme(getInitialTheme())
rootElement.innerHTML = '<div class="boot-screen">Loading...</div>'

const root = createRoot(rootElement)
const isViewerRoute = window.location.pathname.startsWith('/viewer')
const appElementPromise = isViewerRoute
  ? import('./components/viewer/MobileViewerApp').then(({ MobileViewerApp }) => <MobileViewerApp />)
  : import('./App').then(({ default: App }) => <App />)

void appElementPromise.then((appElement) => root.render(appElement))
