import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildTestLogFile,
  startTestSession,
  stopTestSession,
  exportTestLogLocal,
  getCurrentTestExportNaming,
  logTestEvent,
} from '../../lib/testLogger'

import {
  initGpsPkEngine,
  projectGpsToPk,
  resetGpsPkEngineMemory,
  setExpectedDirectionForReplay,
} from '../../lib/gpsPkEngine'
import { RIBBON_POINTS } from '../../lib/ligne050_ribbon_dense'

import { getOcrOnlineEnabled, setOcrOnlineEnabled } from '../../lib/ocrSettings'

import { APP_VERSION } from '../version'
import {
  getTrainCategorieEspagne,
  getTrainCategorieFrance,
  getTrainComposition,
  getTrainNumeroFrance,
} from '../../data/ligneFT.normalized.adapter'

type LIMFields = {
  tren?: string
  trenPadded?: string
  type?: string
  composicion?: string
  unit?: string
}

type NumberingSide = 'ES' | 'FR'

type DisplayedTrainNumberState = {
  trainNumberEs: string | undefined
  trainNumberFr: string | undefined
  displayedSide: NumberingSide
  pendingSide: NumberingSide | null
  isBlinking: boolean
  displayedNumber: string | undefined
}
type DisplayedCompositionState = {
  normalizedComposition: string | undefined
  displayedComposition: string | undefined
  manualOverrideActive: boolean
}
function toTitleNumber(s?: string | null): string | undefined {
  if (!s) return undefined
  const m = String(s).match(/\d{1,}/)
  if (!m) return undefined
  const n = parseInt(m[0], 10)
  if (!Number.isFinite(n)) return undefined
  return String(n)
}

/**
 * TitleBar — LIMGPT α2.1 (+ keep-awake video trigger)
 */
