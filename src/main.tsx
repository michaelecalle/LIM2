// ⚠️ EN TOUT PREMIER : polyfill Safari pour l'itération async des ReadableStream
// (sinon pdf.js v5 casse l'import PDF sur iPad). Doit précéder tout import de pdf.js.
import "./lib/safariStreamAsyncIteratorPolyfill"
import "./lib/ftParser"
// tout en haut (dev uniquement)
import "./lib/setTitleFromTrain"
// import "./lib/limDebugClient" // désactivé temporairement pour supprimer l'affichage FT de debug
import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BUILD_TIME, BUILD_HASH } from './buildInfo'

const buildLabel = BUILD_HASH && BUILD_HASH.trim().length > 0
  ? `${BUILD_TIME} (${BUILD_HASH})`
  : BUILD_TIME

console.log(`[LIMGPT ${buildLabel}] démarre`)



// ✅ Import unique pour initialiser l’écoute du bouton "Importer PDF"
import './lib/limParser'

import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
