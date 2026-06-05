// src/components/LIM/Mode2026Modal.tsx
// Modale de demarrage mode 2026 : selection du train + import du PDF LTV.

import { useRef, useState } from 'react'
import type { ManualTrainOption } from './titleBarTrainUtils'
import type { NormalizedLtvFile } from './titleBarLtvUtils'
import { parseLtvPdf2026 } from '../../lib/ltvPdfParser'

type Props = {
  dark: boolean
  trainOptions: ManualTrainOption[]
  onClose: () => void
  // ftPdfFile = PDF fiche train (pour le mode SECOURS). Optionnel.
  onConfirm: (
    train: ManualTrainOption,
    ltvData: NormalizedLtvFile,
    ltvPdfFile: File,
    ftPdfFile: File | null
  ) => void
  // ----- Mode démo guidé -----
  // Si lockedTrainNumber est fourni, seul ce train est sélectionnable.
  lockedTrainNumber?: string | null
  // Si demoPdfFiles est fourni, les imports proposent un choix parmi ces PDF
  // (au lieu d’un sélecteur de fichier système).
  demoPdfFiles?: File[]
}

export default function Mode2026Modal({
  dark, trainOptions, onClose, onConfirm,
  lockedTrainNumber = null, demoPdfFiles,
}: Props) {
  const isDemo = Array.isArray(demoPdfFiles) && demoPdfFiles.length > 0

  const [selectedTrainNumber, setSelectedTrainNumber] = useState(lockedTrainNumber ?? '')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [ltvData, setLtvData] = useState<NormalizedLtvFile | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ total: number; l50: number; l66: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Etape 3 : PDF fiche train (secours) — optionnel
  const [ftPdfFile, setFtPdfFile] = useState<File | null>(null)
  const ftFileInputRef = useRef<HTMLInputElement | null>(null)

  // Sélecteurs démo (choix parmi les PDF du ZIP)
  const [ltvChooserOpen, setLtvChooserOpen] = useState(false)
  const [ftChooserOpen, setFtChooserOpen] = useState(false)

  const bg = dark ? '#18181b' : '#ffffff'
  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'

  const selectedTrain = trainOptions.find(t => t.trainNumber === selectedTrainNumber) ?? null

  const canConfirm = selectedTrain !== null && ltvData !== null && !parsing

  const handlePdfSelect = async (file: File) => {
    setPdfFile(file)
    setLtvData(null)
    setCounts(null)
    setParseError(null)
    setParsing(true)
    try {
      const data = await parseLtvPdf2026(file)
      const rows = Array.isArray(data.rows) ? data.rows : []
      const l50 = rows.filter(r => (r as any)._linea === '050').length
      const l66 = rows.filter(r => (r as any)._linea === '066').length
      setLtvData(data)
      setCounts({ total: rows.length, l50, l66 })
      if (rows.length === 0) setParseError('Aucune LTV extraite — verifiez que le PDF contient bien la LINEA 050.')
    } catch (err: any) {
      setParseError(err?.message ?? 'Erreur lors de la lecture du PDF.')
    } finally {
      setParsing(false)
    }
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm(selectedTrain!, ltvData!, pdfFile!, ftPdfFile)
  }

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(520px,94vw)] rounded-2xl border shadow-xl p-5 flex flex-col gap-4"
        style={{ backgroundColor: bg, borderColor: border, color: fg }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Mode 2026</div>
            <div className="text-[11px] opacity-60 mt-0.5">Train, PDF des LTV, et PDF fiche train (secours)</div>
          </div>
          <button type="button" onClick={onClose}
            className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold">
            Fermer
          </button>
        </div>

        {/* Etape 1 : selection du train */}
        <div>
          <div className="text-xs font-semibold opacity-70 mb-1">1 — Train</div>
          <select
            value={selectedTrainNumber}
            onChange={e => setSelectedTrainNumber(e.target.value)}
            className="w-full h-10 rounded-lg border px-3 text-sm"
            style={{
              backgroundColor: dark ? '#27272a' : '#ffffff',
              borderColor: border,
              color: fg,
              colorScheme: dark ? 'dark' : 'light',
            }}
          >
            <option value="" disabled={isDemo}>Selectionner un train…</option>
            {trainOptions.map(t => (
              <option
                key={t.trainNumber}
                value={t.trainNumber}
                disabled={isDemo && lockedTrainNumber != null && t.trainNumber !== lockedTrainNumber}
              >
                {t.trainNumber}
                {t.numeroFrance ? ` / ${t.numeroFrance}` : ''}
                {t.relation ? ` — ${t.relation}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Etape 2 : import du PDF LTV */}
        <div>
          <div className="text-xs font-semibold opacity-70 mb-1">2 — PDF tableau LTV</div>
          <button type="button"
            onClick={() => { if (isDemo) setLtvChooserOpen(o => !o); else fileInputRef.current?.click() }}
            disabled={parsing}
            className="w-full h-10 rounded-xl border text-sm font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            style={{ borderColor: border }}
          >
            {parsing ? 'Extraction en cours…' : pdfFile ? pdfFile.name : (isDemo ? 'Choisir le fichier LTV du ZIP…' : 'Choisir le PDF LTV…')}
          </button>
          {!isDemo && (
            <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handlePdfSelect(f) }} />
          )}
          {isDemo && ltvChooserOpen && (
            <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: border }}>
              {demoPdfFiles!.map(f => (
                <button key={f.name} type="button"
                  onClick={() => { setLtvChooserOpen(false); void handlePdfSelect(f) }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b last:border-b-0"
                  style={{ borderColor: border }}
                >
                  📄 {f.name}
                </button>
              ))}
            </div>
          )}

          {/* Resultat du parsing */}
          {!parsing && counts !== null && counts.total > 0 && !parseError && (
            <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium leading-relaxed">
              {counts.l50} LTV extraites depuis la LINEA 050
              <br />
              {counts.l66} LTV extraites depuis la LINEA 066
            </div>
          )}
          {!parsing && parseError && (
            <div className="mt-2 text-[11px] text-red-500">{parseError}</div>
          )}
        </div>

        {/* Etape 3 : import du PDF fiche train (secours) — optionnel */}
        <div>
          <div className="text-xs font-semibold opacity-70 mb-1">
            3 — PDF fiche train <span className="opacity-60 font-normal">(secours, optionnel)</span>
          </div>
          <button type="button"
            onClick={() => { if (isDemo) setFtChooserOpen(o => !o); else ftFileInputRef.current?.click() }}
            className="w-full h-10 rounded-xl border text-sm font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            style={{ borderColor: border }}
          >
            {ftPdfFile ? ftPdfFile.name : (isDemo ? 'Choisir la fiche train du ZIP…' : 'Choisir le PDF fiche train…')}
          </button>
          {!isDemo && (
            <input ref={ftFileInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) setFtPdfFile(f) }} />
          )}
          {isDemo && ftChooserOpen && (
            <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: border }}>
              {demoPdfFiles!.map(f => (
                <button key={f.name} type="button"
                  onClick={() => { setFtChooserOpen(false); setFtPdfFile(f) }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b last:border-b-0"
                  style={{ borderColor: border }}
                >
                  📄 {f.name}
                </button>
              ))}
            </div>
          )}
          {ftPdfFile && (
            <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Fiche train chargée — disponible en mode secours
            </div>
          )}
        </div>

        {/* Bouton Demarrer */}
        <button type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="w-full h-11 rounded-xl text-sm font-bold transition disabled:opacity-40"
          style={{
            backgroundColor: canConfirm ? '#2563eb' : (dark ? '#3f3f46' : '#e4e4e7'),
            color: canConfirm ? '#ffffff' : fg,
          }}
        >
          Demarrer en mode 2026
        </button>
      </div>
    </div>
  )
}
