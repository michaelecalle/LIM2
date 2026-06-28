// src/components/LIM/ManualViewer.tsx
// Visionneuse PDF du manuel utilisateur LIM,
// extraite de TitleBar.tsx pour alléger ce fichier.

import { useEffect, useMemo, useState } from 'react'
import ManualPdfCanvasViewer from './ManualPdfCanvasViewer'
import { logTestEvent } from '../../lib/testLogger'
import { fetchManagedDocBlobUrl } from '../../lib/managedDocs'

const MANUAL_PDF_URL = '/manuel-utilisateur-lim.pdf?limManual=1'

type TocItem = { id: string; level: 0 | 1 | 2; title: string; page: number }

const TOC: TocItem[] = [
  { id: 'cover', level: 0, title: 'Couverture', page: 1 },
  { id: 'toc',   level: 0, title: 'Table des matieres', page: 2 },

  { id: 'presentation-generale',    level: 1, title: '1. Presentation generale de l application',        page: 4 },

  { id: 'prerequis-ipad',           level: 1, title: '2. Prerequis et preparation de l iPad',            page: 5 },
  { id: 'veille-ecran',             level: 2, title: '2.1. Eviter la mise en veille de l ecran',         page: 5 },
  { id: 'dossier-fichiers',         level: 2, title: '2.2. Creer un dossier dedie dans Fichiers',        page: 5 },

  { id: 'installation-ipad',        level: 1, title: '3. Installation de l application sur l iPad',      page: 6 },
  { id: 'ouvrir-safari',            level: 2, title: '3.1. Ouvrir le lien avec Safari',                  page: 6 },
  { id: 'ajouter-ecran-accueil',    level: 2, title: '3.2. Ajouter LIM a l ecran d accueil',             page: 6 },
  { id: 'utilisation-ensuite',      level: 2, title: '3.3. Utilisation ensuite',                         page: 6 },

  { id: 'prise-main-rapide',        level: 1, title: '4. Prise en main rapide',                          page: 7 },

  { id: 'description-interface',    level: 1, title: '5. Description detaillee de l interface',          page: 8 },
  { id: 'horloge',                  level: 2, title: '5.1. Horloge',                                     page: 8 },
  { id: 'jour-nuit',                level: 2, title: '5.2. Mode jour / nuit',                            page: 8 },
  { id: 'luminosite',               level: 2, title: '5.3. Reglage de la luminosite',                    page: 8 },
  { id: 'bouton-demarrer',          level: 2, title: '5.4. Bouton Demarrer',                             page: 8 },
  { id: 'parametres',               level: 2, title: '5.5. Parametres (roue dentee)',                    page: 9 },
  { id: 'organisation-ecran',       level: 2, title: '5.6. Organisation de l ecran apres demarrage',     page: 10 },

  { id: 'utilisation-normale',      level: 1, title: '6. Utilisation normale en situation',              page: 12 },
  { id: 'preparation-document',     level: 2, title: '6.1. Preparation du document du train',            page: 12 },
  { id: 'demarrage-parcours',       level: 2, title: '6.2. Demarrage d un parcours',                     page: 12 },
  { id: 'mode-mixte',               level: 2, title: '6.2.1. Mode mixte',                                page: 13 },
  { id: 'mode-manuel',              level: 2, title: '6.2.2. Mode manuel',                               page: 13 },
  { id: 'mode-pdf-historique',      level: 2, title: '6.2.3. Mode PDF historique',                       page: 13 },
  { id: 'modif-mode-demarrage',     level: 2, title: '6.2.4. Modification du mode de demarrage',         page: 14 },
  { id: 'affichage-apres-demarrage',level: 2, title: '6.3. Affichage apres demarrage du parcours',       page: 14 },
  { id: 'zone-infos',               level: 2, title: '6.3.1. Zone Infos',                                page: 14 },
  { id: 'zone-ltv',                 level: 2, title: '6.3.2. Zone LTV',                                  page: 16 },
  { id: 'zone-ft',                  level: 2, title: '6.3.3. Zone fiche train (FT)',                     page: 17 },
  { id: 'utilisation-conduite',     level: 2, title: '6.4. Utilisation en situation (mode conduite)',    page: 18 },
  { id: 'indicateurs-etat',         level: 2, title: '6.4.1. Indicateurs d etat',                        page: 18 },
  { id: 'indicateur-gps',           level: 2, title: '6.4.1.1. Indicateur GPS',                          page: 18 },
  { id: 'indicateur-mode-horaire',  level: 2, title: '6.4.1.2. Indicateur du mode horaire',              page: 18 },
  { id: 'activation-mode-conduite', level: 2, title: '6.4.2. Activation et effets du mode conduite',     page: 19 },
  { id: 'mode-gps',                 level: 2, title: '6.4.3. Fonctionnement en mode GPS',                page: 20 },
  { id: 'mode-horaire',             level: 2, title: '6.4.4. Fonctionnement en mode horaire',            page: 20 },
  { id: 'recalage-horaire',         level: 2, title: '6.4.5. Recalage en mode horaire',                  page: 21 },

  { id: 'cas-particuliers',         level: 1, title: '7. Cas particuliers',                              page: 22 },
  { id: 'arrets-gare',              level: 2, title: '7.1. Arrets en gare',                              page: 22 },
  { id: 'mode-secours',             level: 2, title: '7.2. Mode secours',                                page: 23 },

  { id: 'mode-test',                level: 1, title: '8. Mode test',                                     page: 24 },
  { id: 'infos-test',               level: 2, title: '8.1. Informations supplementaires affichees',      page: 24 },
  { id: 'enregistrement-diag',      level: 2, title: '8.2. Enregistrement des informations de diagnostic',page: 25 },
  { id: 'export-logs',              level: 2, title: '8.3. Export des logs',                             page: 25 },

  { id: 'evolutions-prevues',       level: 1, title: '9. Evolutions prevues',                            page: 26 },
]

