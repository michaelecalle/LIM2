// src/components/LIM/TunelesViewer.tsx
// 27/10 — Appui long sur un tunnel (vues verticale et horizontale) → document ADIF
// « Túneles de longitud sup. 1000 metros », ouvert directement à la fiche du tunnel.
//
// Les vues n'ouvrent rien elles-mêmes : elles émettent `lim:tunnel-long-press`
// ({ id } = id de TUNNEL_ZONES_PKINTERNAL). La correspondance tunnel → fiche → page
// et hauteur dans la page vit dans public/tuneles.map.json (modifiable sans toucher
// au code). Tunnel sans fiche → petite fenêtre d'information.

import { useEffect, useState } from 'react'
import ManualPdfCanvasViewer from './ManualPdfCanvasViewer'
import { fetchManagedDocBlobUrl } from '../../lib/managedDocs'
import { TUNNEL_ZONES_PKINTERNAL } from '../../data/tunnelZones'
import { TUNNEL_LONG_PRESS_EVENT } from '../../lib/tunnelLongPress'

const TUNELES_PDF_URL = '/tuneles.pdf'
const TUNELES_MAP_URL = '/tuneles.map.json'


type Fiche = { nom: string; page: number; y: number }
type TunelesMap = { fiches: Record<string, Fiche>; tunnels: Record<string, number> }

type Props = { dark: boolean }

export default function TunelesViewer({ dark }: Props) {
  const [fiche, setFiche] = useState<Fiche | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // null tant qu'on ne sait pas quelle source utiliser : le visualiseur n'est monté
  // qu'une fois la source connue, sinon un changement de source après coup le
  // rechargerait et perdrait le placement sur la fiche.
  const [pdfSrc, setPdfSrc] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      void (async () => {
        let map: TunelesMap | null = null
        try {
          const res = await fetch(TUNELES_MAP_URL, { cache: 'no-store' })
          if (res.ok) map = (await res.json()) as TunelesMap
        } catch (err) {
          console.warn('[TunelesViewer] correspondance indisponible', err)
        }
        const n = map?.tunnels?.[id]
        const f = n != null ? map?.fiches?.[String(n)] : undefined
        if (f) {
          setFiche(f)
          return
        }
        // Sans fiche : le document ne couvre que les tunnels ADIF de plus de 1000 m.
        // Perthus (LFP) dépasse 1000 m mais n'y figure pas → message distinct.
        const z = TUNNEL_ZONES_PKINTERNAL.find((t) => t.id === id)
        const longueurKm = z ? z.pkIntMax - z.pkIntMin : 0
        setInfo(longueurKm >= 1
          ? "Ce tunnel n'a pas de fiche dans le document des tunnels (hors zone ADIF)."
          : 'Ce tunnel fait moins de 1000 m.')
      })()
    }
    window.addEventListener(TUNNEL_LONG_PRESS_EVENT, h as EventListener)
    return () => window.removeEventListener(TUNNEL_LONG_PRESS_EVENT, h as EventListener)
  }, [])

  const open = fiche != null

  useEffect(() => {
    if (!open) { setPdfSrc(null); return }
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      // 1) Version publiée par l'éditeur (lim-logs) ; 2) sinon copie livrée avec l'app.
      const managed = await fetchManagedDocBlobUrl('tuneles')
      if (cancelled) { if (managed) URL.revokeObjectURL(managed); return }
      objectUrl = managed
      setPdfSrc(managed ?? TUNELES_PDF_URL)
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [open])

  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'
  const cardBg = dark ? '#18181b' : '#ffffff'

  if (info) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
        onClick={() => setInfo(null)}>
        <div className="rounded-xl border shadow-lg px-5 py-4 max-w-xs text-center"
          style={{ backgroundColor: cardBg, borderColor: border, color: fg }}
          onClick={(e) => e.stopPropagation()}>
          <div className="text-sm font-semibold mb-3">{info}</div>
          <button type="button" onClick={() => setInfo(null)}
            className="h-8 px-4 text-xs rounded-md bg-blue-600 text-white font-semibold">
            OK
          </button>
        </div>
      </div>
    )
  }

  if (!fiche) return null

  const bg = dark ? 'rgba(9,9,11,0.96)' : 'rgba(244,244,245,0.95)'

  return (
    <div
      className="fixed left-0 right-0 z-[9998] border-t overflow-hidden"
      style={{ top: '4rem', height: 'calc(100vh - 4rem)', maxHeight: 'calc(100dvh - 4rem)', backgroundColor: bg, borderColor: border, color: fg }}
    >
      <div className="h-full flex flex-col gap-2 p-3">
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-xl border shadow-sm px-3 py-2"
          style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{fiche.nom}</div>
            <div className="text-[11px] opacity-70 truncate">Túneles de longitud sup. 1000 metros</div>
          </div>
          <button type="button" onClick={() => setFiche(null)}
            className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold">
            Fermer
          </button>
        </div>
        <div className="min-h-0 flex-1 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm">
          {pdfSrc && (
            <ManualPdfCanvasViewer
              pdfUrl={pdfSrc}
              page={fiche.page}
              pageY={fiche.y}
              onPageChange={() => {}}
              applyDarkInvert={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}