export default function TitleBar() {
  // ----- HORLOGE -----
  const formatTime = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  const [clock, setClock] = useState(() => formatTime(new Date()))
const [autoScroll, setAutoScroll] = useState(false)
const [autoScrollStartedOnce, setAutoScrollStartedOnce] = useState(false)
const [gpsState, setGpsState] = useState<0 | 1 | 2>(0)
  const [hourlyMode, setHourlyMode] = useState(false)
  const [referenceMode, setReferenceMode] = useState<'HORAIRE' | 'GPS'>('HORAIRE')
  const [standbyMode, setStandbyMode] = useState(false)
  const [pdfMode, setPdfMode] = useState<'blue' | 'green' | 'red'>('blue')

  // ----- FT VIEW MODE (ES / FR / AUTO) -----
  // Option A : pas de persistance (ce n’est pas une préférence, c’est un état de travail)
  // Par défaut : ADIF (ES)
  const [ftViewMode, setFtViewMode] = useState<'AUTO' | 'ES' | 'FR'>('ES')
  // ✅ Indique que le mode AUTO est engagé (même après bascule vers ES/FR)
  const [autoEngaged, setAutoEngaged] = useState(false)
  // ✅ Verrou : après le 1er clic AUTO, on ne refait plus de "sélection auto" (hors Figueres)
  const autoLockedRef = useRef(false)
  const autoInitialTargetRef = useRef<'ES' | 'FR' | null>(null)

  // ----- UI fold INFOS/LTV -----
  const [folded, setFolded] = useState(false)

  // ✅ Helper unique : forcer dépliage INFOS/LTV + dispatch + logs (1 seul endroit)
  const forceInfosUnfold = (meta: { reason: string; source: string }) => {
    // On force l’état local
    setFolded(false)

    // Et on force le reste de l’app à se réaligner
    window.dispatchEvent(
      new CustomEvent('lim:infos-ltv-fold-change', {
        detail: { folded: false },
      })
    )

    // Logs rejouables
    logTestEvent('ui:infos-ltv:auto-unfold', {
      reason: meta.reason,
      source: meta.source,
    })
    logTestEvent('ui:infos-ltv:fold-change', {
      folded: false,
      source: meta.source,
      reason: meta.reason,
      forced: true,
    })
  }

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('ft:view-mode-change', { detail: { mode: ftViewMode } })
    )
  }, [ftViewMode])

  // ✅ Quand FT France (FR) est affichée : on force le dépliage (un seul endroit, clair)
  useEffect(() => {
    if (ftViewMode !== 'FR') return
    forceInfosUnfold({ reason: 'ftViewMode_FR', source: 'titlebar' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftViewMode])

  // =========================
  // AUTO resolve (pré-calage GPS post-parsing)
  // - Calculé après lim:parsed (GPS ponctuel)
  // - Ne déclenche AUCUN switch automatique ici (ça viendra au clic AUTO, étape 2)
  // =========================
  const AUTO_FR_SKM_THRESHOLD = 136.442302
  // =========================
  // Zone Figueres (à calibrer)
  // =========================
  const FIGUERES_ZONE = {
    sKmMin: 132.714904 as number | null, // 133.114904 - 0.400
    sKmMax: 133.514904 as number | null, // 133.114904 + 0.400
    stableIdxTolerance: 10,
  }

  // ✅ Source de vérité runtime pour la zone (modifiable par calibration)
  const figueresZoneMinRef = useRef<number | null>(null)
  const figueresZoneMaxRef = useRef<number | null>(null)

  // ✅ “Latch” Figueres
  const figueresArmedRef = useRef(false)
  const figueresArmedAtRef = useRef<number | null>(null)

  const FIGUERES_ARM_TTL_MS = 10 * 60 * 1000 // 10 minutes

  // ✅ ref miroir pour lire l'état GPS courant dans d'autres handlers
  const gpsStateRef = useRef<0 | 1 | 2>(0)

  // ✅ Dernier fix GPS reçu (pour logique Figueres : zone + stabilité)
  const lastGpsFixRef = useRef<{
    ts: number
    nearestIdx: number | null
    s_km: number | null
    onLine: boolean | null
  } | null>(null)

  const isFigueresArmed = () => {
    if (!figueresArmedRef.current) return false
    const t0 = figueresArmedAtRef.current
    if (typeof t0 !== 'number' || !Number.isFinite(t0)) return false

    const nowMs =
      typeof lastGpsFixRef.current?.ts === 'number' && Number.isFinite(lastGpsFixRef.current.ts)
        ? lastGpsFixRef.current.ts
        : Date.now()

    return nowMs - t0 <= FIGUERES_ARM_TTL_MS
  }

  const FIGUERES_MIN_HALF_WIDTH_KM = 0.4
  const FIGUERES_SKM_ANCHOR = 133.114904
  const FIGUERES_ANCHOR_TOL_KM = 1.0

  const isInFigueresZone = (fix: {
    nearestIdx: number | null
    s_km: number | null
  } | null): boolean => {
    if (!fix) return false
    const { s_km } = fix
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return false

    const a = figueresZoneMinRef.current ?? FIGUERES_ZONE.sKmMin
    const b = figueresZoneMaxRef.current ?? FIGUERES_ZONE.sKmMax

    if (a == null && b == null) {
      const min = FIGUERES_SKM_ANCHOR - FIGUERES_MIN_HALF_WIDTH_KM
      const max = FIGUERES_SKM_ANCHOR + FIGUERES_MIN_HALF_WIDTH_KM
      if (Math.abs(s_km - FIGUERES_SKM_ANCHOR) > FIGUERES_ANCHOR_TOL_KM) return false
      return s_km >= min && s_km <= max
    }

    const rawMin = a != null ? a : (b as number)
    const rawMax = b != null ? b : (a as number)

    const min0 = Math.min(rawMin, rawMax)
    const max0 = Math.max(rawMin, rawMax)

    const center = (min0 + max0) / 2
    const half0 = (max0 - min0) / 2
    const half = Math.max(half0, FIGUERES_MIN_HALF_WIDTH_KM)

    const min = center - half
    const max = center + half
    return s_km >= min && s_km <= max
  }

  // ✅ Calibration Figueres (debug)
  useEffect(() => {
    const doCalib = () => {
      const fix = lastGpsFixRef.current
      const gpsStateNow = gpsStateRef.current

      const payload = {
        source: 'figueres:calibration',
        tLocal: Date.now(),
        gpsState: gpsStateNow,
        tsFix: fix?.ts ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
        s_km: fix?.s_km ?? null,
        onLine: fix?.onLine ?? null,
        zoneMin: figueresZoneMinRef.current,
        zoneMax: figueresZoneMaxRef.current,
        inZone: isInFigueresZone(fix),
      }

      console.log('[Figueres][CALIB]', payload)
      logTestEvent('figueres:calib', payload)

      window.alert(
        `Figueres CALIB\n` +
          `gpsState=${gpsStateNow}\n` +
          `s_km=${payload.s_km ?? 'null'}\n` +
          `idx=${payload.nearestIdx ?? 'null'}\n` +
          `zone=[${payload.zoneMin ?? 'null'} .. ${payload.zoneMax ?? 'null'}]\n` +
          `inZone=${payload.inZone ? 'YES' : 'NO'}`
      )
    }

    const setMin = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MIN: s_km indisponible')
        return
      }
      figueresZoneMinRef.current = s
      console.log('[Figueres][CALIB] SET MIN', { s_km: s })
      logTestEvent('figueres:calib:set-min', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MIN OK\ns_km=${s}`)
    }

    const setMax = () => {
      const s = lastGpsFixRef.current?.s_km
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        window.alert('Figueres MAX: s_km indisponible')
        return
      }
      figueresZoneMaxRef.current = s
      console.log('[Figueres][CALIB] SET MAX', { s_km: s })
      logTestEvent('figueres:calib:set-max', { s_km: s, tLocal: Date.now() })
      window.alert(`Figueres MAX OK\ns_km=${s}`)
    }

    const dumpZone = () => {
      const a = figueresZoneMinRef.current
      const b = figueresZoneMaxRef.current

      console.log('[Figueres][CALIB] ZONE', {
        sKmMin: a,
        sKmMax: b,
        ready:
          typeof a === 'number' &&
          Number.isFinite(a) &&
          typeof b === 'number' &&
          Number.isFinite(b),
      })

      if (
        typeof a === 'number' &&
        Number.isFinite(a) &&
        typeof b === 'number' &&
        Number.isFinite(b)
      ) {
        const min = Math.min(a, b)
        const max = Math.max(a, b)
        window.alert(`Figueres ZONE\nsKmMin=${min}\nsKmMax=${max}`)
      } else {
        window.alert('Figueres ZONE: min/max incomplets')
      }
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'F8') {
        ev.preventDefault()
        doCalib()
        return
      }
      if (ev.key === 'F9') {
        ev.preventDefault()
        setMin()
        return
      }
      if (ev.key === 'F6') {
        ev.preventDefault()
        setMax()
        return
      }
      if (ev.key === 'F7') {
        ev.preventDefault()
        dumpZone()
        return
      }
    }

    const onRequest = () => doCalib()

    window.addEventListener('keydown', onKeyDown, { capture: true } as any)
    window.addEventListener('figueres:calib-request', onRequest as EventListener)

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
      window.removeEventListener('figueres:calib-request', onRequest as EventListener)
    }
  }, [])

  type AutoResolvedSide = 'ES' | 'FR' | null

  const [autoResolved, setAutoResolved] = useState<{
    available: boolean
    side: AutoResolvedSide
    s_km: number | null
    pk: number | null
    ts: number | null
    reason:
      | 'ok'
      | 'no_geolocation'
      | 'permission_denied'
      | 'timeout'
      | 'proj_null'
      | 'no_s_km'
      | 'engine_not_ready'
      | 'error'
      | null
  }>(() => ({
    available: false,
    side: null,
    s_km: null,
    pk: null,
    ts: null,
    reason: null,
  }))
  const autoSwitchTimerRef = useRef<number | null>(null)

  const resolveSideFromSkm = (s_km: number | null): AutoResolvedSide => {
    if (typeof s_km !== 'number' || !Number.isFinite(s_km)) return null
    return s_km < AUTO_FR_SKM_THRESHOLD ? 'ES' : 'FR'
  }

  // ----- TRAITEMENT PDF (spinner + garde-fou timeout) -----
  const [pdfProcessing, setPdfProcessing] = useState(false)
  const pdfProcessingTimerRef = useRef<number | null>(null)

  const PDF_PROCESSING_TIMEOUT_MS = 45_000

  const PDF_PROCESSING_FAIL_MESSAGE =
    "Le traitement du PDF n’a pas abouti. Réessayez ou passez en mode SECOURS (affichage PDF brut)."

  const stopPdfProcessing = () => {
    if (pdfProcessingTimerRef.current != null) {
      window.clearTimeout(pdfProcessingTimerRef.current)
      pdfProcessingTimerRef.current = null
    }
    setPdfProcessing(false)
  }

  const startPdfProcessing = () => {
    stopPdfProcessing()
    setPdfProcessing(true)

    pdfProcessingTimerRef.current = window.setTimeout(() => {
      pdfProcessingTimerRef.current = null
      setPdfProcessing(false)
      window.alert(PDF_PROCESSING_FAIL_MESSAGE)
    }, PDF_PROCESSING_TIMEOUT_MS)
  }

  const [testRecording, setTestRecording] = useState(false)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [simulationEnabled, setSimulationEnabled] = useState(false)

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('sim:enable', { detail: { enabled: simulationEnabled } })
    )
  }, [simulationEnabled])

  const [ocrOnlineEnabled, setOcrOnlineEnabledState] = useState(() =>
    getOcrOnlineEnabled()
  )

  useEffect(() => {
    setOcrOnlineEnabled(ocrOnlineEnabled)
  }, [ocrOnlineEnabled])

  const [pdfLoading, setPdfLoading] = useState(false)

  const pdfLoadingTimerRef = useRef<number | null>(null)

  const PDF_LOADING_TIMEOUT_MS = 45_000
  const PDF_LOADING_FAIL_MESSAGE =
    "Le traitement du PDF n’a pas abouti (délai dépassé). Réessayez ou passez en mode SECOURS (affichage PDF brut)."

  const stopPdfLoadingGuard = () => {
    if (pdfLoadingTimerRef.current != null) {
      window.clearTimeout(pdfLoadingTimerRef.current)
      pdfLoadingTimerRef.current = null
    }
  }

  const startPdfLoadingGuard = () => {
    stopPdfLoadingGuard()
    pdfLoadingTimerRef.current = window.setTimeout(() => {
      pdfLoadingTimerRef.current = null
      setPdfLoading(false)
      window.alert(PDF_LOADING_FAIL_MESSAGE)
    }, PDF_LOADING_TIMEOUT_MS)
  }

  const testAutoStartedRef = useRef(false)

  const [scheduleDelta, setScheduleDelta] = useState<string | null>(null)
  const [scheduleDeltaIsLarge, setScheduleDeltaIsLarge] = useState(false)
  const [scheduleDeltaSec, setScheduleDeltaSec] = useState<number | null>(null)

  // =========================
  // GPS Replay (offline) — projection pure
  // =========================
  const gpsReplayInputRef = useRef<HTMLInputElement>(null)
  const [gpsReplayBusy, setGpsReplayBusy] = useState(false)
  const [gpsReplayProgress, setGpsReplayProgress] = useState(0)

  const downloadBlobFile = (filename: string, blob: Blob): boolean => {
    if (typeof document === 'undefined') return false

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)

    try {
      a.click()
      return true
    } finally {
      a.remove()
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {}
      }, 1500)
    }
  }

  const downloadTextFile = (
    filename: string,
    content: string,
    mime = 'text/plain'
  ) => {
    const blob = new Blob([content], { type: mime })
    return downloadBlobFile(filename, blob)
  }

  type ZipEntryInput = {
    filename: string
    blob: Blob
    modifiedAt?: Date
  }

  const sanitizeArchiveEntryFilename = (name: string): string =>
    String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'fichier'

  const ZIP_CRC32_TABLE = (() => {
    const table = new Uint32Array(256)

    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      table[i] = c >>> 0
    }

    return table
  })()

  const encodeZipText = (value: string): Uint8Array => {
    return new TextEncoder().encode(value)
  }

  const concatUint8Arrays = (parts: Uint8Array[]): Uint8Array => {
    let total = 0
    for (const part of parts) total += part.length

    const out = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }

    return out
  }

  const crc32Bytes = (bytes: Uint8Array): number => {
    let crc = 0xffffffff

    for (let i = 0; i < bytes.length; i++) {
      crc = ZIP_CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    }

    return (crc ^ 0xffffffff) >>> 0
  }

  const toDosDateTime = (input?: Date) => {
    const d = input && !isNaN(input.getTime()) ? input : new Date()

    const year = Math.max(1980, d.getFullYear())
    const month = d.getMonth() + 1
    const day = d.getDate()
    const hours = d.getHours()
    const minutes = d.getMinutes()
    const seconds = Math.floor(d.getSeconds() / 2)

    const dosTime = (hours << 11) | (minutes << 5) | seconds
    const dosDate = ((year - 1980) << 9) | (month << 5) | day

    return { dosDate, dosTime }
  }

  const buildZipBlob = async (entries: ZipEntryInput[]): Promise<Blob> => {
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
      const safeName = sanitizeArchiveEntryFilename(entry.filename)
      const nameBytes = encodeZipText(safeName)
      const fileBytes = new Uint8Array(await entry.blob.arrayBuffer())
      const crc32 = crc32Bytes(fileBytes)
      const { dosDate, dosTime } = toDosDateTime(entry.modifiedAt)

      const localHeader = new Uint8Array(30 + nameBytes.length)
      const localView = new DataView(localHeader.buffer)

      localView.setUint32(0, 0x04034b50, true)
      localView.setUint16(4, 20, true)
      localView.setUint16(6, 0x0800, true)
      localView.setUint16(8, 0, true)
      localView.setUint16(10, dosTime, true)
      localView.setUint16(12, dosDate, true)
      localView.setUint32(14, crc32, true)
      localView.setUint32(18, fileBytes.length, true)
      localView.setUint32(22, fileBytes.length, true)
      localView.setUint16(26, nameBytes.length, true)
      localView.setUint16(28, 0, true)
      localHeader.set(nameBytes, 30)

      localParts.push(localHeader, fileBytes)

      const centralHeader = new Uint8Array(46 + nameBytes.length)
      const centralView = new DataView(centralHeader.buffer)

      centralView.setUint32(0, 0x02014b50, true)
      centralView.setUint16(4, 20, true)
      centralView.setUint16(6, 20, true)
      centralView.setUint16(8, 0x0800, true)
      centralView.setUint16(10, 0, true)
      centralView.setUint16(12, dosTime, true)
      centralView.setUint16(14, dosDate, true)
      centralView.setUint32(16, crc32, true)
      centralView.setUint32(20, fileBytes.length, true)
      centralView.setUint32(24, fileBytes.length, true)
      centralView.setUint16(28, nameBytes.length, true)
      centralView.setUint16(30, 0, true)
      centralView.setUint16(32, 0, true)
      centralView.setUint16(34, 0, true)
      centralView.setUint16(36, 0, true)
      centralView.setUint32(38, 0, true)
      centralView.setUint32(42, offset, true)
      centralHeader.set(nameBytes, 46)

      centralParts.push(centralHeader)

      offset += localHeader.length + fileBytes.length
    }

    const centralDirectory = concatUint8Arrays(centralParts)

    const endRecord = new Uint8Array(22)
    const endView = new DataView(endRecord.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(4, 0, true)
    endView.setUint16(6, 0, true)
    endView.setUint16(8, entries.length, true)
    endView.setUint16(10, entries.length, true)
    endView.setUint32(12, centralDirectory.length, true)
    endView.setUint32(16, offset, true)
    endView.setUint16(20, 0, true)

    const zipBytes = concatUint8Arrays([
      ...localParts,
      centralDirectory,
      endRecord,
    ])

    return new Blob([zipBytes], { type: 'application/zip' })
  }

  const exportCurrentTestBundleLocal = async (): Promise<boolean> => {
    const builtLog = buildTestLogFile()
    if (!builtLog.ok || !builtLog.blob) return false

    const pdfFile = currentPdfFileRef.current
    if (!pdfFile) {
      return exportTestLogLocal()
    }

    const naming = getCurrentTestExportNaming()
    const logFilename =
      naming?.logFilename ??
      builtLog.filename ??
      'LIM_testlog.log'

    const pdfFilename =
      naming?.pdfFilename ??
      sanitizeArchiveEntryFilename(pdfFile.name)

    const zipFilename =
      naming?.zipFilename ??
      'LIM_export_test.zip'

    const pdfModifiedAt =
      typeof pdfFile.lastModified === 'number' && Number.isFinite(pdfFile.lastModified)
        ? new Date(pdfFile.lastModified)
        : new Date()

    const zipBlob = await buildZipBlob([
      {
        filename: logFilename,
        blob: builtLog.blob,
        modifiedAt: new Date(),
      },
      {
        filename: pdfFilename,
        blob: pdfFile,
        modifiedAt: pdfModifiedAt,
      },
    ])

    try {
      const navAny = typeof navigator !== 'undefined' ? (navigator as any) : null
      const canShare = !!navAny?.share && !!navAny?.canShare

      if (canShare && typeof File !== 'undefined') {
        const zipFile = new File([zipBlob], zipFilename, {
          type: 'application/zip',
        })

        if (navAny.canShare({ files: [zipFile] })) {
          await navAny.share({
            files: [zipFile],
            title: 'LIM — export test',
            text: zipFilename,
          })
          return true
        }
      }
    } catch {
      // On ignore et on retombe sur le fallback téléchargement.
    }

    return downloadBlobFile(zipFilename, zipBlob)
  }

  const buildRibbonKml = () => {
    const esc = (s: any) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    if (!Array.isArray(RIBBON_POINTS) || RIBBON_POINTS.length === 0) {
      throw new Error('RIBBON_POINTS vide')
    }

    const first = RIBBON_POINTS[0]
    const last = RIBBON_POINTS[RIBBON_POINTS.length - 1]

    let maxLatIdx = 0
    for (let i = 1; i < RIBBON_POINTS.length; i++) {
      if (RIBBON_POINTS[i].lat > RIBBON_POINTS[maxLatIdx].lat) maxLatIdx = i
    }
    const north = RIBBON_POINTS[maxLatIdx]

    const coords = RIBBON_POINTS.map((p) => `${p.lon},${p.lat},0`).join('\n')

    const pointPlacemark = (name: string, p: any, extra: string) => `
  <Placemark>
    <name>${esc(name)}</name>
    <description>${esc(extra)}</description>
    <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
  </Placemark>`

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>LIM ribbon</name>
  <description>Export du ruban RIBBON_POINTS</description>

  <Placemark>
    <name>Ruban LAV050 (LineString)</name>
    <description>Points=${RIBBON_POINTS.length}</description>
    <Style><LineStyle><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>
${coords}
      </coordinates>
    </LineString>
  </Placemark>

  ${pointPlacemark('Start (index 0)', first, `index=0 | s_km=${first?.s_km ?? 'null'}`)}
  ${pointPlacemark('End (last index)', last, `index=${RIBBON_POINTS.length - 1} | s_km=${last?.s_km ?? 'null'}`)}
  ${pointPlacemark('Most north (max lat)', north, `index=${maxLatIdx} | s_km=${north?.s_km ?? 'null'}`)}

</Document>
</kml>`

    return kml
  }

  const runGpsReplayFromNdjson = async (file: File) => {
    try {
      setGpsReplayBusy(true)
      setGpsReplayProgress(0)

      stopGpsWatch()

      if (!gpsPkReady) {
        await initGpsPkEngine()
        setGpsPkReady(true)
      }
      resetGpsPkEngineMemory()

      const dirForEngine: 1 | -1 | null =
        expectedDir === 'DOWN' ? -1 : expectedDir === 'UP' ? 1 : null

      setExpectedDirectionForReplay(dirForEngine, {
        source: 'replay_lock',
        train: trainDisplay ?? null,
      })

      const parseTms = (t: any): number | null => {
        if (typeof t === 'number' && Number.isFinite(t)) return Math.trunc(t)
        if (typeof t === 'string' && t.trim().length > 0) {
          const parsed = Date.parse(t)
          if (Number.isFinite(parsed)) return parsed
        }
        return null
      }

      const SPEED = 60

      const text = await file.text()
      const lines = text.split(/\r?\n/)

      const points: Array<{
        tLogMs: number
        tRaw: any
        payload: any
      }> = []

      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue

        let obj: any
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }

        if (obj?.kind !== 'gps:position') continue
        const tLogMs = parseTms(obj?.t)
        if (tLogMs == null) continue

        points.push({
          tLogMs,
          tRaw: obj?.t ?? null,
          payload: obj?.payload ?? {},
        })
      }

      if (points.length === 0) {
        window.alert('Replay GPS: aucun événement kind:"gps:position" lisible dans ce fichier.')
        return
      }

      points.sort((a, b) => a.tLogMs - b.tLogMs)

      const t0Log = points[0].tLogMs
      const t0Sim = Date.now()

      const toSimMs = (tLogMs: number) => Math.trunc(t0Sim + (tLogMs - t0Log))

      const outLines: string[] = []
      outLines.push('# LIM gps replay projection')
      outLines.push(`# source=${file.name}`)
      outLines.push(`# generatedAt=${new Date().toISOString()}`)
      outLines.push('# format=one-JSON-per-line (NDJSON)')
      outLines.push('# kind=gps:replay:projection')

      let inCount = 0
      let outCount = 0

      for (let i = 0; i < points.length; i++) {
        const it = points[i]
        const p = it.payload ?? {}

        const lat = p?.lat
        const lon = p?.lon
        const accuracy = p?.accuracy

        if (typeof lat !== 'number' || typeof lon !== 'number') continue
        inCount++

        const simTs = toSimMs(it.tLogMs)

        if (i > 0) {
          const prevSimTs = toSimMs(points[i - 1].tLogMs)
          const waitMs = Math.max(0, (simTs - prevSimTs) / Math.max(0.0001, SPEED))
          if (waitMs > 0) {
            await new Promise((r) => window.setTimeout(r, waitMs))
          }
        }

        const proj = projectGpsToPk(lat, lon, { nowMs: simTs })
        const projOk = !!proj

        const pk = proj?.pk ?? null
        const s_km = proj?.s_km ?? null
        const distance_m = proj?.distance_m ?? null

        const nearestIdx = proj?.nearestIdx ?? null
        const nearestLat = proj?.nearestLat ?? null
        const nearestLon = proj?.nearestLon ?? null

        const pkCandidate = proj?.pkCandidate ?? null
        const pkDecision = proj?.pkDecision ?? null

        const dist = distance_m
        const onLine = dist != null && dist <= 200

        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat,
              lon,
              accuracy: typeof accuracy === 'number' ? accuracy : undefined,
              pk,
              s_km,
              distance_m,
              onLine,
              timestamp: simTs,
              nearestIdx,
              nearestLat,
              nearestLon,
              pkCandidate,
              pkDecision,
            },
          })
        )

        const record = {
          t: it.tRaw ?? null,
          kind: 'gps:replay:projection',
          payload: {
            lat,
            lon,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
            projOk,
            pk,
            s_km,
            distance_m,
            nearestIdx,
            nearestLat,
            nearestLon,
            pkCandidate,
            pkDecision,
          },
        }

        outLines.push(JSON.stringify(record))
        outCount++

        if (i % 20 === 0 || i === points.length - 1) {
          setGpsReplayProgress((i + 1) / points.length)
        }
      }

      outLines.push(`# stats_in=${inCount}`)
      outLines.push(`# stats_out=${outCount}`)

      downloadTextFile(
        'gps_replay_projection.ndjson',
        outLines.join('\n'),
        'application/x-ndjson'
      )

      window.alert(
        `Replay GPS terminé.\n\n` +
          `Points lus: ${inCount}\n` +
          `Points injectés/exportés: ${outCount}\n\n` +
          `Vitesse: x${SPEED}`
      )
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const stack = err?.stack ? String(err.stack) : ''

      console.warn('[TitleBar] GPS replay failed', err)
      if (stack) console.warn('[TitleBar] GPS replay stack:\n' + stack)

      const stackLine = stack.split('\n').slice(0, 2).join('\n')
      window.alert(`Replay GPS impossible: ${msg}\n\n${stackLine}`)
    } finally {
      setGpsReplayProgress(0)
      setGpsReplayBusy(false)
      if (gpsReplayInputRef.current) gpsReplayInputRef.current.value = ''
    }
  }

  const formatSignedHMS = (deltaSec: number): string => {
    const sign = deltaSec < 0 ? '-' : '+'
    const abs = Math.abs(deltaSec)
    const hh = Math.floor(abs / 3600)
    const mm = Math.floor((abs % 3600) / 60)
    const ss = abs % 60
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return hh > 0 ? `${sign}${hh}:${pad2(mm)}:${pad2(ss)}` : `${sign}${mm}:${pad2(ss)}`
  }

  // ----- GPS / PK (moteur labo) -----
  const [gpsPkReady, setGpsPkReady] = useState(false)
  const gpsWatchIdRef = useRef<number | null>(null)

  const gpsLastInfoRef = useRef<{
    lat: number
    lon: number
    accuracy?: number
    pk?: number | null
    s_km?: number | null
    dist_m?: number | null
  } | null>(null)

  const [gpsPkDisplay, setGpsPkDisplay] = useState<string | null>(null)

    const [gpsPkPeekVisible, setGpsPkPeekVisible] = useState(false)
  const gpsPkPeekTimerRef = useRef<number | null>(null)

  const showGpsPkTemporarily = () => {
    if (testModeEnabled) return
    if (gpsState !== 2) return
    if (!gpsPkDisplay) return

    setGpsPkPeekVisible(true)

    if (gpsPkPeekTimerRef.current != null) {
      window.clearTimeout(gpsPkPeekTimerRef.current)
    }

    gpsPkPeekTimerRef.current = window.setTimeout(() => {
      gpsPkPeekTimerRef.current = null
      setGpsPkPeekVisible(false)
    }, 10_000)

    logTestEvent('ui:gps-pk:temporary-show', {
      source: 'titlebar',
      pk: gpsPkDisplay,
      durationMs: 10_000,
    })
  }
  // Figueres — stabilité
  const FIGUERES_STOP_STABLE_MS = 30_000
  const figueresStableSinceRef = useRef<number | null>(null)
  const figueresStableIdxRef = useRef<number | null>(null)
  const figueresStopTriggeredRef = useRef(false)

  useEffect(() => {
    gpsStateRef.current = gpsState
  }, [gpsState])

    useEffect(() => {
    return () => {
      if (gpsPkPeekTimerRef.current != null) {
        window.clearTimeout(gpsPkPeekTimerRef.current)
        gpsPkPeekTimerRef.current = null
      }
    }
  }, [])

  // ✅ Arme Figueres quand GREEN dans zone
  useEffect(() => {
    if (gpsState !== 2) return
    const fix = lastGpsFixRef.current
    if (!fix) return

    if (
      gpsReplayBusy &&
      figueresZoneMinRef.current == null &&
      figueresZoneMaxRef.current == null &&
      typeof fix.s_km === 'number' &&
      Number.isFinite(fix.s_km)
    ) {
      const zMin = FIGUERES_ZONE.sKmMin
      const zMax = FIGUERES_ZONE.sKmMax

      const hasBounds =
        typeof zMin === 'number' &&
        Number.isFinite(zMin) &&
        typeof zMax === 'number' &&
        Number.isFinite(zMax)

      if (hasBounds) {
        const minZ = Math.min(zMin as number, zMax as number) - 1.0
        const maxZ = Math.max(zMin as number, zMax as number) + 1.0

        const plausible = fix.s_km >= minZ && fix.s_km <= maxZ

        if (plausible) {
          figueresZoneMinRef.current = fix.s_km
          figueresZoneMaxRef.current = fix.s_km

          console.log('[Figueres][REPLAY] AUTO-CALIB ZONE', { s_km: fix.s_km })
          logTestEvent('figueres:calib:auto', {
            source: 'replay_auto',
            s_km: fix.s_km,
            tLocal: Date.now(),
          })
        }
      }
    }

    figueresArmedRef.current = true

    const tArmed = typeof fix.ts === 'number' && Number.isFinite(fix.ts) ? fix.ts : Date.now()
    figueresArmedAtRef.current = tArmed

    console.log('[Figueres] ARMED (GREEN in zone)', {
      s_km: fix?.s_km ?? null,
      idx: fix?.nearestIdx ?? null,
      tLocal: tArmed,
    })
    logTestEvent('figueres:armed', {
      reason: 'green_in_zone',
      s_km: fix?.s_km ?? null,
      nearestIdx: fix?.nearestIdx ?? null,
      tLocal: figueresArmedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsState, gpsReplayBusy])

  // ✅ Arrêt Figueres => auto switch FT
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!isFigueresArmed()) {
        figueresStopTriggeredRef.current = false
        return
      }

      const fix = lastGpsFixRef.current
      if (!fix) return

      if (!isInFigueresZone(fix)) {
        figueresStopTriggeredRef.current = false
        return
      }

      const t0 = figueresStableSinceRef.current
      if (typeof t0 !== 'number' || !Number.isFinite(t0)) return

      const nowMs = gpsReplayBusy ? Date.now() : lastGpsFixRef.current?.ts ?? Date.now()
      const stableMs = nowMs - t0
      if (stableMs < FIGUERES_STOP_STABLE_MS) return

      if (figueresStopTriggeredRef.current) return
      figueresStopTriggeredRef.current = true

      const target: 'FR' | 'ES' = 'FR'

      if (!autoEngaged) {
        console.log('[Figueres][DEBUG] autoEngaged=', autoEngaged)
        logTestEvent('figueres:auto-switch:skipped', {
          reason: 'auto_not_engaged',
          target,
          stableMs,
          s_km: fix?.s_km ?? null,
          nearestIdx: fix?.nearestIdx ?? null,
        })
        return
      }

      setFtViewMode(target)
      logTestEvent('figueres:auto-switch:applied', {
        target,
        stableMs,
        s_km: fix?.s_km ?? null,
        nearestIdx: fix?.nearestIdx ?? null,
      })

      console.log('[Figueres] AUTO SWITCH FT =>', target, {
        stableMs,
        s_km: fix?.s_km ?? null,
        idx: fix?.nearestIdx ?? null,
      })
    }, 250)

    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEngaged])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lim:pdf-mode-change', { detail: { mode: pdfMode } }))
    logTestEvent('ui:pdf:mode-change', { mode: pdfMode })
  }, [pdfMode])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lim:test-mode', { detail: { enabled: testModeEnabled } }))
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lim:test-mode', { detail: { enabled: testModeEnabled } }))
    }, 400)
    return () => window.clearTimeout(t)
  }, [testModeEnabled])

  // ----- NUMÉRO DE TRAIN + TYPE + COMPOSITION -----
  const [trainDisplay, setTrainDisplay] = useState<string | undefined>(() => {
    const w = window as any
    const last: LIMFields | undefined = w.__limLastParsed
    const raw = last?.trenPadded ?? last?.tren
    return toTitleNumber(raw)
  })

  useEffect(() => {
    if (!trainDisplay) return
    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const FT_FR_WHITELIST = new Set<number>([9712, 9714, 9707, 9709, 9705, 9710])
    const isEligible = FT_FR_WHITELIST.has(n)

    if (!isEligible && ftViewMode !== 'ES') {
      setFtViewMode('ES')
      logTestEvent('ui:ftViewMode:force', {
        reason: 'train_not_eligible',
        train: trainDisplay,
        forcedMode: 'ES',
        source: 'titlebar',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

  const [trainType, setTrainType] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawTrain = last?.trenPadded ?? last?.tren
    const trainNumber = toTitleNumber(rawTrain)

    const normalizedTypeEs = trainNumber
      ? getTrainCategorieEspagne(trainNumber)
      : undefined
    const normalizedTypeFr = trainNumber
      ? getTrainCategorieFrance(trainNumber)
      : undefined

    const normalizedDisplayedType = normalizedTypeEs ?? normalizedTypeFr

    if (normalizedDisplayedType) return normalizedDisplayedType

    const rawType = last?.type
    return rawType ? String(rawType) : undefined
  })

  const [trainComposition, setTrainComposition] = useState<string | undefined>(() => {
    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawComp = last?.composicion ?? last?.unit
    return rawComp ? String(rawComp) : undefined
  })
  const [displayedCompositionState, setDisplayedCompositionState] =
    useState<DisplayedCompositionState>(() => {
      const w = window as any
      return (
        (w.__limLastDisplayedCompositionState as DisplayedCompositionState | undefined) ?? {
          normalizedComposition: undefined,
          displayedComposition: undefined,
          manualOverrideActive: false,
        }
      )
    })

  const displayedCompositionStateRef = useRef<DisplayedCompositionState>(
    displayedCompositionState
  )

  useEffect(() => {
    displayedCompositionStateRef.current = displayedCompositionState
  }, [displayedCompositionState])

  const applyDisplayedCompositionState = (
    nextState: DisplayedCompositionState,
    meta?: { source?: string; reason?: string }
  ) => {
    setDisplayedCompositionState(nextState)
    displayedCompositionStateRef.current = nextState
    setTrainComposition(nextState.displayedComposition)
    ;(window as any).__limLastDisplayedCompositionState = nextState

    window.dispatchEvent(
      new CustomEvent('lim:displayed-composition-change', {
        detail: nextState,
      })
    )

    logTestEvent('ui:displayed-composition-change', {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? 'unspecified',
      normalizedComposition: nextState.normalizedComposition ?? null,
      displayedComposition: nextState.displayedComposition ?? null,
      manualOverrideActive: nextState.manualOverrideActive,
    })
  }
  const [displayedTrainNumberState, setDisplayedTrainNumberState] =
    useState<DisplayedTrainNumberState>({
      trainNumberEs: undefined,
      trainNumberFr: undefined,
      displayedSide: 'ES',
      pendingSide: null,
      isBlinking: false,
      displayedNumber: undefined,
    })
  const applyDisplayedTrainNumberState = (
    nextState: DisplayedTrainNumberState,
    meta?: { source?: string; reason?: string }
  ) => {
    setDisplayedTrainNumberState(nextState)
    ;(window as any).__limLastDisplayedTrainNumberState = nextState

    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-change', {
        detail: nextState,
      })
    )

    logTestEvent('ui:displayed-train-number-change', {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? 'unspecified',
      trainNumberEs: nextState.trainNumberEs ?? null,
      trainNumberFr: nextState.trainNumberFr ?? null,
      displayedSide: nextState.displayedSide,
      pendingSide: nextState.pendingSide,
      isBlinking: nextState.isBlinking,
      displayedNumber: nextState.displayedNumber ?? null,
    })
  }
    const buildDisplayedTrainNumberState = (params: {
    trainNumberEs?: string
    trainNumberFr?: string
    displayedSide: NumberingSide
    pendingSide?: NumberingSide | null
    isBlinking?: boolean
  }): DisplayedTrainNumberState => {
    const trainNumberEs = params.trainNumberEs
    const trainNumberFr = params.trainNumberFr
    const displayedSide = params.displayedSide
    const pendingSide = params.pendingSide ?? null
    const isBlinking = params.isBlinking ?? false

    const visibleSide: NumberingSide =
      isBlinking && pendingSide ? pendingSide : displayedSide

    const displayedNumber =
      visibleSide === 'FR'
        ? trainNumberFr ?? trainNumberEs
        : trainNumberEs ?? trainNumberFr

    return {
      trainNumberEs,
      trainNumberFr,
      displayedSide,
      pendingSide,
      isBlinking,
      displayedNumber,
    }
  }
    const displayedTrainNumberStateRef = useRef<DisplayedTrainNumberState>(
    displayedTrainNumberState
  )

  useEffect(() => {
    displayedTrainNumberStateRef.current = displayedTrainNumberState
  }, [displayedTrainNumberState])

  useEffect(() => {
    return () => {
      if (titleBarLongPressTimerRef.current != null) {
        window.clearTimeout(titleBarLongPressTimerRef.current)
        titleBarLongPressTimerRef.current = null
      }
    }
  }, [])

  const NUMBERING_SWITCH_ANCHORS = {
    DOWN: {
      label: 'LLERS',
      triggerSkm: 138.393795 - 0.3,
      targetSide: 'ES' as NumberingSide,
    },
    UP: {
      label: 'FIGUERES-VILAFANT',
      triggerSkm: 133.765372 + 0.3,
      targetSide: 'FR' as NumberingSide,
    },
  }

  const numberingAnchorTriggeredRef = useRef(false)
  const TITLEBAR_LONG_PRESS_MS = 500
  const titleBarLongPressTimerRef = useRef<number | null>(null)
  const titleBarLongPressTriggeredRef = useRef(false)
  const titleBarPointerGestureIdRef = useRef(0)
  const titleBarLongPressGestureIdRef = useRef(0)

  const applyDisplayedTrainNumberSide = (
    displayedSide: NumberingSide,
    meta?: {
      trainNumberEs?: string
      trainNumberFr?: string
      pendingSide?: NumberingSide | null
      isBlinking?: boolean
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: meta?.trainNumberEs ?? current.trainNumberEs,
      trainNumberFr: meta?.trainNumberFr ?? current.trainNumberFr,
      displayedSide,
      pendingSide: meta?.pendingSide ?? null,
      isBlinking: meta?.isBlinking ?? false,
    })

    applyDisplayedTrainNumberState(nextState, {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? `switch_to_${displayedSide}`,
    })
  }
    const applyDisplayedTrainNumberPendingSide = (
    pendingSide: NumberingSide | null,
    meta?: {
      displayedSide?: NumberingSide
      trainNumberEs?: string
      trainNumberFr?: string
      isBlinking?: boolean
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: meta?.trainNumberEs ?? current.trainNumberEs,
      trainNumberFr: meta?.trainNumberFr ?? current.trainNumberFr,
      displayedSide: meta?.displayedSide ?? current.displayedSide,
      pendingSide,
      isBlinking: meta?.isBlinking ?? pendingSide != null,
    })

    applyDisplayedTrainNumberState(nextState, {
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? (pendingSide ? `pending_${pendingSide}` : 'pending_clear'),
    })
  }
    const armDisplayedTrainNumberPendingSide = (
    targetSide: NumberingSide,
    meta?: {
      trainNumberEs?: string
      trainNumberFr?: string
      source?: string
      reason?: string
    }
  ) => {
    const current = displayedTrainNumberStateRef.current

    const trainNumberEs = meta?.trainNumberEs ?? current.trainNumberEs
    const trainNumberFr = meta?.trainNumberFr ?? current.trainNumberFr

    if (targetSide === current.displayedSide) return

    if (current.pendingSide === targetSide && current.isBlinking) return

    const hasTargetNumber =
      targetSide === 'FR'
        ? typeof trainNumberFr === 'string' && trainNumberFr.trim() !== ''
        : typeof trainNumberEs === 'string' && trainNumberEs.trim() !== ''

    if (!hasTargetNumber) return

    applyDisplayedTrainNumberPendingSide(targetSide, {
      displayedSide: current.displayedSide,
      trainNumberEs,
      trainNumberFr,
      isBlinking: true,
      source: meta?.source ?? 'titlebar',
      reason: meta?.reason ?? `arm_pending_${targetSide}`,
    })
  }
    useEffect(() => {
    const onCommitRequest = () => {
      const current = displayedTrainNumberStateRef.current
      const pendingSide = current.pendingSide

      if (!pendingSide) return

      applyDisplayedTrainNumberSide(pendingSide, {
        trainNumberEs: current.trainNumberEs,
        trainNumberFr: current.trainNumberFr,
        pendingSide: null,
        isBlinking: false,
        source: 'infos_tren',
        reason: 'manual_commit_pending_side',
      })
    }

    const onManualToggleRequest = () => {
      const current = displayedTrainNumberStateRef.current

      const hasNumeroFrance =
        typeof current.trainNumberFr === 'string' &&
        current.trainNumberFr.trim() !== ''

      if (!hasNumeroFrance) return

      const targetSide: NumberingSide =
        current.displayedSide === 'ES' ? 'FR' : 'ES'

      armDisplayedTrainNumberPendingSide(targetSide, {
        trainNumberEs: current.trainNumberEs,
        trainNumberFr: current.trainNumberFr,
        source: 'infos_tren',
        reason: 'manual_toggle_request',
      })
    }

    const onCompositionManualToggleRequest = () => {
      const current = displayedCompositionStateRef.current

      const fallback = current.displayedComposition ?? current.normalizedComposition
      const currentValue = String(fallback ?? '').trim().toUpperCase()

      const nextComposition = currentValue === 'UM' ? 'US' : 'UM'

      applyDisplayedCompositionState(
        {
          normalizedComposition: current.normalizedComposition,
          displayedComposition: nextComposition,
          manualOverrideActive: nextComposition !== current.normalizedComposition,
        },
        {
          source: 'infos_composition',
          reason: 'manual_toggle_request',
        }
      )
    }

    window.addEventListener(
      'lim:displayed-train-number-commit-request',
      onCommitRequest as EventListener
    )
    window.addEventListener(
      'lim:displayed-train-number-manual-toggle-request',
      onManualToggleRequest as EventListener
    )
    window.addEventListener(
      'lim:displayed-composition-manual-toggle-request',
      onCompositionManualToggleRequest as EventListener
    )

    return () => {
      window.removeEventListener(
        'lim:displayed-train-number-commit-request',
        onCommitRequest as EventListener
      )
      window.removeEventListener(
        'lim:displayed-train-number-manual-toggle-request',
        onManualToggleRequest as EventListener
      )
      window.removeEventListener(
        'lim:displayed-composition-manual-toggle-request',
        onCompositionManualToggleRequest as EventListener
      )
    }
  }, [])
  useEffect(() => {
    numberingAnchorTriggeredRef.current = false

    const numeroEs = trainDisplay
    const numeroFr = numeroEs ? getTrainNumeroFrance(numeroEs) : undefined

    const numeroEsAsNumber =
      typeof numeroEs === 'string' && numeroEs.trim() !== ''
        ? Number(numeroEs)
        : NaN

    const hasNumeroFrance = typeof numeroFr === 'string' && numeroFr.trim() !== ''
    const shouldStartInFrance =
      hasNumeroFrance &&
      Number.isFinite(numeroEsAsNumber) &&
      numeroEsAsNumber % 2 === 0

    const displayedSide: NumberingSide = shouldStartInFrance ? 'FR' : 'ES'


    const nextState = buildDisplayedTrainNumberState({
      trainNumberEs: numeroEs,
      trainNumberFr: numeroFr,
      displayedSide,
      pendingSide: null,
      isBlinking: false,
    })

    console.log('[TitleBar][displayed-train-number:init]', {
      trainDisplay,
      numeroEs,
      numeroFr,
      numeroEsAsNumber,
      hasNumeroFrance,
      shouldStartInFrance,
      displayedSide,
      displayedNumber: nextState.displayedNumber,
      nextState,
    })

    applyDisplayedTrainNumberSide(displayedSide, {
      trainNumberEs: numeroEs,
      trainNumberFr: numeroFr,
      pendingSide: null,
      isBlinking: false,
      source: 'titlebar',
      reason: hasNumeroFrance ? 'initial_rule_fr_if_es_even_else_es' : 'initial_rule_es_only',
    })
  }, [trainDisplay])
  useEffect(() => {
    const currentTrainNumber = trainDisplay
    if (!currentTrainNumber) return

    const normalizedTypeEs = getTrainCategorieEspagne(currentTrainNumber)
    const normalizedTypeFr = getTrainCategorieFrance(currentTrainNumber)

    const normalizedDisplayedType =
      displayedTrainNumberState.displayedSide === 'FR'
        ? normalizedTypeFr ?? normalizedTypeEs
        : normalizedTypeEs ?? normalizedTypeFr

    if (normalizedDisplayedType) {
      setTrainType(normalizedDisplayedType)
      return
    }

    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawType = last?.type
    setTrainType(rawType ? String(rawType) : undefined)
  }, [trainDisplay, displayedTrainNumberState.displayedSide])
    useEffect(() => {
    const currentTrainNumber = trainDisplay
    if (!currentTrainNumber) return

    const normalizedComposition = getTrainComposition(currentTrainNumber)

    const w = window as any
    const last: any = w.__limLastParsed || {}
    const rawComp = last?.composicion ?? last?.unit
    const fallbackComposition = rawComp ? String(rawComp).trim().toUpperCase() : undefined

    const baseComposition = normalizedComposition ?? fallbackComposition

    applyDisplayedCompositionState(
      {
        normalizedComposition: baseComposition,
        displayedComposition: baseComposition,
        manualOverrideActive: false,
      },
      {
        source: 'titlebar',
        reason: 'train_display_reset_to_base_composition',
      }
    )
  }, [trainDisplay])
  // =========================
  // Direction attendue (PK)
  // =========================
  type ExpectedDir = 'UP' | 'DOWN'
  const [expectedDir, setExpectedDir] = useState<ExpectedDir | null>(null)
  const expectedDirRef = useRef<ExpectedDir | null>(null)
  const expectedDirLockedRef = useRef(false)
  const expectedDirSourceRef = useRef<'train_number' | 'manual' | null>(null)
  const expectedDirTrainRef = useRef<string | null>(null)

  const emitExpectedDir = (dir: ExpectedDir, meta: { source: string }) => {
    const detail = {
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      train: trainDisplay ?? null,
      locked: true,
      source: meta.source,
    }

    window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
    window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lim:expected-direction', { detail }))
      window.dispatchEvent(new CustomEvent('ft:expected-direction', { detail }))
    }, 400)
  }

  useEffect(() => {
    if (!trainDisplay) return

    const n = parseInt(trainDisplay, 10)
    if (!Number.isFinite(n)) return

    const trainChanged = expectedDirTrainRef.current !== trainDisplay
    if (!trainChanged && expectedDirLockedRef.current) return

    const dir: ExpectedDir = n % 2 === 0 ? 'DOWN' : 'UP'

    expectedDirLockedRef.current = true
    expectedDirTrainRef.current = trainDisplay
    expectedDirSourceRef.current = 'train_number'
    setExpectedDir(dir)

    logTestEvent('direction:lock', {
      source: 'train_number',
      train: trainDisplay,
      expectedDir: dir,
      pkTrend: dir === 'UP' ? 'increasing' : 'decreasing',
      trainChanged,
    })

    emitExpectedDir(dir, { source: 'train_number' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainDisplay])

  useEffect(() => {
    expectedDirRef.current = expectedDir
  }, [expectedDir])

  useEffect(() => {
    const reset = () => {
      expectedDirLockedRef.current = false
      expectedDirTrainRef.current = null
      expectedDirSourceRef.current = null
      numberingAnchorTriggeredRef.current = false
      setExpectedDir(null)
      logTestEvent('direction:reset', { source: 'clear_pdf' })
    }

    window.addEventListener('lim:clear-pdf', reset as EventListener)
    window.addEventListener('ft:clear-pdf', reset as EventListener)
    return () => {
      window.removeEventListener('lim:clear-pdf', reset as EventListener)
      window.removeEventListener('ft:clear-pdf', reset as EventListener)
    }
  }, [])

  // ----- INFOS (à afficher depuis la roue dentée) -----
  const [aboutOpen, setAboutOpen] = useState(false)
  const settingsDetailsRef = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = settingsDetailsRef.current
      if (!el) return

      const isOpen = el.hasAttribute('open')
      if (!isOpen) return

      const target = e.target as Node | null
      if (!target) return

      if (!el.contains(target)) {
        el.removeAttribute('open')
      }
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any)
    }
  }, [])

  const CHANGELOG_TEXT = `🆕 Changelog

- Fiabilisation de la localisation GPS avec nettoyage du ruban, correction des ancres et ajout de divers garde-fous.
- Ajout de la section Perpignan–Figueres dans la fiche train.
- Ajout de la gestion de la double numérotation des trains.
- Préparation de la transition de la source des données : certaines données ne reposent plus uniquement sur le PDF et sont désormais fournies par LIM Editor.
- Corrections de bugs divers.
`

  useEffect(() => {
    const handler = () => {
      setAboutOpen(true)
      if (settingsDetailsRef.current?.hasAttribute('open')) {
        settingsDetailsRef.current.removeAttribute('open')
      }
    }

    window.addEventListener('lim:about-open', handler as EventListener)
    return () => {
      window.removeEventListener('lim:about-open', handler as EventListener)
    }
  }, [])

  // ----- MISE À JOUR PWA (Service Worker) -----
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null)

  const applySwUpdate = async () => {
    try {
      if (!('serviceWorker' in navigator)) return

      const reg = swRegRef.current ?? (await navigator.serviceWorker.getRegistration())
      if (!reg?.waiting) {
        console.log('[TitleBar][SW] no waiting worker')
        return
      }

      const onCtrl = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onCtrl)
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', onCtrl)

      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      console.log('[TitleBar][SW] SKIP_WAITING sent')
    } catch (err) {
      console.warn('[TitleBar][SW] apply update failed', err)
    }
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    const markIfWaiting = (reg: ServiceWorkerRegistration | null, reason: string) => {
      if (!reg) return
      swRegRef.current = reg

      if (reg.waiting && navigator.serviceWorker.controller) {
        setSwUpdateAvailable(true)
        console.log('[TitleBar][SW] update available (waiting)', reason)
      }
    }

    const attachUpdateFound = (reg: ServiceWorkerRegistration) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return

        const onState = () => {
          if (cancelled) return
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            markIfWaiting(reg, 'updatefound:installed')
          }
        }

        nw.addEventListener('statechange', onState)
      })
    }

    const check = async (reason: string) => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (cancelled) return

        if (reg) {
          attachUpdateFound(reg)
          reg.update().catch(() => {})
          markIfWaiting(reg, reason)
        }
      } catch (err) {
        console.warn('[TitleBar][SW] check failed', err)
      }
    }

    check('boot')

    const t1 = window.setTimeout(() => check('boot+800ms'), 800)
    const t2 = window.setTimeout(() => check('boot+2500ms'), 2500)

    const onControllerChange = () => {
      setSwUpdateAvailable(false)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  useEffect(() => {
    if (testAutoStartedRef.current) return
    testAutoStartedRef.current = true

    if (!testModeEnabled) {
      setTestRecording(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Initialisation du moteur GPS→PK -----
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await initGpsPkEngine()
        if (!cancelled) {
          setGpsPkReady(true)
          console.log('[TitleBar] gpsPkEngine prêt')
        }
      } catch (err) {
        console.error('[TitleBar] Erreur init gpsPkEngine', err)
        if (!cancelled) setGpsPkReady(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime(new Date())), 1000)
    return () => clearInterval(t)
  }, [])

  // ----- HELPERS DOM -----
  const getMainEl = (): HTMLElement | null => {
    const explicit = document.querySelector('main') as HTMLElement | null
    if (explicit) return explicit
    const self = document.getElementById('lim-titlebar-root') as HTMLElement | null
    return self?.closest('main') as HTMLElement | null
  }
  const getRootEl = (): HTMLElement | null => {
    return (document.getElementById('root') ||
      document.getElementById('__next')) as HTMLElement | null
  }

  // ----- THEME Jour/Nuit -----
  const getInitialDark = () => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') return true
    if (stored === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  }
  const [dark, setDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const main = getMainEl()
    const applyTheme = (on: boolean) => {
      const m = on ? 'add' : 'remove'
      root.classList[m]('dark')
      body.classList[m]('dark')
      if (main) main.classList[m]('dark')
      root.setAttribute('data-theme', on ? 'dark' : 'light')
      body.setAttribute('data-theme', on ? 'dark' : 'light')
      if (main) main.setAttribute('data-theme', on ? 'dark' : 'light')
      try {
        localStorage.setItem('theme', on ? 'dark' : 'light')
      } catch {}
      window.dispatchEvent(new CustomEvent('lim:toggle-theme', { detail: { dark: on } }))
      window.dispatchEvent(new CustomEvent('lim:theme-change', { detail: { dark: on } }))
    }
    applyTheme(dark)
  }, [dark])

  // ----- LUMINOSITÉ -----
  const getInitialBrightness = () => {
    if (typeof window === 'undefined') return 1
    const raw = localStorage.getItem('brightness')
    if (!raw) return 1
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    const value = n > 3 ? Math.max(0.5, n / 100) : Math.max(0.5, n)
    return Math.min(1, value)
  }
  const [brightness, setBrightness] = useState<number>(getInitialBrightness)

  useEffect(() => {
    const b = `brightness(${brightness})`
    const html = document.documentElement
    const body = document.body
    const root = getRootEl()
    const main = getMainEl()
    ;[html, body, root, main].forEach((el) => {
      if (el) (el as HTMLElement).style.filter = ''
    })
    if (main) (main as HTMLElement).style.filter = b
    if (root) (root as HTMLElement).style.filter = b
    body.style.filter = b
    html.style.filter = b
    try {
      localStorage.setItem('brightness', String(brightness))
    } catch {}
    window.dispatchEvent(new CustomEvent('lim:brightness-change', { detail: { brightness } }))
    return () => {
      ;[html, body, root, main].forEach((el) => {
        if (el) (el as HTMLElement).style.filter = ''
      })
    }
  }, [brightness])

  const brightnessPct = useMemo(() => Math.round(brightness * 100), [brightness])

  // ----- IMPORT PDF -----
  const inputRef = useRef<HTMLInputElement>(null)
  const currentPdfFileRef = useRef<File | null>(null)
  const currentPdfIdRef = useRef<string | null>(null)
  const currentPdfReplayKeyRef = useRef<string | null>(null)

  const handleImportClick = () => inputRef.current?.click()

  const computePdfId = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer()
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashArr = Array.from(new Uint8Array(hashBuf))
    return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const storePdfForReplay = async (pdfId: string, file: File): Promise<string> => {
    const cache = await caches.open('limgpt-pdf-replay')
    const key = `/replay/pdf/${pdfId}`
    const req = new Request(key)
    const res = new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/pdf',
        'X-File-Name': file.name,
      },
    })
    await cache.put(req, res)
    return key
  }

  const onPickPdf: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setPdfLoading(true)
      startPdfLoadingGuard()

      let pdfId: string | null = null
      let replayKey: string | null = null
      try {
        pdfId = await computePdfId(file)
        replayKey = await storePdfForReplay(pdfId, file)
      } catch (err) {
        console.warn('[TitleBar] Impossible de préparer le PDF pour replay (local)', err)
        pdfId = null
        replayKey = null
      }

            if (!testRecording) {
        const labelParts: string[] = []
        labelParts.push('silent')
        labelParts.push('pdf_import')
        if (pdfId) labelParts.push(pdfId.slice(0, 8))

        const label = labelParts.join('_')

        startTestSession(label)
        setTestRecording(true)

        logTestEvent('testlog:silent-start', {
          source: 'pdf_import',
          label,
          pdfName: file.name,
          pdfId,
          replayKey,
          testModeEnabled,
        })
      }
      logTestEvent('import:pdf', {
        name: file.name,
        size: file.size,
        type: file.type || null,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : null,
        source: 'file-picker',
        pdfId,
        replayKey,
        storage: 'local',
      })

      currentPdfFileRef.current = file
      currentPdfIdRef.current = pdfId
      currentPdfReplayKeyRef.current = replayKey

      window.dispatchEvent(
        new CustomEvent('lim:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )
      window.dispatchEvent(
        new CustomEvent('ft:import-pdf', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )
      window.dispatchEvent(
        new CustomEvent('lim:pdf-raw', {
          detail: { file, pdfId, replayKey, storage: 'local' },
        })
      )

      setPdfMode('green')
    }

    if (inputRef.current) inputRef.current.value = ''
  }

  useEffect(() => {
    const onParsed = (e: Event) => {
      const ce = e as CustomEvent
      const detail = (ce.detail || {}) as LIMFields
      ;(window as any).__limLastParsed = detail

      logTestEvent('ui:lim:parsed', {
        train: (detail as any)?.trenPadded ?? (detail as any)?.tren ?? null,
        type: (detail as any)?.type ?? null,
        composicion: (detail as any)?.composicion ?? (detail as any)?.unit ?? null,
        source: 'titlebar:onParsed',
      })

      stopPdfLoadingGuard()
      setPdfLoading(false)

      const raw = detail.trenPadded ?? detail.tren
      const disp = toTitleNumber(raw)
      setTrainDisplay(disp)

      if (disp) {
        const n = parseInt(disp, 10)
        if (Number.isFinite(n)) {
          window.dispatchEvent(new CustomEvent('lim:train-change', { detail: { trainNumber: n } }))
        }
      }

      const parsedTrainNumber = toTitleNumber(detail.trenPadded ?? detail.tren)

      const normalizedTypeEs = parsedTrainNumber
        ? getTrainCategorieEspagne(parsedTrainNumber)
        : undefined
      const normalizedTypeFr = parsedTrainNumber
        ? getTrainCategorieFrance(parsedTrainNumber)
        : undefined

      const normalizedDisplayedType =
        displayedTrainNumberStateRef.current.displayedSide === 'FR'
          ? normalizedTypeFr ?? normalizedTypeEs
          : normalizedTypeEs ?? normalizedTypeFr

      if (normalizedDisplayedType) {
        setTrainType(normalizedDisplayedType)
      } else {
        const rawType = (detail as any).type
        setTrainType(rawType ? String(rawType) : undefined)
      }

      const normalizedComposition = parsedTrainNumber
        ? getTrainComposition(parsedTrainNumber)
        : undefined

      const parsedFallbackComposition = (() => {
        const rawComp = (detail as any).composicion ?? (detail as any).unit
        return rawComp ? String(rawComp).trim().toUpperCase() : undefined
      })()

      const baseComposition = normalizedComposition ?? parsedFallbackComposition

      applyDisplayedCompositionState(
        {
          normalizedComposition: baseComposition,
          displayedComposition: baseComposition,
          manualOverrideActive: false,
        },
        {
          source: 'titlebar',
          reason: 'parsed_reset_to_base_composition',
        }
      )

      ;(async () => {
        try {
          setAutoEngaged(false)

          setAutoResolved({
            available: false,
            side: null,
            s_km: null,
            pk: null,
            ts: Date.now(),
            reason: null,
          })

          if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            setAutoResolved((prev) => ({
              ...prev,
              available: false,
              side: null,
              reason: 'no_geolocation',
              ts: Date.now(),
            }))
            logTestEvent('ui:auto:precal:failed', { reason: 'no_geolocation', source: 'onParsed' })
            return
          }

          if (!gpsPkReady) {
            try {
              await initGpsPkEngine()
              setGpsPkReady(true)
            } catch {
              setAutoResolved((prev) => ({
                ...prev,
                available: false,
                side: null,
                reason: 'engine_not_ready',
                ts: Date.now(),
              }))
              logTestEvent('ui:auto:precal:failed', { reason: 'engine_not_ready', source: 'onParsed' })
              return
            }
          }

          const getPos = () =>
            new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                maximumAge: 10_000,
                timeout: 6_000,
              })
            })

          const pos = await getPos()
          const lat = pos.coords.latitude
          const lon = pos.coords.longitude
          const accuracy = pos.coords.accuracy

          const proj = projectGpsToPk(lat, lon)
          if (!proj) {
            setAutoResolved({
              available: false,
              side: null,
              s_km: null,
              pk: null,
              ts: Date.now(),
              reason: 'proj_null',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'proj_null',
              source: 'onParsed',
              lat,
              lon,
              accuracy,
            })
            return
          }

          const s_km =
            typeof proj.s_km === 'number' && Number.isFinite(proj.s_km) ? proj.s_km : null
          const pk = typeof proj.pk === 'number' && Number.isFinite(proj.pk) ? proj.pk : null

          const side = resolveSideFromSkm(s_km)

          if (side == null) {
            setAutoResolved({
              available: false,
              side: null,
              s_km,
              pk,
              ts: Date.now(),
              reason: 'no_s_km',
            })
            logTestEvent('ui:auto:precal:failed', {
              reason: 'no_s_km',
              source: 'onParsed',
              s_km,
              pk,
              lat,
              lon,
              accuracy,
            })
            return
          }

          setAutoResolved({
            available: true,
            side,
            s_km,
            pk,
            ts: Date.now(),
            reason: 'ok',
          })

          logTestEvent('ui:auto:precal:ok', {
            source: 'onParsed',
            side,
            s_km,
            pk,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
          })
        } catch (err: any) {
          const code = err?.code
          const isTimeout = code === 3
          const isDenied = code === 1

          const reason = isDenied ? 'permission_denied' : isTimeout ? 'timeout' : 'error'

          setAutoResolved((prev) => ({
            ...prev,
            available: false,
            side: null,
            reason,
            ts: Date.now(),
          }))

          logTestEvent('ui:auto:precal:failed', {
            reason,
            source: 'onParsed',
            code: typeof code === 'number' ? code : null,
            message: err?.message ?? String(err),
          })
        }
      })()
    }

    const onTrain = (e: Event) => {
      const ce = e as CustomEvent
      const val = (ce.detail as any)?.train as string | undefined
      const disp = toTitleNumber(val)
      if (disp) setTrainDisplay(disp)
    }

    window.addEventListener('lim:parsed', onParsed as EventListener)
    window.addEventListener('lim:train', onTrain as EventListener)
    return () => {
      window.removeEventListener('lim:parsed', onParsed as EventListener)
      window.removeEventListener('lim:train', onTrain as EventListener)
    }
  }, [gpsPkReady])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent

      console.log(
        "[TitleBar] lim:schedule-delta detail =",
        ce?.detail,
        "\n[TitleBar] origin stack =\n",
        new Error().stack
      )

      const rawText = ce?.detail?.text as string | null | undefined
      const isLarge = !!ce?.detail?.isLargeDelay

      const deltaSecRaw = ce?.detail?.deltaSec
      const deltaSec =
        typeof deltaSecRaw === 'number' && Number.isFinite(deltaSecRaw)
          ? Math.trunc(deltaSecRaw)
          : null

      const text = rawText && rawText.trim().length > 0 ? rawText.trim() : null

      logTestEvent('ui:schedule-delta', { text, isLarge })

      if (text) {
        setScheduleDelta(text)
        setScheduleDeltaIsLarge(isLarge)

        if (deltaSec !== null) {
          setScheduleDeltaSec(deltaSec)
        }

        logTestEvent('ui:schedule-delta', { text, isLarge, deltaSec })
      } else {
        setScheduleDelta(null)
        setScheduleDeltaIsLarge(false)
        setScheduleDeltaSec(null)

        logTestEvent('ui:schedule-delta', { text: null, isLarge: false, deltaSec: null })
      }
    }

    window.addEventListener('lim:schedule-delta', handler as EventListener)
    return () => {
      window.removeEventListener('lim:schedule-delta', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const enabled = !!ce?.detail?.enabled
      const standby = !!ce?.detail?.standby

setHourlyMode(enabled || standby)
setStandbyMode(standby)

setAutoScroll(enabled)

if (enabled || standby) {
  setAutoScrollStartedOnce(true)
}
    }

    window.addEventListener('lim:hourly-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:hourly-mode', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const mode = ce?.detail?.mode as 'HORAIRE' | 'GPS' | undefined
      if (mode === 'HORAIRE' || mode === 'GPS') setReferenceMode(mode)
    }

    window.addEventListener('lim:reference-mode', handler as EventListener)
    return () => {
      window.removeEventListener('lim:reference-mode', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    let redSeq = 0

    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const state = ce?.detail?.state as 'RED' | 'ORANGE' | 'GREEN' | undefined
      const pk = ce?.detail?.pk as number | null | undefined
      const pkRaw = ce?.detail?.pkRaw as number | null | undefined
      const reasonCodes = ce?.detail?.reasonCodes as any

      if (testModeEnabled && state === 'RED') {
        redSeq++
        if (redSeq % 10 === 1) {
          logTestEvent('ui:gps-state:red', {
            seq: redSeq,
            state,
            reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : null,
            pk: typeof pk === 'number' && Number.isFinite(pk) ? pk : null,
            pkRaw: typeof pkRaw === 'number' && Number.isFinite(pkRaw) ? pkRaw : null,
            tLocal: Date.now(),
          })
        }
      }

      if (state === 'RED') {
        setGpsState(0)
        setGpsPkDisplay(null)
        return
      }

      if (state === 'ORANGE') {
        setGpsState(1)
        if (typeof pkRaw === 'number' && Number.isFinite(pkRaw)) {
          setGpsPkDisplay(pkRaw.toFixed(1))
        }
        return
      }

      if (state === 'GREEN') {
        setGpsState(2)

// ✅ Au retour réel en GPS, on réaligne aussi l’état visuel du bouton Play
setAutoScrollStartedOnce(true)

        if (typeof pk === 'number' && Number.isFinite(pk)) {
          setGpsPkDisplay(pk.toFixed(1))
        } else {
          setGpsPkDisplay(null)
        }
      }
    }

    window.addEventListener('lim:gps-state', handler as EventListener)
    return () => {
      window.removeEventListener('lim:gps-state', handler as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testModeEnabled])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const d = (ce?.detail || {}) as any

      const nearestIdx =
        typeof d?.nearestIdx === 'number' && Number.isFinite(d.nearestIdx)
          ? Math.trunc(d.nearestIdx)
          : null

      const s_km =
        typeof d?.s_km === 'number' && Number.isFinite(d.s_km) ? Number(d.s_km) : null

      const onLine = typeof d?.onLine === 'boolean' ? d.onLine : null

      const ts =
        typeof d?.timestamp === 'number' && Number.isFinite(d.timestamp)
          ? Math.trunc(d.timestamp)
          : Date.now()

      const previousFix = lastGpsFixRef.current
      lastGpsFixRef.current = { ts, nearestIdx, s_km, onLine }

      const expectedDirNow = expectedDirRef.current

      if (typeof s_km === 'number' && Number.isFinite(s_km)) {
        if (s_km < 150 && s_km > 120) {
          console.log('[Numbering][GPS][DIAG]', {
            expectedDir: expectedDirNow,
            onLine,
            s_km,
            nearestIdx,
            numberingAnchorTriggered: numberingAnchorTriggeredRef.current,
          })
        }
      }

      if (
        onLine === true &&
        typeof s_km === 'number' &&
        Number.isFinite(s_km) &&
        expectedDirNow &&
        !numberingAnchorTriggeredRef.current
      ) {
        const currentNumbering = displayedTrainNumberStateRef.current
        const hasNumeroFrance =
          typeof currentNumbering.trainNumberFr === 'string' &&
          currentNumbering.trainNumberFr.trim() !== ''

        const hasNoPendingSide = currentNumbering.pendingSide == null

        if (hasNumeroFrance && hasNoPendingSide) {
          const anchor =
            expectedDirNow === 'DOWN'
              ? NUMBERING_SWITCH_ANCHORS.DOWN
              : NUMBERING_SWITCH_ANCHORS.UP

          const triggerReached =
            expectedDirNow === 'DOWN'
              ? s_km <= anchor.triggerSkm
              : s_km >= anchor.triggerSkm

          if (
            triggerReached &&
            currentNumbering.displayedSide !== anchor.targetSide
          ) {
            numberingAnchorTriggeredRef.current = true

            armDisplayedTrainNumberPendingSide(anchor.targetSide, {
              trainNumberEs: currentNumbering.trainNumberEs,
              trainNumberFr: currentNumbering.trainNumberFr,
              source: 'gps_anchor',
              reason: `anchor_${anchor.label}_arm_pending_${anchor.targetSide}`,
            })
          }
        }
      }

      const now = ts
      if (nearestIdx != null && onLine === true) {
        const prevIdx = figueresStableIdxRef.current

        if (prevIdx == null) {
          figueresStableIdxRef.current = nearestIdx
          figueresStableSinceRef.current = now
        } else {
          const tol = FIGUERES_ZONE.stableIdxTolerance
          const dIdx = Math.abs(nearestIdx - prevIdx)

          if (dIdx <= tol) {
            // stable
          } else {
            figueresStableIdxRef.current = nearestIdx
            figueresStableSinceRef.current = now
          }
        }
      } else {
        figueresStableIdxRef.current = null
        figueresStableSinceRef.current = null
      }
    }

    window.addEventListener('gps:position', handler as EventListener)
    return () => window.removeEventListener('gps:position', handler as EventListener)
  }, [])

  // ----- GPS : démarrage / arrêt du watchPosition -----
  useEffect(() => {
    return () => {
      stopGpsWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startGpsWatch() {
    if (gpsWatchIdRef.current != null) return
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[TitleBar] Geolocation non disponible')
      logTestEvent('gps:watch:start:failed', { reason: 'no_geolocation' })
      return
    }

    console.log('[TitleBar] Démarrage watchPosition GPS...')
    logTestEvent('gps:watch:start', {})

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords

        gpsLastInfoRef.current = { lat: latitude, lon: longitude, accuracy }

        if (!gpsPkReady) {
          logTestEvent('gps:position:noPkEngine', {
            lat: latitude,
            lon: longitude,
            accuracy,
          })
          return
        }

        const proj = projectGpsToPk(latitude, longitude)
        if (!proj) {
          console.log(
            `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → hors ruban (proj=null)`
          )
          logTestEvent('gps:position:offLine', { lat: latitude, lon: longitude, accuracy })
          return
        }

        const { pk, s_km, distance_m, nearestIdx, nearestLat, nearestLon, pkCandidate, pkDecision } =
          proj
        const dist = distance_m ?? null
        const onLine = dist != null && dist <= 200

        gpsLastInfoRef.current = {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          dist_m: dist,
        }

        logTestEvent('gps:position', {
          lat: latitude,
          lon: longitude,
          accuracy,
          pk: pk ?? null,
          s_km: s_km ?? null,
          distance_m: dist,
          onLine,
          nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
          nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
          nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
          pkCandidate:
            typeof pkCandidate === 'number' && Number.isFinite(pkCandidate) ? pkCandidate : null,
          pkDecision: pkDecision ?? null,
        })

        window.dispatchEvent(
          new CustomEvent('gps:position', {
            detail: {
              lat: latitude,
              lon: longitude,
              accuracy,
              pk: pk ?? null,
              s_km: s_km ?? null,
              distance_m: dist,
              onLine,
              timestamp: Date.now(),
              nearestIdx: typeof nearestIdx === 'number' ? nearestIdx : null,
              nearestLat: typeof nearestLat === 'number' ? nearestLat : null,
              nearestLon: typeof nearestLon === 'number' ? nearestLon : null,
              pkCandidate:
                typeof pkCandidate === 'number' && Number.isFinite(pkCandidate)
                  ? pkCandidate
                  : null,
              pkDecision: pkDecision ?? null,
            },
          })
        )

        console.log(
          `[GPS] lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} → PK≈${pk?.toFixed?.(
            3
          )}  s≈${s_km?.toFixed?.(3)} km  dist=${dist?.toFixed?.(1)} m  onLine=${onLine}`
        )
      },
      (err) => {
        console.error('[TitleBar] Erreur GPS', err)
        logTestEvent('gps:watch:error', {
          code: (err as any)?.code ?? null,
          message: (err as any)?.message ?? String(err),
        })
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    gpsWatchIdRef.current = id
  }

  function stopGpsWatch() {
    const id = gpsWatchIdRef.current
    if (id != null) logTestEvent('gps:watch:stop', {})

    if (id != null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(id)
    }
    gpsWatchIdRef.current = null
    gpsLastInfoRef.current = null
    console.log('[TitleBar] Arrêt watchPosition GPS')
  }

  const titleBarCommittedTrainNumber =
    displayedTrainNumberState.displayedSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        trainDisplay
      : displayedTrainNumberState.trainNumberEs ??
        displayedTrainNumberState.trainNumberFr ??
        trainDisplay

  const titleBarPendingTrainNumber =
    displayedTrainNumberState.pendingSide === 'FR'
      ? displayedTrainNumberState.trainNumberFr ??
        displayedTrainNumberState.trainNumberEs ??
        null
      : displayedTrainNumberState.pendingSide === 'ES'
        ? displayedTrainNumberState.trainNumberEs ??
          displayedTrainNumberState.trainNumberFr ??
          null
        : null

  const titleBarTrainShouldBlink = Boolean(displayedTrainNumberState.isBlinking)
  const [titleBarBlinkVisible, setTitleBarBlinkVisible] = useState(true)

  useEffect(() => {
    if (!titleBarTrainShouldBlink) {
      setTitleBarBlinkVisible(true)
      return
    }

    setTitleBarBlinkVisible(true)

    const intervalId = window.setInterval(() => {
      setTitleBarBlinkVisible((prev) => !prev)
    }, 500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [titleBarTrainShouldBlink])

  const titleSuffix = titleBarCommittedTrainNumber ?? ''

  const titlePendingSuffix =
    titleBarTrainShouldBlink && titleBarPendingTrainNumber
      ? `→ ${titleBarPendingTrainNumber}`
      : ''

  const baseTitle = `LIM${titleSuffix ? ` ${titleSuffix}` : ''}${titlePendingSuffix ? ` ${titlePendingSuffix}` : ''}`

  const extendedParts: string[] = []
  if (trainType && String(trainType).trim().length > 0) extendedParts.push(String(trainType).trim())
  if (trainComposition && String(trainComposition).trim().length > 0)
    extendedParts.push(String(trainComposition).trim())

  const fullTitle =
    folded && extendedParts.length > 0 ? `${baseTitle} - ${extendedParts.join(' - ')}` : baseTitle

const runTitleBarSingleClickAction = () => {
  const currentNumbering = displayedTrainNumberStateRef.current

  if (currentNumbering.pendingSide) {
    window.dispatchEvent(
      new CustomEvent('lim:displayed-train-number-commit-request', {
        detail: {
          pendingSide: currentNumbering.pendingSide,
          source: 'titlebar',
        },
      })
    )
    return
  }

  if (ftViewMode === 'FR') {
    logTestEvent('ui:blocked', {
      control: 'infosLtvFold',
      source: 'titlebar',
      reason: 'ftfrance_active',
    })
    return
  }

  if (simulationEnabled) {
    logTestEvent('ui:blocked', { control: 'infosLtvFold', source: 'titlebar' })
    return
  }

  const next = !folded
  setFolded(next)

  logTestEvent('ui:infos-ltv:fold-change', { folded: next, source: 'titlebar' })

  window.dispatchEvent(
    new CustomEvent('lim:infos-ltv-fold-change', {
      detail: { folded: next },
    })
  )
}

  const startTitleBarLongPress = (gestureId: number) => {
    const currentNumbering = displayedTrainNumberStateRef.current

    if (currentNumbering.pendingSide) return

    if (titleBarLongPressTimerRef.current != null) {
      window.clearTimeout(titleBarLongPressTimerRef.current)
      titleBarLongPressTimerRef.current = null
    }

    titleBarLongPressTriggeredRef.current = false

    titleBarLongPressTimerRef.current = window.setTimeout(() => {
      titleBarLongPressTimerRef.current = null

      const latestNumbering = displayedTrainNumberStateRef.current
      if (latestNumbering.pendingSide) return

      titleBarLongPressTriggeredRef.current = true
      titleBarLongPressGestureIdRef.current = gestureId

      window.dispatchEvent(
        new CustomEvent('lim:displayed-train-number-manual-toggle-request', {
          detail: {
            source: 'titlebar',
          },
        })
      )
    }, TITLEBAR_LONG_PRESS_MS)
  }

  const clearTitleBarLongPress = () => {
    if (titleBarLongPressTimerRef.current != null) {
      window.clearTimeout(titleBarLongPressTimerRef.current)
      titleBarLongPressTimerRef.current = null
    }
  }

  const handleTitlePointerDown = () => {
    const nextGestureId = titleBarPointerGestureIdRef.current + 1
    titleBarPointerGestureIdRef.current = nextGestureId
    startTitleBarLongPress(nextGestureId)
  }

  const handleTitlePointerUp = () => {
    clearTitleBarLongPress()
  }

  const handleTitlePointerLeave = () => {
    clearTitleBarLongPress()
  }

  const handleTitlePointerCancel = () => {
    clearTitleBarLongPress()
  }

  const handleTitleClick = () => {
    if (titleBarPointerGestureIdRef.current === titleBarLongPressGestureIdRef.current) {
      titleBarLongPressTriggeredRef.current = false
      return
    }

    if (titleBarLongPressTriggeredRef.current) {
      titleBarLongPressTriggeredRef.current = false
      return
    }

    runTitleBarSingleClickAction()
  }
const autoScrollButtonActive = autoScroll || autoScrollStartedOnce
  const IconSun = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <circle cx="12" cy="12" r="4" />
      <g strokeWidth="1.5" stroke="currentColor" fill="none">
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4L19 19M5 19l-1.4 1.4M20.4 3.6L19 5" />
      </g>
    </svg>
  )
  const IconMoon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="opacity-80">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
const IconFile = () => null
  return (
    <header id="lim-titlebar-root" className="surface-header rounded-2xl px-3 py-2 shadow-sm">
      {pdfLoading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div className="rounded-2xl bg-white dark:bg-zinc-900 px-5 py-4 shadow-lg border border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
            <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                opacity="0.2"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="text-sm font-semibold">Traitement du PDF…</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="tabular-nums text-[18px] leading-none font-semibold tracking-tight">
            {clock}
          </div>

          {scheduleDelta && (
            <span
              className={
                scheduleDeltaIsLarge
                  ? 'text-xs italic text-red-500 dark:text-red-400 leading-none'
                  : 'text-xs italic text-gray-500 dark:text-gray-400 leading-none'
              }
            >
              {scheduleDelta}
{testModeEnabled &&
  typeof scheduleDeltaSec === 'number' &&
  Number.isFinite(scheduleDeltaSec) && (
    <>
      {' '}
      <span
        className="opacity-90"
        style={{ color: dark ? '#e5e7eb' : '#374151' }}
      >
        {formatSignedHMS(scheduleDeltaSec)}
      </span>
    </>
  )}
            </span>
          )}

          {pdfMode === 'green' && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'autoScroll', source: 'titlebar' })
                    return
                  }

                  const next = !autoScroll

                  logTestEvent('ui:autoScroll:toggle', {
                    enabled: next,
                    source: 'titlebar',
                    standbyMode,
                  })
setAutoScroll(next)
setAutoScrollStartedOnce(next)
                  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: next, source: 'titlebar' },
                    })
                  )

                  if (!simulationEnabled) {
                    if (next) startGpsWatch()
                    else stopGpsWatch()
                  }
                }}
                className={`h-7 px-3 rounded-full flex items-center justify-center text-[11px] transition
                  ${
                    standbyMode
                      ? 'bg-orange-400 text-white animate-pulse'
: autoScrollButtonActive
  ? 'bg-emerald-500 text-white'
                        : 'bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100'
                  }
                `}
                title={
                  standbyMode
                    ? 'Standby : cliquer ici pour reprendre'
: autoScrollButtonActive
  ? 'Défilement automatique engagé'
  : 'Activer le défilement automatique'
                }
              >
{autoScrollButtonActive ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M8 5v14l10-7z" fill="currentColor" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  showGpsPkTemporarily()
                }}
                className={`
                  relative h-7 px-3 rounded-full text-xs font-semibold bg-white dark:bg-zinc-900 transition
                  ${!testModeEnabled && gpsState === 2 && gpsPkDisplay ? 'cursor-pointer' : 'cursor-default'}
                  ${gpsState === 0 ? 'border-[3px] border-red-500 text-red-600 dark:text-red-400' : ''}
                  ${gpsState === 1 ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300' : ''}
                  ${gpsState === 2 ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300' : ''}
                `}
                title={
                  gpsState === 0
                    ? 'GPS indisponible / non calé'
                    : gpsState === 1
                      ? 'GPS présent mais hors ligne de référence'
                      : !testModeEnabled && gpsPkDisplay
                        ? 'GPS OK : appuyer pour afficher temporairement le PK'
                        : 'GPS OK : position calée sur la ligne'
                }
              >
                <span className="relative z-10 tabular-nums">
                  {(testModeEnabled || gpsPkPeekVisible) && gpsState === 2 && gpsPkDisplay
                    ? `PK ${gpsPkDisplay}`
                    : 'GPS'}
                </span>
                {gpsState === 0 && (
                  <span className="pointer-events-none absolute inset-1 z-20" aria-hidden>
                    <span
                      className="absolute top-1/2 left-1 right-1 h-[2px] bg-red-500/80"
                      style={{ transform: 'rotate(-28deg)', transformOrigin: 'center' }}
                    />
                  </span>
                )}
              </button>

              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'expectedDirection', source: 'titlebar' })
                      return
                    }

                    if (!expectedDir) {
                      window.alert('Sens attendu indisponible (numéro de train manquant).')
                      return
                    }

                    const currentLabel = expectedDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'
                    const nextDir = expectedDir === 'DOWN' ? 'UP' : 'DOWN'
                    const nextLabel = nextDir === 'DOWN' ? '⬇️ PK décroissants' : '⬆️ PK croissants'

                    const ok = window.confirm(
                      `Changer le sens attendu ?\n\nActuel : ${currentLabel}\nNouveau : ${nextLabel}\n\n(Le train ne change pas de sens : utilisez ceci seulement si le numéro de train ne correspond pas au sens réel.)`
                    )
                    if (!ok) return

                    setExpectedDir(nextDir)
                    expectedDirLockedRef.current = true
                    expectedDirSourceRef.current = 'manual'

                    logTestEvent('direction:manual_override', {
                      train: trainDisplay ?? null,
                      from: expectedDir,
                      to: nextDir,
                      source: 'titlebar',
                    })

                    emitExpectedDir(nextDir, { source: 'manual_override' })
                  }}
                  className={`
                    h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition
                    ${expectedDir ? 'border-[3px] border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-100' : 'border-[3px] border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'}
                  `}
                  title={
                    expectedDir === 'DOWN'
                      ? 'Sens attendu : PK décroissants (train pair) — cliquer pour changer'
                      : expectedDir === 'UP'
                        ? 'Sens attendu : PK croissants (train impair) — cliquer pour changer'
                        : 'Sens attendu indisponible'
                  }
                  aria-label="Sens attendu PK"
                >
                  <span aria-hidden>{expectedDir === 'DOWN' ? '⬇️' : expectedDir === 'UP' ? '⬆️' : '↕️'}</span>
                </button>
              )}

              <button
                type="button"
                className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] bg-white dark:bg-zinc-900 transition cursor-default
                  ${
                    !autoScrollButtonActive
                      ? 'border-[3px] border-zinc-400 text-zinc-500 dark:border-zinc-500 dark:text-zinc-300'
                      : standbyMode
                        ? 'border-[3px] border-orange-400 text-orange-500 dark:text-orange-300'
                        : referenceMode === 'HORAIRE'
                          ? 'border-[3px] border-emerald-400 text-emerald-500 dark:text-emerald-300'
                          : 'border-[3px] border-zinc-400 text-zinc-500 dark:border-zinc-500 dark:text-zinc-300'
                  }
                `}
                title={
                  !autoScrollButtonActive
                    ? 'Mode horaire inactif : autoscroll désactivé'
                    : standbyMode
                      ? 'Mode horaire en standby'
                      : referenceMode === 'HORAIRE'
                        ? 'Mode horaire actif'
                        : 'Mode horaire disponible mais non actif'
                }
                aria-pressed={autoScrollButtonActive && referenceMode === 'HORAIRE' && hourlyMode}
              >
                <span>🕑</span>
              </button>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1 text-center">
          <button
            type="button"
            onClick={handleTitleClick}
            onPointerDown={handleTitlePointerDown}
            onPointerUp={handleTitlePointerUp}
            onPointerLeave={handleTitlePointerLeave}
            onPointerCancel={handleTitlePointerCancel}
            className="max-w-full text-[18px] leading-none font-semibold tracking-tight bg-transparent border-0 cursor-pointer"
            title={folded ? 'Afficher les blocs INFOS et LTV' : 'Afficher uniquement la zone FT'}
          >
            <span className="inline-flex max-w-full items-baseline overflow-hidden">
              <span className="shrink-0">LIM</span>

              {titleSuffix && (
                <span className="shrink-0 ml-1">
                  {titleSuffix}
                </span>
              )}

              {titlePendingSuffix && (
                <span
                  className={
                    titleBarTrainShouldBlink
                      ? 'shrink-0 whitespace-nowrap ml-1 classic-blink-text'
                      : 'shrink-0 whitespace-nowrap ml-1'
                  }
                >
                  {titlePendingSuffix}
                </span>
              )}

              {folded && extendedParts.length > 0 && (
                <span className="min-w-0 truncate">
                  {` - ${extendedParts.join(' - ')}`}
                </span>
              )}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 relative z-10">
          {swUpdateAvailable && (
            <button
              type="button"
              onClick={() => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'swUpdate', source: 'titlebar' })
                  return
                }
                logTestEvent('ui:sw:update:click', { source: 'titlebar' })
                applySwUpdate()
              }}
              className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white font-semibold flex items-center gap-2"
              title="Nouvelle version disponible — cliquer pour mettre à jour"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white/90" />
              MAJ
            </button>
          )}

          <div className="h-8 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-700 flex" title="Jour / Nuit">
            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (!dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(false)}
              aria-label="Mode jour"
            >
              <IconSun />
            </button>

            <button
              type="button"
              className={
                'h-8 w-10 flex items-center justify-center ' +
                (dark
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-900 dark:text-zinc-100 opacity-80')
              }
              onClick={() => setDark(true)}
              aria-label="Mode nuit"
            >
              <IconMoon />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] opacity-60">Lum:</span>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={brightnessPct}
              onChange={(e) => {
                const raw = Number(e.target.value)
                const clipped = Math.max(50, Math.min(100, raw))
                setBrightness(clipped / 100)
              }}
              className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-zinc-200 outline-none accent-blue-600 dark:bg-zinc-700"
            />
            <span className="w-9 tabular-nums text-[11px] text-right opacity-60">
              {brightnessPct}%
            </span>
          </div>

          {/* Importer PDF / modes */}
          <button
            type="button"
            onClick={() => {
              if (simulationEnabled) {
                logTestEvent('ui:blocked', { control: 'pdfModeButton', source: 'titlebar' })
                return
              }

              const anyRef = inputRef as any
              const currentInput = anyRef.current as HTMLInputElement | null

              if (pdfMode === 'blue') {
                handleImportClick()
                return
              }

              if (currentInput && (currentInput as any).__pdfClickTimer) {
                clearTimeout((currentInput as any).__pdfClickTimer)
                ;(currentInput as any).__pdfClickTimer = null

                if (pdfMode !== 'blue') setPdfMode('blue')

                setFtViewMode('ES')

                setTrainDisplay(undefined)
                setTrainType(undefined)
                setTrainComposition(undefined)

                currentPdfFileRef.current = null
                currentPdfIdRef.current = null
                currentPdfReplayKeyRef.current = null

                window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))

                return
              }

              if (currentInput) {
                ;(currentInput as any).__pdfClickTimer = setTimeout(() => {
                  ;(currentInput as any).__pdfClickTimer = null
                  if (pdfMode === 'green') setPdfMode('red')
                  else setPdfMode('green')
                }, 200)
              } else {
                if (pdfMode === 'green') setPdfMode('red')
                else setPdfMode('green')
              }
            }}
            className={
              pdfMode === 'blue'
                ? 'btn btn-primary h-8 px-3 text-xs flex items-center gap-1'
                : pdfMode === 'green'
                  ? 'h-8 px-3 text-xs rounded-md bg-emerald-500 text-white flex items-center gap-1'
                  : 'h-8 px-3 text-xs rounded-md bg-red-500 text-white flex items-center gap-1'
            }
          >
            {pdfMode === 'blue' && <IconFile />}
            {pdfMode === 'blue' && 'Importer PDF'}
            {pdfMode === 'green' && <span className="font-bold">NORMAL</span>}
            {pdfMode === 'red' && <span className="font-bold">SECOURS</span>}
          </button>

          {/* STOP (remplace l'ancien toggle LFP / AUTO / ADIF) */}
          {testModeEnabled && (
            <button
              type="button"
              onClick={async () => {
                if (simulationEnabled) {
                  logTestEvent('ui:blocked', { control: 'stopButton', source: 'titlebar' })
                  return
                }

                const ok = window.confirm(
                  'Arrêter le mode test ?\n\n' +
                    '(équivaut à STOP : arrêt de la session et export local des logs)'
                )
                if (!ok) return

setAutoScroll(false)
setAutoScrollStartedOnce(false)

if (autoScroll) {
  window.dispatchEvent(
                    new CustomEvent('ft:auto-scroll-change', {
                      detail: { enabled: false, source: 'titlebar_stop_button' },
                    })
                  )
                }

                stopGpsWatch()

                setScheduleDelta(null)
                setScheduleDeltaIsLarge(false)
                setScheduleDeltaSec(null)

                if (testRecording) {
                  logTestEvent('ui:test:stop', { source: 'titlebar_stop_button' })
                  stopTestSession()
                  setTestRecording(false)
                }

                try {
                  const exported = await exportCurrentTestBundleLocal()
                  if (!exported) {
                    window.alert('Aucun élément de test à exporter.')
                  }
                } catch (err: any) {
                  window.alert('Export local du paquet de test impossible.')
                }

                setPdfMode('blue')
                setPdfLoading(false)
                stopPdfLoadingGuard()

                currentPdfFileRef.current = null
                currentPdfIdRef.current = null
                currentPdfReplayKeyRef.current = null

                window.dispatchEvent(new CustomEvent('lim:clear-pdf'))
                window.dispatchEvent(new CustomEvent('ft:clear-pdf'))
                window.dispatchEvent(new CustomEvent('lim:pdf-raw', { detail: { file: null } }))

                setTestModeEnabled(false)
              }}
              className="h-8 px-3 text-xs rounded-md bg-red-600 text-white font-semibold flex items-center gap-1"
              title="Stop : arrêter le mode test et exporter les logs"
            >
              <span className="font-bold">STOP</span>
            </button>
          )}
          {/* Paramètres */}
          <details ref={settingsDetailsRef} className="relative">
            <summary
              className="list-none h-8 w-10 rounded-md bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-pointer select-none"
              title="Paramètres"
              aria-label="Paramètres"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z"
                  fill="currentColor"
                  opacity="0.18"
                />
                <path
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </summary>

            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-3 text-xs z-[9999]">
              <div className="text-[11px] font-semibold opacity-70 mb-2">Paramètres</div>

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span className="font-semibold">Mode test</span>
                <input
                  type="checkbox"
                  checked={testModeEnabled}
                  onChange={() => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'testModeToggle', source: 'settings' })
                      return
                    }

                    if (testModeEnabled) {
                      const wantDisable = window.confirm(
                        'Désactiver le mode test ?\n\n(Cela masque les fonctions de test, sans arrêter la session en cours ni décharger le PDF.)'
                      )
                      if (!wantDisable) return

                      logTestEvent('ui:test:manual-disable', {
                        source: 'settings_toggle',
                        train: trainDisplay ?? null,
                      })

                      setTestModeEnabled(false)
                      return
                    }

                    const wantEnable = window.confirm(
                      'Activer le mode test ?\n\n(Cela réaffiche les fonctions de test sans démarrer un nouvel enregistrement.)'
                    )
                    if (!wantEnable) return

                    logTestEvent('ui:test:manual-enable', {
                      source: 'settings_toggle',
                      train: trainDisplay ?? null,
                      testRecording,
                    })

                    setTestModeEnabled(true)
                  }}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
                <span>OCR online</span>
                <input
                  type="checkbox"
                  checked={ocrOnlineEnabled}
                  onChange={() => {
                    if (simulationEnabled) {
                      logTestEvent('ui:blocked', { control: 'ocrOnlineToggle', source: 'settings' })
                      return
                    }

                    const next = !ocrOnlineEnabled
                    setOcrOnlineEnabledState(next)
                    logTestEvent('settings:ocrOnline:set', { enabled: next, source: 'settings' })
                  }}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
              </label>

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />
              {!testModeEnabled && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      if (simulationEnabled) {
                        logTestEvent('ui:blocked', { control: 'exportLogs', source: 'settings' })
                        return
                      }

                      logTestEvent('testlog:manual-export:click', {
                        source: 'settings',
                        mode: 'silent',
                        train: trainDisplay ?? null,
                      })

                      try {
                        const exported = await exportCurrentTestBundleLocal()
                        if (!exported) {
                          window.alert('Aucun élément de test à exporter.')
                          logTestEvent('testlog:export:failed', {
                            reason: 'no_events',
                            source: 'settings_manual_export',
                          })
                        } else {
                          logTestEvent('testlog:exported', {
                            source: 'settings_manual_export',
                          })
                        }
                      } catch (err: any) {
                        window.alert('Export local du paquet de test impossible.')
                        logTestEvent('testlog:export:failed', {
                          reason: err?.message ?? String(err),
                          source: 'settings_manual_export',
                        })
                      }
                    }}
                    className="w-full h-8 px-3 text-xs rounded-md bg-sky-600 text-white font-semibold flex items-center justify-center"
                    title="Exporter manuellement le paquet de test de la session en cours"
                  >
                    Exporter log + PDF
                  </button>

                  <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />
                </>
              )}
              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => gpsReplayInputRef.current?.click()}
                  disabled={gpsReplayBusy}
                  className={
                    gpsReplayBusy
                      ? 'relative overflow-hidden w-full h-8 px-3 text-xs rounded-md bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100 flex items-center justify-center cursor-not-allowed'
                      : 'w-full h-8 px-3 text-xs rounded-md bg-amber-500 text-white font-semibold flex items-center justify-center'
                  }
                  title="Importer un log NDJSON et exporter la projection GPS→PK (mode test)"
                >
                  {gpsReplayBusy && (
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        width: `${Math.max(0, Math.min(100, Math.round(gpsReplayProgress * 100)))}%`,
                      }}
                    >
                      <span className="absolute inset-0 bg-amber-500/60" />
                    </span>
                  )}

                  <span className="relative z-10">
                    {gpsReplayBusy ? 'Replay GPS…' : 'Importer GPS (replay offline)'}
                  </span>
                </button>
              )}

              {testModeEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const kml = buildRibbonKml()
                      downloadTextFile(
                        'ribbon_LAV050.kml',
                        kml,
                        'application/vnd.google-earth.kml+xml'
                      )
                      window.alert('KML ruban exporté : ribbon_LAV050.kml')
                    } catch (err: any) {
                      console.warn('[TitleBar] export KML failed', err)
                      window.alert(`Export KML impossible: ${err?.message ?? String(err)}`)
                    }
                  }}
                  className="w-full h-8 px-3 text-xs rounded-md bg-indigo-600 text-white font-semibold flex items-center justify-center"
                  title="Exporter le ruban (KML) pour inspection dans Google Earth"
                >
                  Exporter KML ruban
                </button>
              )}

              <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-2" />

              <button
                type="button"
                onClick={() => {
                  if (simulationEnabled) {
                    logTestEvent('ui:blocked', { control: 'about', source: 'settings' })
                    return
                  }

                  logTestEvent('ui:about:open', { source: 'settings' })
                  setAboutOpen(true)
                }}
                className="w-full flex items-start justify-between gap-3 py-1 cursor-pointer select-none rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition px-0"
              >
                <div className="text-left">
                  <div className="font-semibold">À propos</div>
                  <div className="text-[11px] opacity-70">LIM — version & changelog</div>
                </div>
              </button>
            </div>
          </details>

          {aboutOpen && (
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
              onClick={() => setAboutOpen(false)}
            >
              <div
                className="w-[min(900px,92vw)] max-h-[85vh] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">LIM</div>
                    <div className="text-xs opacity-70 tabular-nums">Version {APP_VERSION}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAboutOpen(false)}
                    className="h-8 px-3 text-xs rounded-md bg-zinc-200/70 text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100 font-semibold"
                  >
                    Fermer
                  </button>
                </div>

                <div className="h-px bg-zinc-200/80 dark:bg-zinc-700/80 my-3" />

                <div
                  className="rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/70 p-3 text-xs whitespace-pre-wrap overflow-auto"
                  style={{ maxHeight: '65vh' }}
                >
                  {CHANGELOG_TEXT}
                </div>
              </div>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={onPickPdf}
            className="hidden"
          />

          <input
            ref={gpsReplayInputRef}
            type="file"
            accept=".log,.ndjson,application/json,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              await runGpsReplayFromNdjson(f)
            }}
            className="sr-only"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </header>
  )
}