type Props = {
  open: boolean
  dark: boolean
  onClose: () => void
  /** Page a ouvrir (mis a jour a chaque ouverture depuis l'exterieur). */
  initialPage?: number
  initialTocId?: string
}

export default function ManualViewer({ open, dark, onClose, initialPage = 1, initialTocId = 'cover' }: Props) {
  const [page, setPage] = useState(initialPage)
  const [activeTocId, setActiveTocId] = useState(initialTocId)
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)

  // Synchroniser page/tocId quand on ouvre depuis l'exterieur
  useEffect(() => {
    if (open) {
      setPage(initialPage)
      setActiveTocId(initialTocId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPage, initialTocId])

  // Chargement blob du PDF
  useEffect(() => {
    if (!open) { setPdfObjectUrl(null); return }
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        // 1) Version gérée (mise à jour via l'éditeur) depuis lim-logs, en priorité.
        const managed = await fetchManagedDocBlobUrl('manuel')
        if (managed) {
          if (cancelled) { URL.revokeObjectURL(managed); return }
          objectUrl = managed
          setPdfObjectUrl(managed)
          return
        }
        // 2) Repli : PDF statique livré avec l'app.
        const res = await fetch(MANUAL_PDF_URL, { cache: 'no-store', headers: { Accept: 'application/pdf' } })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
        if (contentType.includes('text/html')) throw new Error('Reponse HTML inattendue')
        const blob = await res.blob()
        const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
        objectUrl = URL.createObjectURL(pdfBlob)
        if (!cancelled) setPdfObjectUrl(objectUrl)
      } catch (err) {
        console.warn('[ManualViewer] Chargement blob impossible', err)
        if (!cancelled) setPdfObjectUrl(null)
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [open])

  const pdfSrc = useMemo(() => {
    const safe = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1
    return (pdfObjectUrl ?? MANUAL_PDF_URL) + '#page=' + safe + '&toolbar=1&navpanes=0'
  }, [pdfObjectUrl, page])

  const handleTocClick = (item: TocItem) => {
    setPage(item.page)
    setActiveTocId(item.id)
    logTestEvent('ui:manual:toc-click', { source: 'manual_viewer', id: item.id, title: item.title, page: item.page })
  }

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
            <div className="text-sm font-semibold">Manuel utilisateur</div>
            <div className="text-[11px] opacity-70 truncate">Consultation integree du manuel LIM</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={() => {
                logTestEvent('ui:manual:open-external', { source: 'manual_viewer', page })
                const opened = window.open(pdfSrc, '_blank', 'noopener,noreferrer')
                if (!opened) window.location.href = pdfSrc
              }}
              className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold">
              Ouvrir a part
            </button>
            <button type="button"
              onClick={() => { logTestEvent('ui:manual:close', { source: 'manual_viewer' }); onClose() }}
              className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold">
              Fermer
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 grid gap-2" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>

          {/* Sommaire */}
          <aside className="min-h-0 rounded-xl overflow-hidden border shadow-sm flex flex-col"
            style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
            <div className="shrink-0 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <div className="text-xs font-semibold">Sommaire</div>
              <div className="text-[11px] opacity-60">Navigation dans le manuel</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
              {TOC.map(item => {
                const active = activeTocId === item.id
                const indent = item.level === 0 ? 'font-semibold' : item.level === 1 ? 'font-semibold' : 'pl-5 text-[11px] opacity-85'
                return (
                  <button key={item.id} type="button"
                    onClick={() => handleTocClick(item)}
                    title={'Page ' + item.page + ' — ' + item.title}
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

          {/* PDF */}
          <div className="min-h-0 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm">
            <ManualPdfCanvasViewer
              pdfUrl={pdfObjectUrl ?? MANUAL_PDF_URL}
              page={page}
              onPageChange={handlePageChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
