// src/components/LIM/SdmModal.tsx
// SDM — Sillon de Derniere Minute (#27).
// Modale de creation d'un train ABSENT du fichier normalise, pour la session courante
// uniquement (aucune ecriture / publication). S'ouvre par-dessus la modale de demarrage.
//
// Etape 1 (fusionnee) : numero de train (ESPAGNOL) + origine + destination.
//   -> Les dropdowns origine/destination sont ordonnes selon le SENS DE CIRCULATION,
//      determine par la PARITE du numero (pair = Perpignan->Can Tunis, impair = l'inverse).
// Etape 2 : heures de passage des gares entre origine et destination (a finaliser).
//
// Pensee iPad : cibles tactiles larges (h-12, text-base), gros boutons.

import { useEffect, useMemo, useState } from 'react'
import { getStationsInTravelOrder } from '../../data/ligneFT.normalized.adapter'

export type SdmDraftStation = { name: string; pk: string; arr: string; dep: string }
export type SdmDraft = {
  trainNumber: string
  type: string
  origine: string
  destination: string
  isPair: boolean
  // Gares origine->destination (ordre de parcours) avec heures saisies (brutes, non interpretees).
  stations: SdmDraftStation[]
}

type Props = {
  dark: boolean
  onClose: () => void
  // Valider = creer le train de session et revenir a la modale de demarrage (pre-selectionne).
  onConfirm: (draft: SdmDraft) => void
}

// Saisie "1234" -> "12:34", "234" -> "02:34". Renvoie "" si vide ou invalide (min>59 / h>23).
function toHHMM(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (!d) return ''
  const p = d.padStart(3, '0')
  const H = parseInt(p.slice(0, -2), 10)
  const M = parseInt(p.slice(-2), 10)
  if (!Number.isFinite(H) || !Number.isFinite(M) || H > 23 || M > 59) return ''
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
}

type TimeEntry = { arr: string; dep: string }

