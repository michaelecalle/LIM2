// src/components/LIM/GuiaViewer.tsx
// Visionneuse PDF pour le Guia BSN (livret d'aide a la conduite Barcelone-Figueres).

import { useEffect, useMemo, useState } from 'react'
import ManualPdfCanvasViewer from './ManualPdfCanvasViewer'
import { fetchManagedDocBlobUrl } from '../../lib/managedDocs'

const GUIA_PDF_URL = '/guia-bsn.pdf?guiaBsn=1'

type GuiaTocItem = { id: string; level: 0 | 1; title: string; page: number }

const TOC: GuiaTocItem[] = [
  { id: 'cover',       level: 0, title: 'Couverture',                                        page: 1  },
  { id: 'sommaire',    level: 0, title: 'Sommaire',                                          page: 2  },
  { id: 'inicio',      level: 1, title: 'Inicio de movimiento',                              page: 3  },
  { id: 'bca',         level: 1, title: 'Senalizacion BCA/ETCS',                             page: 4  },
  { id: 'dispositivos',level: 1, title: 'Dispositivos embarcados y de seguridad',            page: 5  },
  { id: 'traccion',    level: 1, title: 'Condiciones de traccion - rampas - inmovilizacion', page: 6  },
  { id: 'bsl',         level: 1, title: 'Senalizacion BSL',                                  page: 7  },
  { id: 'protec-adif', level: 1, title: 'Proteccion del personal (ADIF)',                    page: 9  },
  { id: 'anorm-adif',  level: 1, title: 'Anormalidades ADIF',                               page: 10 },
  { id: 'retroceso',   level: 1, title: 'Retroceso',                                        page: 12 },
  { id: 'telefon',     level: 1, title: 'Telefonemas - BAR',                                page: 13 },
  { id: 'socorro',     level: 1, title: 'Socorro',                                          page: 14 },
  { id: 'bajada',      level: 1, title: 'Bajada de viajeros en plena via',                  page: 15 },
  { id: 'bt-sup',      level: 1, title: 'BT supletorio por anormalidad',                    page: 16 },
  { id: 'sagrera',     level: 1, title: 'La Sagrera',                                       page: 18 },
  { id: 'particular',  level: 1, title: 'Particularidades',                                 page: 19 },
  { id: 'senal-lfp',   level: 1, title: 'Senalizacion (LFP)',                               page: 22 },
  { id: 'protec-lfp',  level: 1, title: 'Proteccion del personal (LFP)',                    page: 22 },
  { id: 'anorm-lfp',   level: 1, title: 'Anormalidades LFP',                               page: 22 },
  { id: 'controle',    level: 1, title: 'Controle manuel',                                  page: 25 },
  { id: 'reglament',   level: 1, title: 'Reglementation du travail - Espagne',              page: 27 },
  { id: 'vocab',       level: 1, title: 'Vocabulario',                                      page: 29 },
  { id: 'catenaria',   level: 1, title: 'Catenaria',                                        page: 31 },
  { id: 'anexo1',      level: 1, title: 'Anexo 1 - Condiciones de traccion (socorro)',      page: 32 },
  { id: 'anexo2',      level: 1, title: 'Anexo 2 - Aislamiento del ETCS',                  page: 33 },
  { id: 'anexo3',      level: 1, title: 'Anexo 3 - Prueba de freno (modo remolque)',        page: 34 },
  { id: 'qr',          level: 1, title: 'Enlaces QR-code',                                  page: 35 },
]

type Props = { open: boolean; dark: boolean; onClose: () => void }

export default function GuiaViewer({ open, dark, onClose }: Props) {
  const [page, setPage] = useState(1)
  const [activeTocId, setActiveTocId] = useState('cover')
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setPdfObjectUrl(null); return }
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        // 1) Version gérée (mise à jour via l'éditeur) depuis lim-logs, en priorité.
        const managed = await fetchManagedDocBlobUrl('guia')
        if (managed) {
          if (cancelled) { URL.revokeObjectURL(managed); return }
          objectUrl = managed
          setPdfObjectUrl(managed)
          return
        }
        // 2) Repli : PDF statique livré avec l'app.
        const res = await fetch(GUIA_PDF_URL, { cache: 'no-store', headers: { Accept: 'application/pdf' } })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const blob = await res.blob()
        const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
        objectUrl = URL.createObjectURL(pdfBlob)
        if (!cancelled) setPdfObjectUrl(objectUrl)
      } catch (err) {
        console.warn('[GuiaViewer] load error', err)
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [open])

  // Reset page when opening
  useEffect(() => {
    if (open) { setPage(1); setActiveTocId('cover') }
  }, [open])

  const pdfSrc = useMemo(() => {
    const base = pdfObjectUrl ?? GUIA_PDF_URL
    return base + '#page=' + page + '&toolbar=1&navpanes=0'
  }, [pdfObjectUrl, page])

  const handlePageChange = (nextPage: number) => {
    const safe = Number.isFinite(nextPage) && nextPage > 0 ? Math.trunc(nextPage) : 1
    setPage(safe)
    const active = [...TOC].filter(i => i.page <= safe).sort((a, b) => b.page - a.page)[0]
    if (active) setActiveTocId(active.id)
  }

  if (!open) return null

  const bg = dark ? 'rgba(9,9,11,0.96)' : 'rgba(244,244,245,0.95)'
  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'
  const cardBg = dark ? '#18181b' : '#ffffff'

  return (
    <div
      className="fixed left-0 right-0 z-[9998] border-t overflow-hidden"
      style={{ top: '4rem', height: 'calc(100vh - 4rem)', maxHeight: 'calc(100dvh - 4rem)', backgroundColor: bg, borderColor: border, color: fg }}
    >
      <div className="h-full flex flex-col gap-2 p-3">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-xl border shadow-sm px-3 py-2"
          style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Guia BSN</div>
            <div className="text-[11px] opacity-70 truncate">Livret d&apos;aide à la conduite — Barcelone-Figuères</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={() => { const url = pdfSrc; const w = window.open(url, '_blank', 'noopener,noreferrer'); if (!w) window.location.href = url }}
              className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold">
              Ouvrir à part
            </button>
            <button type="button" onClick={onClose}
              className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold">
              Fermer
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 grid gap-2" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>

          {/* TOC sidebar */}
          <aside className="min-h-0 rounded-xl overflow-hidden border shadow-sm flex flex-col"
            style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
            <div className="shrink-0 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <div className="text-xs font-semibold">Sommaire</div>
              <div className="text-[11px] opacity-60">Navigation dans le guide</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
              {TOC.map(item => {
                const active = activeTocId === item.id
                const indent = item.level === 0 ? 'font-semibold' : 'pl-3 text-[11px]'
                return (
                  <button key={item.id} type="button"
                    onClick={() => { setPage(item.page); setActiveTocId(item.id) }}
                    className={active
                      ? 'w-full rounded-lg px-2 py-1.5 text-left bg-blue-600 text-white flex items-center gap-2 ' + indent
                      : 'w-full rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ' + indent}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className={active ? 'shrink-0 text-[10px] opacity-90 tabular-nums' : 'shrink-0 text-[10px] opacity-50 tabular-nums'}>
                      {item.page}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* PDF viewer */}
          <div className="min-h-0 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm">
            <ManualPdfCanvasViewer
              pdfUrl={pdfObjectUrl ?? GUIA_PDF_URL}
              page={page}
              onPageChange={handlePageChange}
              applyDarkInvert={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
