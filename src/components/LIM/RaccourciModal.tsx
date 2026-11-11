// src/components/LIM/RaccourciModal.tsx
// 11/11 — Menu Paramètres → « Raccourci » : installer le raccourci Apple « Envoyer vers LIM »
// (partage d'un DHLTV depuis Mail → boîte aux lettres → proposé au démarrage de LIM).
//
// Deux voies, dans l'ordre recommandé :
//  1) le LIEN iCloud du raccourci (bouton principal) : un appui ouvre directement
//     Raccourcis sur « Ajouter le raccourci », sans passer par Fichiers ;
//  2) le FICHIER .shortcut livré avec l'app (second recours) : LIM tourne en app
//     installée, où iPadOS gère mal les téléchargements (fichier déposé dans Fichiers
//     sans prévenir) — d'où les instructions associées.
// Le lien iCloud change à chaque nouvel export du raccourci : il est lu dans
// public/raccourci.json (modifiable sans toucher au code). Tant qu'il est vide, le
// bouton principal est masqué et seule la voie « fichier » est proposée.

import { useEffect, useState } from 'react'

const CONFIG_URL = '/raccourci.json'

type RaccourciConfig = {
  /** Lien iCloud « Copier le lien iCloud » depuis Raccourcis (vide = non disponible). */
  icloud?: string
  /** Fichier .shortcut livré avec l'app. */
  fichier?: string
  /** Nom du raccourci tel qu'il apparaît dans la feuille de partage. */
  nom?: string
}

type Props = { open: boolean; dark: boolean; onClose: () => void }

export default function RaccourciModal({ open, dark, onClose }: Props) {
  const [cfg, setCfg] = useState<RaccourciConfig | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(CONFIG_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setCfg((j as RaccourciConfig) ?? {}) })
      .catch(() => { if (!cancelled) setCfg({}) })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const nom = cfg?.nom ?? 'Envoyer vers LIM'
  const icloud = (cfg?.icloud ?? '').trim()
  const fichier = (cfg?.fichier ?? '/envoyer-vers-lim.shortcut').trim()

  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'
  const cardBg = dark ? '#18181b' : '#ffffff'
  const bg = dark ? 'rgba(9,9,11,0.96)' : 'rgba(244,244,245,0.95)'

  const btnPrimary = 'inline-flex items-center justify-center h-11 px-4 rounded-lg bg-blue-600 text-white font-semibold text-sm'
  const btnSecondary = 'inline-flex items-center justify-center h-10 px-4 rounded-lg border font-semibold text-sm'

  return (
    <div
      className="fixed left-0 right-0 z-[9998] border-t overflow-hidden"
      style={{ top: '4rem', height: 'calc(100vh - 4rem)', maxHeight: 'calc(100dvh - 4rem)', backgroundColor: bg, borderColor: border, color: fg }}
    >
      <div className="h-full flex flex-col gap-2 p-3">
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-xl border shadow-sm px-3 py-2"
          style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Raccourci « {nom} »</div>
            <div className="text-[11px] opacity-70 truncate">Envoyer un DHLTV reçu par mail directement dans LIM</div>
          </div>
          <button type="button" onClick={onClose} className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold">
            Fermer
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border shadow-sm p-4 text-sm leading-relaxed"
          style={{ backgroundColor: cardBg, borderColor: border, color: fg }}>
          <p className="mb-3">
            Une fois le raccourci installé, le DHLTV reçu par mail se partage vers LIM en deux appuis,
            sans l'enregistrer sur l'iPad. Au lancement suivant, LIM le propose dans le menu de démarrage.
          </p>

          <h3 className="font-semibold mt-4 mb-2">1. Installer le raccourci</h3>
          {cfg == null ? (
            <p className="opacity-70">Chargement…</p>
          ) : icloud ? (
            <>
              <p className="mb-2">Appuie sur le bouton : l'app Raccourcis s'ouvre sur le raccourci. Appuie ensuite sur « Ajouter le raccourci ».</p>
              <a href={icloud} target="_blank" rel="noopener noreferrer" className={btnPrimary}>Ajouter le raccourci</a>
              <p className="mt-4 mb-2 opacity-80">Si le bouton ne donne rien, utilise le fichier :</p>
            </>
          ) : (
            <p className="mb-2">Télécharge le fichier du raccourci :</p>
          )}
          <a href={fichier} download target="_blank" rel="noopener noreferrer" className={btnSecondary} style={{ borderColor: border, color: fg }}>
            Télécharger le fichier du raccourci
          </a>
          <ol className="list-decimal pl-5 mt-2 space-y-1">
            <li>Le fichier est enregistré dans l'app Fichiers, dossier Téléchargements, parfois sans message.</li>
            <li>Ouvre Fichiers, puis Téléchargements, et appuie sur le fichier « {nom} ».</li>
            <li>Raccourcis s'ouvre : appuie sur « Ajouter le raccourci ».</li>
          </ol>

          <h3 className="font-semibold mt-5 mb-2">2. Envoyer un DHLTV</h3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Dans Mail, ouvre le message et appuie sur la pièce jointe du DHLTV (PDF ou images).</li>
            <li>Appuie sur le bouton Partager, puis sur « {nom} » dans la liste des apps.</li>
            <li>À la première utilisation, Raccourcis demande l'autorisation d'envoyer le fichier à lim2.vercel.app : choisis « Toujours autoriser ».</li>
            <li>Une notification confirme le dépôt. Ouvre LIM : le DHLTV est proposé dans le menu de démarrage.</li>
          </ol>

          <p className="mt-5 text-[12px] opacity-70">
            Le raccourci contient la clé d'accès à la boîte de dépôt de LIM. Ne le transmets qu'aux personnes qui utilisent LIM.
          </p>
        </div>
      </div>
    </div>
  )
}