export default function SdmModal({ dark, onClose, onConfirm }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [trainNumber, setTrainNumber] = useState('')
  const [trainType, setTrainType] = useState('')
  const [origine, setOrigine] = useState('')
  const [destination, setDestination] = useState('')
  // Heures par gare (nom -> { arr, dep }). Tout optionnel. Stocke le texte en cours de saisie,
  // formate en HH:MM au blur.
  const [times, setTimes] = useState<Record<string, TimeEntry>>({})

  const setField = (name: string, field: keyof TimeEntry, val: string) =>
    setTimes(prev => ({
      ...prev,
      [name]: { arr: prev[name]?.arr ?? '', dep: prev[name]?.dep ?? '', [field]: val },
    }))

  const numValid = /^\d+$/.test(trainNumber.trim())
  const num = numValid ? parseInt(trainNumber.trim(), 10) : null
  const isPair = num != null && num % 2 === 0

  // Etablissements dans l'ordre du sens de circulation (depend de la parite).
  const stations = useMemo(
    () => (num != null ? getStationsInTravelOrder(isPair) : []),
    [num, isPair]
  )

  // Le sens change (parite) -> on reinitialise origine/destination (l'ordre s'inverse).
  useEffect(() => {
    setOrigine('')
    setDestination('')
  }, [isPair, num == null])

  const idxOri = stations.findIndex(s => s.name === origine)
  const idxDest = stations.findIndex(s => s.name === destination)
  const orderOk = idxOri >= 0 && idxDest >= 0 && idxOri < idxDest
  const canNext = numValid && orderOk

  // Gares concernees (origine -> destination inclus) = celles qui recevront une heure.
  const stationsRange = useMemo(
    () => (orderOk ? stations.slice(idxOri, idxDest + 1) : []),
    [orderOk, stations, idxOri, idxDest]
  )

  const bg = dark ? '#18181b' : '#ffffff'
  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'
  const fieldBg = dark ? '#27272a' : '#ffffff'

  const sensLabel =
    num == null ? '' : isPair ? 'Perpignan → Can Tunis (pair)' : 'Can Tunis → Perpignan (impair)'

  // Champ heure (numérique, formaté HH:MM au blur). Origine = départ seul, destination = arrivée seule.
  const timeInput = (name: string, field: keyof TimeEntry) => (
    <input
      type="text"
      inputMode="numeric"
      placeholder="––:––"
      value={times[name]?.[field] ?? ''}
      onChange={e => setField(name, field, e.target.value.replace(/\D/g, '').slice(0, 4))}
      onBlur={e => setField(name, field, toHHMM(e.target.value))}
      className="h-11 w-[4.75rem] rounded-md border px-1 text-base text-center"
      style={{ backgroundColor: fieldBg, borderColor: border, color: fg }}
    />
  )

  const handleValidate = () => {
    onConfirm({
      trainNumber: trainNumber.trim(),
      type: trainType.trim(),
      origine,
      destination,
      isPair,
      stations: stationsRange.map(s => ({
        name: s.name,
        pk: s.pk,
        arr: times[s.name]?.arr ?? '',
        dep: times[s.name]?.dep ?? '',
      })),
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(560px,94vw)] max-h-[92vh] overflow-auto rounded-2xl border shadow-xl p-5 flex flex-col gap-4"
        style={{ backgroundColor: bg, borderColor: border, color: fg }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Créer un train</div>
            <div className="text-[11px] opacity-60 mt-0.5">
              Train hors fiche — session courante uniquement · étape {step} / 2
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-10 px-4 text-sm rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold">
            Fermer
          </button>
        </div>

        {step === 1 && (
          <>
            {/* Numero de train (espagnol) */}
            <div>
              <div className="text-xs font-semibold opacity-70 mb-1">Numéro du train (numéro espagnol)</div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={trainNumber}
                onChange={e => setTrainNumber(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="ex. 9715"
                className="w-full h-12 rounded-lg border px-3 text-base"
                style={{ backgroundColor: fieldBg, borderColor: border, color: fg }}
              />
              {num != null && (
                <div className="text-[11px] opacity-70 mt-1">Sens : <span className="font-semibold">{sensLabel}</span></div>
              )}
            </div>

            {/* Type de train (optionnel) */}
            <div>
              <div className="text-xs font-semibold opacity-70 mb-1">
                Type de train <span className="opacity-60 font-normal">(optionnel)</span>
              </div>
              <input
                type="text"
                value={trainType}
                onChange={e => setTrainType(e.target.value)}
                placeholder="ex. selon le document de marche"
                className="w-full h-12 rounded-lg border px-3 text-base"
                style={{ backgroundColor: fieldBg, borderColor: border, color: fg }}
              />
            </div>

            {/* Origine */}
            <div>
              <div className="text-xs font-semibold opacity-70 mb-1">Origine</div>
              <select
                value={origine}
                onChange={e => setOrigine(e.target.value)}
                disabled={num == null}
                className="w-full h-12 rounded-lg border px-3 text-base disabled:opacity-50"
                style={{ backgroundColor: fieldBg, borderColor: border, color: fg, colorScheme: dark ? 'dark' : 'light' }}
              >
                <option value="">{num == null ? 'Entrez d’abord le numéro…' : 'Sélectionner l’origine…'}</option>
                {stations.map((s, i) => (
                  <option key={s.name} value={s.name} disabled={idxDest >= 0 && i >= idxDest}>{s.name} ({s.pk})</option>
                ))}
              </select>
            </div>

            {/* Destination */}
            <div>
              <div className="text-xs font-semibold opacity-70 mb-1">Destination</div>
              <select
                value={destination}
                onChange={e => setDestination(e.target.value)}
                disabled={num == null}
                className="w-full h-12 rounded-lg border px-3 text-base disabled:opacity-50"
                style={{ backgroundColor: fieldBg, borderColor: border, color: fg, colorScheme: dark ? 'dark' : 'light' }}
              >
                <option value="">{num == null ? 'Entrez d’abord le numéro…' : 'Sélectionner la destination…'}</option>
                {stations.map((s, i) => (
                  <option key={s.name} value={s.name} disabled={idxOri >= 0 && i <= idxOri}>{s.name} ({s.pk})</option>
                ))}
              </select>
            </div>

            <button type="button"
              onClick={() => setStep(2)}
              disabled={!canNext}
              className="w-full h-12 rounded-xl text-base font-bold transition disabled:opacity-40"
              style={{ backgroundColor: canNext ? '#2563eb' : (dark ? '#3f3f46' : '#e4e4e7'), color: canNext ? '#ffffff' : fg }}
            >
              Suivant
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="text-xs opacity-70">
              {trainNumber} · {origine} → {destination} · {stationsRange.length} gares
            </div>
            <div className="text-xs font-semibold opacity-70">
              Heures <span className="font-normal opacity-60">(toutes optionnelles — saisir p.ex. 1234 → 12:34)</span>
            </div>
            <div className="rounded-xl border" style={{ borderColor: border }}>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b text-[11px] opacity-60" style={{ borderColor: border }}>
                <span className="flex-1" />
                <span className="w-[4.75rem] text-center">Arrivée</span>
                <span className="w-[4.75rem] text-center">Départ</span>
              </div>
              <div className="divide-y" style={{ borderColor: border }}>
                {stationsRange.map((s, i) => {
                  const isOrigin = i === 0
                  const isDest = i === stationsRange.length - 1
                  return (
                    <div key={s.name} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 text-sm leading-tight">
                        {s.name} <span className="opacity-50 text-xs">({s.pk})</span>
                      </span>
                      {isOrigin
                        ? <span className="w-[4.75rem] text-center opacity-30">—</span>
                        : timeInput(s.name, 'arr')}
                      {isDest
                        ? <span className="w-[4.75rem] text-center opacity-30">—</span>
                        : timeInput(s.name, 'dep')}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="text-[11px] opacity-60 italic">
              Origine : départ seul · destination : arrivée seule · une arrivée + un départ sur une gare = arrêt (jaune). La conversion en données normalisées viendra à l’étape de génération.
            </div>

            <div className="flex gap-3">
              <button type="button"
                onClick={() => setStep(1)}
                className="h-12 px-5 rounded-xl text-base font-semibold border"
                style={{ borderColor: border, color: fg }}
              >
                Retour
              </button>
              <button type="button"
                onClick={handleValidate}
                className="flex-1 h-12 rounded-xl text-base font-bold"
                style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
              >
                Valider — créer le train
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
