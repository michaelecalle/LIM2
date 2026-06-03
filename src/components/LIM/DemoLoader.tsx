// src/components/LIM/DemoLoader.tsx
// Modale de chargement du ZIP de demo (liste en ligne + chargement local).

import { useEffect, useRef, useState } from 'react'
import { unzipSync } from 'fflate'

const GH_TOKEN = import.meta.env.VITE_GITHUB_LOG_TOKEN as string | undefined
const GH_OWNER = (import.meta.env.VITE_GITHUB_LOG_OWNER as string | undefined) ?? 'michaelecalle'
const GH_REPO = (import.meta.env.VITE_GITHUB_LOG_REPO as string | undefined) ?? 'lim-logs'
const DEMO_SUBFOLDER = 'demo'

export type DemoData = {
  logText: string
  pdfFile: File
  zipName: string
}

type OnlineFile = { name: string; size: number }

type Props = {
  dark: boolean
  onLoaded: (data: DemoData) => void
  onClose: () => void
}

export default function DemoLoader({ dark, onLoaded, onClose }: Props) {
  const [onlineFiles, setOnlineFiles] = useState<OnlineFile[] | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [loadBusy, setLoadBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Charger la liste des ZIPs de demo depuis GitHub
  useEffect(() => {
    if (!GH_TOKEN) return
    setListLoading(true)
    setListError(null)
    void (async () => {
      try {
        const res = await fetch(
          'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + DEMO_SUBFOLDER,
          { headers: { Authorization: 'Bearer ' + GH_TOKEN } }
        )
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data: any[] = await res.json()
        const zips = data
          .filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.zip'))
          .sort((a, b) => a.name.localeCompare(b.name))
        setOnlineFiles(zips.map(f => ({ name: f.name, size: f.size })))
      } catch (err: any) {
        setListError(err?.message ?? 'Erreur de chargement')
      } finally {
        setListLoading(false)
      }
    })()
  }, [])

  const parseZip = async (file: File): Promise<DemoData> => {
    const buffer = await file.arrayBuffer()
    const entries = unzipSync(new Uint8Array(buffer))
    const logKey = Object.keys(entries).find(k => k.toLowerCase().endsWith('.log'))
    const pdfKey = Object.keys(entries).find(k => k.toLowerCase().endsWith('.pdf'))
    if (!logKey) throw new Error('Aucun fichier .log dans ce ZIP.')
    if (!pdfKey) throw new Error('Aucun fichier .pdf dans ce ZIP.')
    const logText = new TextDecoder().decode(entries[logKey])
    const pdfBlob = new File([entries[pdfKey]], pdfKey, { type: 'application/pdf' })
    return { logText, pdfFile: pdfBlob, zipName: file.name }
  }

  const handleOnlineSelect = async (filename: string) => {
    if (!GH_TOKEN) return
    setLoadBusy(true)
    setLoadError(null)
    try {
      const res = await fetch(
        'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + DEMO_SUBFOLDER + '/' + encodeURIComponent(filename),
        { headers: { Authorization: 'Bearer ' + GH_TOKEN, Accept: 'application/vnd.github.raw' } }
      )
      if (!res.ok) throw new Error('Telechargement echoue : HTTP ' + res.status)
      const blob = await res.blob()
      const file = new File([blob], filename, { type: 'application/zip' })
      const data = await parseZip(file)
      onLoaded(data)
    } catch (err: any) {
      setLoadError(err?.message ?? String(err))
    } finally {
      setLoadBusy(false)
    }
  }

  const handleLocalFile = async (file: File) => {
    setLoadBusy(true)
    setLoadError(null)
    try {
      const data = await parseZip(file)
      onLoaded(data)
    } catch (err: any) {
      setLoadError(err?.message ?? String(err))
    } finally {
      setLoadBusy(false)
    }
  }

  const bg = dark ? '#18181b' : '#ffffff'
  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'
  const overlayBg = 'rgba(0,0,0,0.5)'

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ backgroundColor: overlayBg, backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(480px,92vw)] rounded-2xl border shadow-xl p-5"
        style={{ backgroundColor: bg, borderColor: border, color: fg }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-base font-semibold">Mode demo</div>
            <div className="text-[11px] opacity-60 mt-0.5">Charger un ZIP de demonstration</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
          >
            Fermer
          </button>
        </div>

        {/* Erreur de chargement */}
        {loadError && (
          <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
            {loadError}
          </div>
        )}

        {/* Fichiers en ligne */}
        {GH_TOKEN && (
          <div className="mb-4">
            <div className="text-xs font-semibold opacity-70 mb-2">Fichiers disponibles</div>
            {listLoading && <div className="text-xs opacity-50">Chargement...</div>}
            {listError && <div className="text-xs text-red-500">{listError}</div>}
            {!listLoading && onlineFiles?.length === 0 && (
              <div className="text-xs opacity-50 italic">Aucun fichier disponible.</div>
            )}
            {onlineFiles?.map(f => (
              <button
                key={f.name}
                type="button"
                disabled={loadBusy}
                onClick={() => void handleOnlineSelect(f.name)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
              >
                <span className="text-xl">🎬</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{f.name.replace('.zip', '')}</div>
                  <div className="text-[11px] opacity-55">{Math.round(f.size / 1024)} KB</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Separateur */}
        <div className="h-px mb-4" style={{ backgroundColor: border }} />

        {/* Chargement local */}
        <button
          type="button"
          disabled={loadBusy}
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-10 rounded-xl border text-sm font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          style={{ borderColor: border }}
        >
          {loadBusy ? '⏳ Chargement...' : '📂 Charger un fichier local'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleLocalFile(f) }}
        />
      </div>
    </div>
  )
}
