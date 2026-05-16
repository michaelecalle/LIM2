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
