// src/components/LIM/TunelesViewer.tsx
// 27/10 — Document ADIF « Túneles de longitud sup. 1000 metros » (évacuation des
// voyageurs en cas d'arrêt inopiné en tunnel), ouvert depuis le menu Paramètres.
//
// Si la position du train est déterminée (GPS ou estimation horaire, cf.
// lib/trainPosition) et tombe dans un tunnel qui a une fiche → ouverture sur cette
// fiche. Sinon (position inconnue, hors tunnel, tunnel sans fiche) → document
// complet, page 1 (schéma). Correspondance tunnel → fiche → page/hauteur dans
// public/tuneles.map.json (modifiable sans toucher au code).
//
// L'appui long sur les bandes de tunnel (essayé le 27/10) a été abandonné au
// profit de ce menu : accès rare, pas besoin qu'il soit sur la fiche train.

import { useEffect, useState } from 'react'
import ManualPdfCanvasViewer from './ManualPdfCanvasViewer'
import { fetchManagedDocBlobUrl } from '../../lib/managedDocs'
import { TUNNEL_ZONES_PKINTERNAL } from '../../data/tunnelZones'
import { getCurrentTrainPkInternal } from '../../lib/trainPosition'

const TUNELES_PDF_URL = '/tuneles.pdf'
const TUNELES_MAP_URL = '/tuneles.map.json'

/** Événement d'ouverture (menu Paramètres). */
export const TUNELES_OPEN_EVENT = 'lim:tuneles-open'

// L'estimation horaire est approximative en tunnel : un train arrêté près d'une
// tête peut être estimé juste dehors → on prend le tunnel le plus proche dans
// cette marge (validé par l'utilisateur, 27/10).
const MARGE_TUNNEL_KM = 0.3

type Fiche = { nom: string; page: number; y: number }
type TunelesMap = { fiches: Record<string, Fiche>; tunnels: Record<string, number> }
type Ouverture = { page: number; y: number; titre: string; detail: string }

type Props = { dark: boolean }

/** Tunnel contenant le PK, sinon le plus proche à moins de la marge, ou null. */
function tunnelProche(pk: number) {
  let best: { id: string; ecart: number } | null = null
  for (const z of TUNNEL_ZONES_PKINTERNAL) {
    const ecart = pk < z.pkIntMin ? z.pkIntMin - pk : pk > z.pkIntMax ? pk - z.pkIntMax : 0
    if (ecart <= MARGE_TUNNEL_KM && (best == null || ecart < best.ecart)) best = { id: z.id, ecart }
  }
  return best?.id ?? null
}

export default function TunelesViewer({ dark }: Props) {
  const [ouverture, setOuverture] = useState<Ouverture | null>(null)
  // null tant qu'on ne sait pas quelle source utiliser : le visualiseur n'est monté
  // qu'une fois la source connue, sinon un changement de source après coup le
  // rechargerait et perdrait le placement sur la fiche.
  const [pdfSrc, setPdfSrc] = useState<string | null>(null)

  useEffect(() => {
    const h = () => {
      void (async () => {
        let map: TunelesMap | null = null
        try {
          const res = await fetch(TUNELES_MAP_URL, { cache: 'no-store' })
          if (res.ok) map = (await res.json()) as TunelesMap
        } catch (err) {
          console.warn('[TunelesViewer] correspondance indisponible', err)
        }
        const complet = (detail: string) =>
          setOuverture({ page: 1, y: 0, titre: 'Túneles de longitud sup. 1000 metros', detail })

        const pk = getCurrentTrainPkInternal()
        if (pk == null) return complet('Position du train non déterminée : document complet')
        const id = tunnelProche(pk)
        if (id == null) return complet('Train hors tunnel : document complet')
        const n = map?.tunnels?.[id]
        const f = n != null ? map?.fiches?.[String(n)] : undefined
        if (!f) return complet('Tunnel sans fiche (moins de 1000 m ou hors zone ADIF) : document complet')
        setOuverture({ page: f.page, y: f.y, titre: f.nom, detail: 'Tunnel actuel — Túneles de longitud sup. 1000 metros' })
      })()
    }
    window.addEventListener(TUNELES_OPEN_EVENT, h)
    return () => window.removeEventListener(TUNELES_OPEN_EVENT, h)
  }, [])

  const open = ouverture != null

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

  if (!ouverture) return null

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
            <div className="text-sm font-semibold truncate">{ouverture.titre}</div>
            <div className="text-[11px] opacity-70 truncate">{ouverture.detail}</div>
          </div>
          <button type="button" onClick={() => setOuverture(null)}
            className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold">
            Fermer
          </button>
        </div>
        <div className="min-h-0 flex-1 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm">
          {pdfSrc && (
            <ManualPdfCanvasViewer
              pdfUrl={pdfSrc}
              page={ouverture.page}
              pageY={ouverture.y}
              onPageChange={() => {}}
              applyDarkInvert={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}
