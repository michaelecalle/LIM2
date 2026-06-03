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
  onConfirm: (train: ManualTrainOption, ltvData: NormalizedLtvFile, pdfFile: File) => void
}

export default function Mode2026Modal({ dark, trainOptions, onClose, onConfirm }: Props) {
  const [selectedTrainNumber, setSelectedTrainNumber] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [ltvData, setLtvData] = useState<NormalizedLtvFile | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rowCount, setRowCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const bg = dark ? '#18181b' : '#ffffff'
  const border = dark ? '#3f3f46' : '#e4e4e7'
  const fg = dark ? '#f4f4f5' : '#18181b'

  const selectedTrain = trainOptions.find(t => t.trainNumber === selectedTrainNumber) ?? null

  const canConfirm = selectedTrain !== null && ltvData !== null && !parsing

  const handlePdfSelect = async (file: File) => {
    setPdfFile(file)
    setLtvData(null)
    setRowCount(null)
    setParseError(null)
    setParsing(true)
    try {
      const data = await parseLtvPdf2026(file)
      const count = Array.isArray(data.rows) ? data.rows.length : 0
      setLtvData(data)
      setRowCount(count)
      if (count === 0) setParseError('Aucune LTV extraite — verifiez que le PDF contient bien la LINEA 050.')
    } catch (err: any) {
      setParseError(err?.message ?? 'Erreur lors de la lecture du PDF.')
    } finally {
      setParsing(false)
    }
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm(selectedTrain!, ltvData!, pdfFile!)
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
            <div className="text-[11px] opacity-60 mt-0.5">Saisissez le train puis importez le PDF des LTV</div>
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
            <option value="">Selectionner un train…</option>
            {trainOptions.map(t => (
              <option key={t.trainNumber} value={t.trainNumber}>
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
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing}
            className="w-full h-10 rounded-xl border text-sm font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            style={{ borderColor: border }}
          >
            {parsing ? 'Extraction en cours…' : pdfFile ? pdfFile.name : 'Choisir le PDF LTV…'}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handlePdfSelect(f) }} />

          {/* Resultat du parsing */}
          {!parsing && rowCount !== null && rowCount > 0 && !parseError && (
            <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              {rowCount} LTV extraites depuis la LINEA 050
            </div>
          )}
          {!parsing && parseError && (
            <div className="mt-2 text-[11px] text-red-500">{parseError}</div>
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
