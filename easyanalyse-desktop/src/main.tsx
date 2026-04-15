import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'

createRoot(document.getElementById('root')!).render(<App />)
