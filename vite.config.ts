// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ✅ route serveur dev pour upload Synology (évite CORS côté navigateur)
import { handleUploadToSynology } from './server/uploadToSynology'

// ✅ __dirname compatible ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ✅ Certificats HTTPS (mkcert) — à placer dans ./certs
const CERT_DIR = path.resolve(__dirname, 'certs')
const HTTPS_CERT = path.join(CERT_DIR, '192.168.1.43.pem')
const HTTPS_KEY = path.join(CERT_DIR, '192.168.1.43-key.pem')

export default defineConfig({
  plugins: [
    react(),

    // ✅ Middleware dev : POST /api/upload-pdf
    {
      name: 'limgpt-upload-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/upload-pdf' && req.method === 'POST') {
            handleUploadToSynology(req, res)
            return
          }
          next()
        })
      },
    },

    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      workbox: {
        // ⚠️ CORRIGÉ le 14/08 — le worker pdf.js DOIT être précaché.
        // Il est émis comme fichier séparé (~1,2 Mo) et n'entrait pas dans le
        // précache par défaut : il était donc téléchargé À LA DEMANDE, au moment
        // de l'import du PDF LTV. Sous mauvaise couverture, ce téléchargement
        // échoue (le parseur abandonne au bout de 15 s) et l'extraction rend
        // ZÉRO ligne — l'utilisateur l'a vécu le 14/08 : `rowsCount: 0` à 08h16
        // sous réseau faible, puis `rowsCount: 8` à 09h24 sous bon réseau, avec
        // le MÊME document. L'extraction est pourtant 100 % locale : c'est son
        // moteur qui manquait. Le limite par défaut (2 Mio) exclurait ce fichier.
        globPatterns: ['**/*.{js,css,html,svg,mjs}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'LIM2',
        short_name: 'LIM2',
        description: 'Affichage dynamique du LIM pour conducteurs TGV',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
      },
    }),
  ],

  server: {
    host: true,
    port: 5199,
    strictPort: true,

    // ✅ HTTPS pour iPad / Geolocation (secure context)
    https: {
      cert: fs.readFileSync(HTTPS_CERT),
      key: fs.readFileSync(HTTPS_KEY),
    },
  },
})
