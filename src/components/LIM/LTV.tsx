import React, { useEffect, useState, useRef } from "react"
import { logTestEvent } from "../../lib/testLogger"


/**
 * LTV — Tableau principal + module de recadrage NEEDS_CROP
 *
 * Fonctionnalités :
 * - Affichage texte direct (DISPLAY_DIRECT) à partir de rows[]
 * - Recadrage manuel quand mode NEEDS_CROP
 * - Zoom temporaire + auto-pan pendant drag
 * - Réinitialiser
 * - Validation du recadrage → image finale insérée visuellement dans le tableau
 * - Clic sur l'image finale → retour en édition
 * - Mode sombre : inversion de l'image finale
 * - En-têtes verticaux compatibles iPad
 * - Largeurs de colonnes alignées
 */

type LTVMode = "DISPLAY_DIRECT" | "NEEDS_CROP" | "NO_LTV"

/**
 * Une ligne LTV prête à être affichée (vient du parseur principal,
 * hérite de la logique du Standalone Tester).
 */
type LtvRow = {
  code: string
  section: string
  via: string
  kmIni: string
  kmFin: string
  speed: string
  motivo: string
  fecha1: string
  hora1: string
  fecha2: string
  hora2: string
  viaCheck: boolean
  sistema: boolean
  soloCabeza: boolean
  csv: boolean
  observaciones: string
}

type LTVEventDetail = {
  mode?: LTVMode
  previewImageDataUrl?: string
  altPreviewImageDataUrl?: string
  rows?: LtvRow[]
  nativeImages?: {
    width: number
    height: number
    dataUrl: string
  }[]
  debugBands?: {
    dataUrl: string
    topPct: number
    bottomPct: number
    chosen: boolean
  }[]
  meta?: {
    fetchedAt?: string
    displayedCount?: number
    total?: number
    source?: string
  }
  fetchedAt?: string
  displayedCount?: number
}

type LtvDisplayMeta = {
  fetchedAt?: string
  displayedCount?: number
}

function formatLtvFetchedAt(value?: string): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const months = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ]

  const day = String(date.getDate()).padStart(2, "0")
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")

  return `${day} ${month} ${year} à ${hour}:${minute}`
}

function isLtvFetchedAtOlderThanTwoHours(value?: string): boolean {
  if (!value) return false

  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false

  const ageMs = Date.now() - time
  return ageMs > 2 * 60 * 60 * 1000
}

const LTV: React.FC = () => {
  // --- état venant du parseur LTV (ltvParser.ts)
  const [ltvMode, setLtvMode] = useState<LTVMode | "">("")

    // ✅ Mode simulation (replay) : LTV suit l'état global via sim:enable
  const [simulationEnabled, setSimulationEnabled] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent
      const enabled = !!ce?.detail?.enabled
      setSimulationEnabled(enabled)
    }

    window.addEventListener("sim:enable", handler as EventListener)
    return () => {
      window.removeEventListener("sim:enable", handler as EventListener)
    }
  }, [])


  // Deux candidates "historiques" envoyées par le parseur en mode DISPLAY_DIRECT
  const [previewImage, setPreviewImage] = useState<string | undefined>(
    undefined
  )
  const [altPreviewImage, setAltPreviewImage] = useState<string | undefined>(
    undefined
  )

  // Quelle candidate est sélectionnée actuellement pour DISPLAY_DIRECT
  // "main" = previewImageDataUrl, "alt" = altPreviewImageDataUrl
  const [selectedImage, setSelectedImage] = useState<"main" | "alt">("main")

  // 🔢 Nouvelle API : liste d'images candidates (toutes les bitmaps utiles côté PDF)
  const [candidateImages, setCandidateImages] = useState<string[]>([])
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  // Indices des images candidates sélectionnées (dans l'ordre de sélection)
  const [selectedImageIndices, setSelectedImageIndices] = useState<number[]>([])

  // Position verticale de la bande dans la page (0.0–1.0) pour le recadrage manuel
  const [bandTopPct, setBandTopPct] = useState<number | null>(null)

  // Une fois validé par l'utilisateur → plus de bascule possible
  const [lockedDisplayDirect, setLockedDisplayDirect] =
    useState<boolean>(false)

  // lignes LTV structurées pour DISPLAY_DIRECT
  const [rows, setRows] = useState<LtvRow[]>([])

  // Métadonnées d’actualisation LTV envoyées par l’import manuel
  const [ltvDisplayMeta, setLtvDisplayMeta] = useState<LtvDisplayMeta>({})

  // Bande horizontale de la page complète (issue de debugBands)
  // utilisée comme base pour le recadrage manuel déclenché depuis DISPLAY_DIRECT.
  const [pageBandImage, setPageBandImage] = useState<string | null>(null)

  // --- refs
  const previewImgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // true = on édite encore (bandes rouges visibles)
  // false = recadrage validé, on montre juste le résultat final propre
  const [isCropping, setIsCropping] = useState<boolean>(true)

  // dataURL PNG finale après validation
  // Sert pour :
  //  - le résultat du recadrage manuel (NEEDS_CROP)
  //  - l'image choisie en DISPLAY_DIRECT (sans recadrage)
  const [finalCroppedUrl, setFinalCroppedUrl] = useState<string | null>(null)

  // Cadre de recadrage en pourcentages (par rapport à l'image affichée)
  const [cropBox, setCropBox] = useState({
    top: 20,
    bottom: 80,
    left: 10,
    right: 90,
  })

  // quelle barre rouge est en train d'être déplacée
  const [draggingEdge, setDraggingEdge] = useState<
    null | "top" | "bottom" | "left" | "right"
  >(null)

  // zoom visuel pendant l'édition
  const [zoom, setZoom] = useState(1)

  // translation (pan) pendant le zoom
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)

  // point d'ancrage du début du drag (en px écran)
  const [anchorX, setAnchorX] = useState<number | null>(null)
  const [anchorY, setAnchorY] = useState<number | null>(null)

  // Quand le parseur envoie un nouveau PDF : reset / chargement
  useEffect(() => {
    const onLtvParsed = (e: Event) => {
      const ce = e as CustomEvent<LTVEventDetail>

      // log debug pour analyse
      console.log("[LTV] ltv:parsed RAW detail =", ce.detail)

      const mode = ce.detail?.mode
      const imgMain = (ce.detail as any)?.previewImageDataUrl
      const imgAlt = (ce.detail as any)?.altPreviewImageDataUrl
      const incomingRows = ce.detail?.rows ?? []

      const detailAny = (ce.detail ?? {}) as any
      const incomingMeta = (detailAny.meta ?? {}) as any

      const displayedCountRaw =
        incomingMeta.displayedCount ?? detailAny.displayedCount

      const fetchedAtRaw =
        incomingMeta.fetchedAt ?? detailAny.fetchedAt

      const displayedCount =
        typeof displayedCountRaw === "number" && Number.isFinite(displayedCountRaw)
          ? displayedCountRaw
          : undefined

      const fetchedAt =
        typeof fetchedAtRaw === "string" && fetchedAtRaw.trim().length > 0
          ? fetchedAtRaw
          : undefined

      console.log("[LTV] ltv:parsed reçu =", {
        mode,
        imgMainLen: imgMain?.length,
        imgAltLen: imgAlt?.length,
        rows: incomingRows,
        meta: {
          displayedCount,
          fetchedAt,
        },
      })

      // Images natives (bande LTV auto, etc.)
      const nativeImages = (ce.detail as any)?.nativeImages as
        | { width: number; height: number; dataUrl: string }[]
        | undefined

      if (nativeImages && nativeImages.length > 0) {
        console.log("[LTV] nativeImages reçues =", nativeImages.length)
        setCandidateImages(nativeImages.map((img) => img.dataUrl))
        setSelectedImageIndex(0)
      } else {
        setCandidateImages([])
        setSelectedImageIndex(0)
      }

      // Bandes de debug (bande horizontale de la page complète)
      const debugBands = (ce.detail as any)?.debugBands as
        | {
            dataUrl: string
            topPct: number
            bottomPct: number
            chosen: boolean
          }[]
        | undefined

      let bestBandUrl: string | null = null
      if (debugBands && debugBands.length > 0) {
        const chosenBand = debugBands.find(
          (b) => b.chosen && b.dataUrl && b.dataUrl.length > 0
        )
        bestBandUrl =
          chosenBand?.dataUrl ||
          debugBands.find((b) => b.dataUrl && b.dataUrl.length > 0)?.dataUrl ||
          null
      }
      setPageBandImage(bestBandUrl ?? null)

      if (mode) setLtvMode(mode)
      setRows(incomingRows)
      setLtvDisplayMeta({
        displayedCount,
        fetchedAt,
      })

      // --- DISPLAY_DIRECT : images candidates directement exploitables ---
      if (mode === "DISPLAY_DIRECT" && imgMain) {
        console.log("[LTV] init DISPLAY_DIRECT")

        setPreviewImage(imgMain || undefined)
        setAltPreviewImage(imgAlt || undefined)

        // 🔢 On récupère toutes les images natives envoyées par le parseur (si dispo)
        const nativeImagesInner =
          ((ce.detail as any)?.nativeImages ?? []) as {
            width: number
            height: number
            dataUrl: string
          }[]

        const images = nativeImagesInner.map((img) => img.dataUrl)
        setCandidateImages(images)
        setSelectedImageIndex(0)
        setSelectedImageIndices([])

        console.log("[LTV] DISPLAY_DIRECT nativeImages reçues =", {
          total: nativeImagesInner.length,
          imagesCount: images.length,
        })

        // par défaut on affiche la principale (comportement inchangé)
        setSelectedImage("main")
        setFinalCroppedUrl(imgMain || null)

        // tant que l'utilisateur n'a pas validé manuellement :
        setLockedDisplayDirect(false)

        // pas de recadrage manuel dans ce mode
        setIsCropping(false)

        // reset visu
        setZoom(1)
        setPanX(0)
        setPanY(0)
        setDraggingEdge(null)
        setAnchorX(null)
        setAnchorY(null)
        setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
        return
      }

      // --- NEEDS_CROP : recadrage manuel ---
      if (mode === "NEEDS_CROP") {
        console.log("[LTV] init NEEDS_CROP")

        // même si imgMain est vide par erreur, on force le mode
        setPreviewImage(imgMain || undefined)
        setAltPreviewImage(undefined)
        setSelectedImage("main")
        setLockedDisplayDirect(false)

        setIsCropping(true)
        setFinalCroppedUrl(null)

        setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
        setZoom(1)
        setPanX(0)
        setPanY(0)
        setDraggingEdge(null)
        setAnchorX(null)
        setAnchorY(null)

        setCandidateImages([])
        setSelectedImageIndex(0)
        setSelectedImageIndices([])

        return
      }

      // --- NO_LTV / fallback ---
      console.log("[LTV] init NO_LTV / fallback")

      setPreviewImage(undefined)
      setAltPreviewImage(undefined)
      setSelectedImage("main")
      setLockedDisplayDirect(false)

      setIsCropping(true)
      setFinalCroppedUrl(null)
      setZoom(1)
      setPanX(0)
      setPanY(0)
      setDraggingEdge(null)
      setAnchorX(null)
      setAnchorY(null)
      setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })

      setCandidateImages([])
      setSelectedImageIndex(0)
      setSelectedImageIndices([])
      setPageBandImage(null)
    }

    window.addEventListener("ltv:parsed", onLtvParsed as EventListener)
    return () => {
      window.removeEventListener("ltv:parsed", onLtvParsed as EventListener)
    }
  }, [])

  // Mise à jour de la bande quand le parseur renvoie une nouvelle zone (ltv:band-update)
  useEffect(() => {
    const onBandUpdate = (e: Event) => {
      const ce = e as CustomEvent<{
        dataUrl?: string
        topPct?: number
        bottomPct?: number
      }>

      const url = ce.detail?.dataUrl
      if (!url) return

      console.log("[LTV] ltv:band-update reçu", ce.detail)

      // On n'exploite ces bandes que dans le recadrage manuel
      if (ltvMode !== "NEEDS_CROP") return

      // On remplace simplement l'image de base, on garde le cadre en %.
      setPreviewImage(url)
      setFinalCroppedUrl(null)
      setIsCropping(true)

      if (typeof ce.detail?.topPct === "number") {
        // topPct arrive en pourcentage 0–100, on le stocke en 0.0–1.0
        setBandTopPct(ce.detail.topPct / 100)
      }
    }

    window.addEventListener("ltv:band-update", onBandUpdate as EventListener)
    return () => {
      window.removeEventListener(
        "ltv:band-update",
        onBandUpdate as EventListener
      )
    }
  }, [ltvMode])
  // ✅ Signale que la hauteur LTV a probablement changé et que le layout peut être re-mesuré
  useEffect(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("ltv:layout-stable", {
            detail: {
              mode: ltvMode || null,
              rowsCount: rows.length,
              hasPreviewImage: !!previewImage,
              hasFinalCropped: !!finalCroppedUrl,
              isCropping,
            },
          })
        )
      }, 0)

      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("ltv:layout-stable", {
            detail: {
              mode: ltvMode || null,
              rowsCount: rows.length,
              hasPreviewImage: !!previewImage,
              hasFinalCropped: !!finalCroppedUrl,
              isCropping,
              delayed: true,
            },
          })
        )
      }, 120)
    })
  }, [ltvMode, rows.length, previewImage, finalCroppedUrl, isCropping])
  // --- début du drag (NEEDS_CROP)
  const handleEdgeStart = (
    edge: "top" | "bottom" | "left" | "right",
    clientX: number,
    clientY: number
  ) => {
    if (!previewImgRef.current || !containerRef.current) {
      setDraggingEdge(edge)
      setZoom(2.5)
      return
    }

    setDraggingEdge(edge)

    // mémorise le point saisi
    setAnchorX(clientX)
    setAnchorY(clientY)

    // centre le zoom autour du point saisi
    const viewportRect =
      containerRef.current.parentElement?.getBoundingClientRect()

    if (viewportRect) {
      const scaleTarget = 2.5

      const viewportCenterX = viewportRect.left + viewportRect.width / 2
      const viewportCenterY = viewportRect.top + viewportRect.height / 2

      const dx = clientX - viewportCenterX
      const dy = clientY - viewportCenterY

      const extraX = dx * (scaleTarget - 1)
      const extraY = dy * (scaleTarget - 1)

      setPanX((oldX) => oldX - extraX)
      setPanY((oldY) => oldY - extraY)

      setZoom(scaleTarget)
    } else {
      setZoom(2.5)
    }
  }

  // --- déplacement en cours (NEEDS_CROP)
  const handleEdgeMove = (clientX: number, clientY: number) => {
    if (!draggingEdge || !previewImgRef.current || !containerRef.current) return

    const rect = previewImgRef.current.getBoundingClientRect()
    const relXpct = ((clientX - rect.left) / rect.width) * 100
    const relYpct = ((clientY - rect.top) / rect.height) * 100

    // mettre à jour la position du cadre
    setCropBox((prev) => {
      const next = { ...prev }

      if (draggingEdge === "top") {
        next.top = Math.max(0, Math.min(relYpct, prev.bottom - 5))
      }
      if (draggingEdge === "bottom") {
        next.bottom = Math.min(100, Math.max(relYpct, prev.top + 5))
      }
      if (draggingEdge === "left") {
        next.left = Math.max(0, Math.min(relXpct, prev.right - 5))
      }
      if (draggingEdge === "right") {
        next.right = Math.min(100, Math.max(relXpct, prev.left + 5))
      }

      return next
    })

    // auto-pan si on approche du bord visible (viewport)
    const viewportEl = containerRef.current.parentElement
    if (!viewportEl) return

    const viewportRect = viewportEl.getBoundingClientRect()

    const marginPx = 80
    const step = 5

    // haut / bas
    if (clientY - viewportRect.top < marginPx) {
      setPanY((y) => y + step)
    } else if (viewportRect.bottom - clientY < marginPx) {
      setPanY((y) => y - step)
    }

    // gauche / droite
    if (clientX - viewportRect.left < marginPx) {
      setPanX((x) => x + step)
    } else if (viewportRect.right - clientX < marginPx) {
      setPanX((x) => x - step)
    }
  }

  // --- fin du drag (NEEDS_CROP)
  const handleEdgeEnd = () => {
    setDraggingEdge(null)

    // retour vue repos
    setZoom(1)
    setPanX(0)
    setPanY(0)

    setAnchorX(null)
    setAnchorY(null)
  }

  // listeners globaux pour le drag
  useEffect(() => {
    const onMoveMouse = (e: MouseEvent) => {
      if (!draggingEdge) return
      handleEdgeMove(e.clientX, e.clientY)
    }
    const onMoveTouch = (e: TouchEvent) => {
      if (!draggingEdge) return
      const t = e.touches[0]
      handleEdgeMove(t.clientX, t.clientY)
    }
    const onUp = () => {
      if (draggingEdge) {
        handleEdgeEnd()
      }
    }

    window.addEventListener("mousemove", onMoveMouse)
    window.addEventListener("touchmove", onMoveTouch, { passive: false })
    window.addEventListener("mouseup", onUp)
    window.addEventListener("touchend", onUp)

    return () => {
      window.removeEventListener("mousemove", onMoveMouse)
      window.removeEventListener("touchmove", onMoveTouch)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("touchend", onUp)
    }
  }, [draggingEdge])

  // --- Réinitialisation manuelle (NEEDS_CROP)
  const resetView = () => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvResetCrop",
        source: "ltv",
      })
      return
    }

    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDraggingEdge(null)
    setAnchorX(null)
    setAnchorY(null)
    setCropBox({
      top: 20,
      bottom: 80,
      left: 10,
      right: 90,
    })
    setIsCropping(true)

    // ✅ log rejouable : reset du recadrage
    logTestEvent("ltv:crop:reset", {
      source: "needs_crop",
    })
  }



  // --- retour en édition après validation (NEEDS_CROP)
  const reopenCrop = () => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvReopenCrop",
        source: "ltv",
      })
      return
    }

    setIsCropping(true)
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDraggingEdge(null)
    setAnchorX(null)
    setAnchorY(null)
  }


  // --- Validation du recadrage manuel (NEEDS_CROP)
  const confirmCrop = () => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvConfirmCrop",
        source: "ltv",
      })
      return
    }

    if (!previewImgRef.current || !previewImage) return

    const imgEl = previewImgRef.current

    // dimensions d'affichage
    const displayRect = imgEl.getBoundingClientRect()
    const displayW = displayRect.width
    const displayH = displayRect.height

    // dimensions réelles
    const naturalW = imgEl.naturalWidth
    const naturalH = imgEl.naturalHeight

    // conversion % -> px affichés
    const cropLeftPx = (cropBox.left / 100) * displayW
    const cropRightPx = (cropBox.right / 100) * displayW
    const cropTopPx = (cropBox.top / 100) * displayH
    const cropBottomPx = (cropBox.bottom / 100) * displayH

    const innerWidthDisplayed =
      displayW - cropLeftPx - (displayW - cropRightPx)
    const innerHeightDisplayed =
      displayH - cropTopPx - (displayH - cropBottomPx)

    // ratio affichage -> pixels réels
    const scaleX = naturalW / displayW
    const scaleY = naturalH / displayH

    const srcX = cropLeftPx * scaleX
    const srcY = cropTopPx * scaleY
    const srcW = innerWidthDisplayed * scaleX
    const srcH = innerHeightDisplayed * scaleY

    if (srcW <= 0 || srcH <= 0) {
      console.warn("[LTV] recadrage annulé : dimensions nulles")
      return
    }

    // Canvas hors-DOM
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(srcW)
    canvas.height = Math.round(srcH)

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const imgObj = new Image()
    imgObj.onload = () => {
      ctx.drawImage(imgObj, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)
      const outDataUrl = canvas.toDataURL("image/png")

      setFinalCroppedUrl(outDataUrl)
      setIsCropping(false)

      // ✅ log rejouable : résultat du recadrage (coordonnées normalisées)
      logTestEvent("ltv:crop:set", {
        unit: "norm",
        rect: {
          x: cropBox.left / 100,
          y: cropBox.top / 100,
          w: (cropBox.right - cropBox.left) / 100,
          h: (cropBox.bottom - cropBox.top) / 100,
        },
        source: "needs_crop",
      })

      // vue neutre post-validation
      setZoom(1)
      setPanX(0)
      setPanY(0)
      setDraggingEdge(null)
      setAnchorX(null)
      setAnchorY(null)
    }
    imgObj.src = previewImage
  }


  // --- Toggle entre previewImageDataUrl et altPreviewImageDataUrl en DISPLAY_DIRECT
  const toggleDisplayDirectImage = () => {
    if (lockedDisplayDirect) return
    if (!previewImage || !altPreviewImage) return

    setSelectedImage((prev) => {
      const next = prev === "main" ? "alt" : "main"
      const nextUrl = next === "main" ? previewImage : altPreviewImage
      setFinalCroppedUrl(nextUrl || null)
      return next
    })
  }

  // --- Validation du choix en DISPLAY_DIRECT (fige l'image affichée)
  const confirmDisplayDirectChoice = () => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvDisplayLock",
        source: "ltv",
      })
      return
    }

    setLockedDisplayDirect(true)

    // ✅ log rejouable : validation du choix DISPLAY_DIRECT
    logTestEvent("ltv:display:lock", {
      selected: Array.isArray(selectedImageIndices) ? selectedImageIndices : [],
      source: "display_direct",
    })
  }


  // Sélection / désélection d'une image candidate par son index
  const toggleCandidateSelection = (index: number) => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvSelectCandidate",
        source: "ltv",
      })
      return
    }

    // ⚠️ Important : pas de log dans le "setState updater"
    // (sinon doublons possibles en dev / StrictMode).
    const wasSelected = selectedImageIndices.includes(index)
    const next = wasSelected
      ? selectedImageIndices.filter((i) => i !== index)
      : [...selectedImageIndices, index]

    // ✅ log rejouable : sélection/désélection d'une candidate
    logTestEvent("ltv:candidate:set", {
      index,
      selected: !wasSelected,
      selectedIndices: next, // état après action
      source: "tap",
    })

    setSelectedImageIndices(next)
  }



  // --- Basculer manuellement depuis DISPLAY_DIRECT vers NEEDS_CROP
  const switchToManualCropFromDisplayDirect = () => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvSwitchToManualCrop",
        source: "ltv",
      })
      return
    }

    // priorité : bande de page complète fournie via debugBands
    const baseImage = pageBandImage || previewImage || finalCroppedUrl

    if (!baseImage) {
      console.warn(
        "[LTV] switchToManualCropFromDisplayDirect: aucune image de base disponible"
      )
      return
    }

    console.log("[LTV] switchToManualCropFromDisplayDirect: baseImage =", {
      hasPageBand: !!pageBandImage,
      hasPreview: !!previewImage,
      hasFinal: !!finalCroppedUrl,
    })

    setLtvMode("NEEDS_CROP")
    setPreviewImage(baseImage)
    setAltPreviewImage(undefined)
    setSelectedImage("main")
    setLockedDisplayDirect(false)

    setIsCropping(true)
    setFinalCroppedUrl(null)

    setCropBox({ top: 20, bottom: 80, left: 10, right: 90 })
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setDraggingEdge(null)
    setAnchorX(null)
    setAnchorY(null)

    // en mode recadrage manuel, on ne parcourt plus les candidates
    setCandidateImages([])
    setSelectedImageIndex(0)
    setSelectedImageIndices([])
  }

  // Demande au parseur de déplacer la bande LTV vers le haut ou le bas
  const requestBandShift = (direction: "up" | "down") => {
    // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
    if (simulationEnabled) {
      logTestEvent("ui:blocked", {
        control: "ltvRequestBandShift",
        direction,
        source: "ltv",
      })
      return
    }

    if (ltvMode !== "NEEDS_CROP") return

    const DEFAULT_BAND_HEIGHT = 0.2 // 20 % de la page
    const STEP = 0.05 // déplacement de 5 % de la page

    const currentTop = bandTopPct !== null ? bandTopPct : 0.2

    const minTop = 0
    const maxTop = 1 - DEFAULT_BAND_HEIGHT

    let nextTop = direction === "up" ? currentTop - STEP : currentTop + STEP

    if (nextTop < minTop) nextTop = minTop
    if (nextTop > maxTop) nextTop = maxTop

    setBandTopPct(nextTop)

    window.dispatchEvent(
      new CustomEvent("ltv:request-band", {
        detail: {
          topPct: nextTop,
          heightPct: DEFAULT_BAND_HEIGHT,
        },
      })
    )
  }


  // ------------------------------------------------------------------
  // Rendu du tbody selon le mode
  // ------------------------------------------------------------------
  const renderBody = () => {
    console.log("[LTV] renderBody()", {
      ltvMode,
      isCropping,
      hasPreviewImage: !!previewImage,
      hasFinal: !!finalCroppedUrl,
    })

    // 1. DISPLAY_DIRECT -> on affiche les rows texte
    if (ltvMode === "DISPLAY_DIRECT" && rows.length > 0) {
      return (
        <tbody className="ltv-body-direct">
          {rows.map((r, idx) => {
            const check = (v: boolean) => (v ? "✓" : "")
            return (
              <tr key={r.code + "_" + idx}>
                {/* (CÓDIGO LTV) Trayecto / Estación */}
                <td
                  className="ltv-td"
                  style={{
                    textAlign: "left",
                    fontWeight: 600,
                    lineHeight: 1.2,
                    whiteSpace: "pre-line",
                  }}
                >
                  {`(${r.code}) ${r.section}`}
                </td>

                {/* Vía */}
                <td className="ltv-td">{r.via}</td>

                {/* Km. Ini */}
                <td
                  className="ltv-td"
                  style={{
                    fontSize: "8.5px",
                    lineHeight: 1.05,
                    letterSpacing: "-0.35px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.kmIni}
                </td>

                {/* Km. Fin */}
                <td
                  className="ltv-td"
                  style={{
                    fontSize: "8.5px",
                    lineHeight: 1.05,
                    letterSpacing: "-0.35px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.kmFin}
                </td>

                {/* Veloc. */}
                <td className="ltv-td">{r.speed}</td>

                {/* Motivo */}
                <td className="ltv-td" style={{ textAlign: "left" }}>
                  {r.motivo}
                </td>

                {/* Establecido · Fecha */}
                <td className="ltv-td">{r.fecha1}</td>

                {/* Establecido · Hora */}
                <td className="ltv-td">{r.hora1}</td>

                {/* Fin prevista · Fecha */}
                <td className="ltv-td">{r.fecha2}</td>

                {/* Fin prevista · Hora */}
                <td className="ltv-td">{r.hora2}</td>

                {/* No señalizada · Vía */}
                <td className="ltv-td">{check(r.viaCheck)}</td>

                {/* No señalizada · Sistema */}
                <td className="ltv-td">{check(r.sistema)}</td>

                {/* Sólo vehic. Cabeza */}
                <td className="ltv-td">{check(r.soloCabeza)}</td>

                {/* CSV */}
                <td className="ltv-td">{check(r.csv)}</td>

                {/* Observaciones */}
                <td
                  className="ltv-td"
                  style={{ textAlign: "left", whiteSpace: "pre-line" }}
                >
                  {r.observaciones}
                </td>
              </tr>
            )
          })}
        </tbody>
      )
    }

    // 2. NO_LTV -> pavé gris
    if (ltvMode === "NO_LTV") {
      return (
        <tbody className="ltv-body-noltv">
          <tr>
            <td className="ltv-td noltv-cell" colSpan={15}></td>
          </tr>
        </tbody>
      )
    }

    // 3. NEEDS_CROP
    if (ltvMode === "NEEDS_CROP") {
      // Cas 3a : pas d'image fournie par le parseur → fallback lisible
      if (!previewImage) {
        return (
          <tbody className="ltv-body-crop">
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  color: "#fff",
                  textAlign: "center",
                  padding: "4px 6px",
                  fontSize: "11px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Zona LTV detectada (NEEDS_CROP)
              </td>
            </tr>

            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#dedede",
                  color: "#000",
                  textAlign: "center",
                  padding: "12px 8px",
                  fontSize: "12px",
                  lineHeight: 1.4,
                  fontWeight: 600,
                }}
              >
                Aucune image à recadrer n’a été extraite du PDF.
                <br />
                (Pas de bitmap reçu du parseur v5.2)
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3b : image dispo, workflow normal recadrage
      if (isCropping && previewImage) {
        return (
          <tbody className="ltv-body-crop">
            {/* bandeau d'info */}
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  color: "#fff",
                  textAlign: "center",
                  padding: "4px 6px",
                  fontSize: "11px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Zona LTV extraída automáticamente (PDF)
              </td>
            </tr>

            {/* zone image / recadrage */}
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#000",
                  padding: "6px",
                  textAlign: "center",
                }}
              >
                {/* viewport noir qui clippe */}
                <div
                  style={{
                    display: "inline-block",
                    textAlign: "center",
                    maxWidth: "100%",
                    maxHeight: "70vh",
                    overflow: "hidden",
                    position: "relative",
                    borderRadius: "4px",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.8)",
                    backgroundColor: "#000",
                  }}
                >
                  {/* conteneur zoomé/translaté */}
                  <div
                    ref={containerRef}
                    className="crop-container"
                    style={{
                      position: "relative",
                      display: "inline-block",
                      overflow: "visible",
                      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                      transformOrigin: "center center",
                      transition: draggingEdge
                        ? "none"
                        : "transform 0.2s ease-in-out",
                    }}
                  >
                    <img
                      ref={previewImgRef}
                      src={previewImage}
                      alt="LTV brute"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        border: "2px solid #fff",
                        borderRadius: "4px",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.5)",
                        display: "block",
                      }}
                    />

                    {/* Masque assombrissant hors zone recadrée */}
                    <div
                      className="crop-mask"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: "none",
                        zIndex: 5,
                        background: `
                          linear-gradient(
                            to bottom,
                            rgba(0,0,0,0.5) ${cropBox.top}%,
                            transparent ${cropBox.top}%,
                            transparent ${cropBox.bottom}%,
                            rgba(0,0,0,0.5) ${cropBox.bottom}%
                          ),
                          linear-gradient(
                            to right,
                            rgba(0,0,0,0.5) ${cropBox.left}%,
                            transparent ${cropBox.left}%,
                            transparent ${cropBox.right}%,
                            rgba(0,0,0,0.5) ${cropBox.right}%
                          )
                        `,
                      }}
                    />

                    {/* Bandes rouges déplaçables */}
                    <div
                      className="crop-edge top"
                      style={{ top: `${cropBox.top}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("top", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) => {
                        e.preventDefault()
                        const t = e.touches[0]
                        if (!t) return
                        handleEdgeStart("top", t.clientX, t.clientY)
                      }}
                    />
                    <div
                      className="crop-edge bottom"
                      style={{ top: `${cropBox.bottom}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("bottom", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) => {
                        e.preventDefault()
                        const t = e.touches[0]
                        if (!t) return
                        handleEdgeStart("bottom", t.clientX, t.clientY)
                      }}
                    />
                    <div
                      className="crop-edge left"
                      style={{ left: `${cropBox.left}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("left", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) => {
                        e.preventDefault()
                        const t = e.touches[0]
                        if (!t) return
                        handleEdgeStart("left", t.clientX, t.clientY)
                      }}
                    />
                    <div
                      className="crop-edge right"
                      style={{ left: `${cropBox.right}%` }}
                      onMouseDown={(e) =>
                        handleEdgeStart("right", e.clientX, e.clientY)
                      }
                      onTouchStart={(e) => {
                        e.preventDefault()
                        const t = e.touches[0]
                        if (!t) return
                        handleEdgeStart("right", t.clientX, t.clientY)
                      }}
                    />

                  </div>

                  {/* Boutons action */}
                  <div
                    style={{
                      marginTop: "8px",
                      display: "flex",
                      justifyContent: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    {/* Monter la bande LTV dans la page */}
                    <button
                      style={{
                        backgroundColor: "#4b5563",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "150px",
                      }}
                      onClick={() => requestBandShift("up")}
                    >
                      Monter la page ▲
                    </button>

                    {/* Descendre la bande LTV dans la page */}
                    <button
                      style={{
                        backgroundColor: "#4b5563",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "150px",
                      }}
                      onClick={() => requestBandShift("down")}
                    >
                      Descendre la page ▼
                    </button>

                    <button
                      style={{
                        backgroundColor: "#1e40af",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "140px",
                      }}
                      onClick={confirmCrop}
                    >
                      Valider le recadrage
                    </button>

                    <button
                      style={{
                        backgroundColor: "#6b7280",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 600,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        border: "2px solid #fff",
                        boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
                        cursor: "pointer",
                        minWidth: "140px",
                      }}
                      onClick={resetView}
                    >
                      Réinitialiser
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3c : image dispo, recadrage validé → affichage final figé cliquable
      if (!isCropping && finalCroppedUrl) {
        return (
          <tbody className="ltv-body-final">
            <tr>
              <td
                className="ltv-td"
                colSpan={15}
                style={{
                  backgroundColor: "#fff",
                  padding: "0",
                  textAlign: "center",
                }}
              >
                <img
                  src={finalCroppedUrl}
                  alt="LTV validée"
                  style={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                    cursor: "pointer",
                    border: "0",
                    borderRadius: "0",
                    boxShadow: "none",
                    backgroundColor: "transparent",
                  }}
                  onClick={reopenCrop}
                />
              </td>
            </tr>
          </tbody>
        )
      }

      // Cas 3d : NEEDS_CROP mais aucune image finale exploitable
      return (
        <tbody className="ltv-body-placeholder">
          <tr>
            <td className="ltv-td" colSpan={15}></td>
          </tr>
        </tbody>
      )
    }

    // 4. Affichage direct d'une image fournie (DISPLAY_DIRECT)
    if (ltvMode === "DISPLAY_DIRECT" && finalCroppedUrl) {
      const totalCandidates = candidateImages.length
      const hasCandidates = totalCandidates > 0
      const safeIndex =
        hasCandidates && selectedImageIndex < totalCandidates
          ? selectedImageIndex
          : 0

      const currentUrl = finalCroppedUrl

      // Liste finale d'URL à afficher :
      // - avant validation → toujours 1 seule image : currentUrl
      // - après validation :
      //      * si aucune image sélectionnée → currentUrl
      //      * sinon → toutes les candidates sélectionnées, empilées dans l'ordre de selectedImageIndices
      const effectiveImageUrls =
        lockedDisplayDirect &&
        selectedImageIndices.length > 0 &&
        hasCandidates
          ? selectedImageIndices
              .filter((idx) => idx >= 0 && idx < totalCandidates)
              .map((idx) => candidateImages[idx])
          : [currentUrl]

      return (
        <tbody className="ltv-body-final">
          <tr>
            <td
              className="ltv-td"
              colSpan={15}
              style={{
                backgroundColor: "#fff",
                padding: "0",
                textAlign: "center",
              }}
            >
              {/* Affichage de toutes les images effectives (empilées) */}
              <div
                style={{
                  width: "100%",
                  backgroundColor: "#fff",
                }}
              >
{effectiveImageUrls.map((url, idx) => (
  <img
    key={idx}
    src={url || ""}
    alt="LTV auto"
    style={{
      width: "100%",
      height: "auto",
      display: "block",
      border: "0",
      borderRadius: "0",
      boxShadow: "none",
      backgroundColor: "transparent",
      cursor: "default",
      marginBottom: 0,
    }}
  />
))}

              </div>

              {/* Barre d'actions :
                 - affichée SEULEMENT tant que l'image n'est pas verrouillée
                 - disparaît totalement après validation */}
              {!lockedDisplayDirect && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                    padding: "8px 0 10px",
                    backgroundColor: "#fff",
                    alignItems: "center",
                  }}
                >
                  {/* Navigation entre les différentes images candidates */}
                  {hasCandidates && totalCandidates > 1 && (
                    <>
                      <button
                        style={{
                          backgroundColor: "#4b5563",
                          color: "#fff",
                          fontSize: "13px",
                          fontWeight: 600,
                          borderRadius: "6px",
                          padding: "6px 10px",
                          border: "2px solid #000",
                          boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                          cursor: safeIndex > 0 ? "pointer" : "not-allowed",
                          minWidth: "80px",
                          lineHeight: 1.2,
                        }}
                        disabled={safeIndex <= 0}
                        onClick={() => {
                          // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                          if (simulationEnabled) {
                            logTestEvent("ui:blocked", {
                              control: "ltvPrevImage",
                              source: "ltv",
                            })
                            return
                          }

                          if (safeIndex <= 0) return
                          const nextIndex = safeIndex - 1
                          setSelectedImageIndex(nextIndex)
                          const nextUrl = candidateImages[nextIndex] || currentUrl
                          setFinalCroppedUrl(nextUrl || null)

                          // ✅ log rejouable : navigation entre candidates
                          logTestEvent("ltv:navigate", {
                            dir: "prev",
                            from: safeIndex,
                            to: nextIndex,
                            source: "button",
                          })
                        }}

                      >
                        ◀︎ Préc.
                      </button>

                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          minWidth: "110px",
                        }}
                      >
                        Image {safeIndex + 1} / {totalCandidates}
                      </span>

                      <button
                        style={{
                          backgroundColor: "#4b5563",
                          color: "#fff",
                          fontSize: "13px",
                          fontWeight: 600,
                          borderRadius: "6px",
                          padding: "6px 10px",
                          border: "2px solid #000",
                          boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                          cursor:
                            safeIndex < totalCandidates - 1 ? "pointer" : "not-allowed",
                          minWidth: "80px",
                          lineHeight: 1.2,
                        }}
                        disabled={safeIndex >= totalCandidates - 1}
                        onClick={() => {
                          // ✅ Simulation : on bloque les commandes de l'app (seul le player agit)
                          if (simulationEnabled) {
                            logTestEvent("ui:blocked", {
                              control: "ltvNextImage",
                              source: "ltv",
                            })
                            return
                          }

                          if (safeIndex >= totalCandidates - 1) return
                          const nextIndex = safeIndex + 1
                          setSelectedImageIndex(nextIndex)
                          const nextUrl = candidateImages[nextIndex] || currentUrl
                          setFinalCroppedUrl(nextUrl || null)

                          // ✅ log rejouable : navigation entre candidates
                          logTestEvent("ltv:navigate", {
                            dir: "next",
                            from: safeIndex,
                            to: nextIndex,
                            source: "button",
                          })
                        }}

                      >
                        Suiv. ▶︎
                      </button>

                    </>
                  )}

                  {/* Compteur de sélection */}
                  {hasCandidates && (
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        minWidth: "150px",
                      }}
                    >
                      Images sélectionnées : {selectedImageIndices.length}
                    </span>
                  )}

                  {/* Bouton sélectionner / désélectionner l'image courante */}
                  <button
                    style={{
                      backgroundColor: "#2563eb",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      padding: "6px 10px",
                      border: "2px solid #000",
                      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                      cursor: hasCandidates ? "pointer" : "not-allowed",
                      minWidth: "170px",
                      lineHeight: 1.2,
                      opacity: hasCandidates ? 1 : 0.6,
                    }}
                    disabled={!hasCandidates}
                    onClick={() => toggleCandidateSelection(safeIndex)}
                  >
                    {selectedImageIndices.includes(safeIndex)
                      ? "Désélectionner cette image"
                      : "Sélectionner cette image"}
                  </button>

                  {/* bouton valider */}
                  <button
                    style={{
                      backgroundColor: "#065f46",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      padding: "6px 10px",
                      border: "2px solid #000",
                      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                      cursor: "pointer",
                      minWidth: "110px",
                      lineHeight: 1.2,
                    }}
                    onClick={confirmDisplayDirectChoice}
                  >
                    Valider ✅
                  </button>

                  {/* bouton recadrage manuel depuis la bande de page */}
                  <button
                    style={{
                      backgroundColor: "#b91c1c",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      padding: "6px 10px",
                      border: "2px solid #000",
                      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                      cursor: pageBandImage ? "pointer" : "not-allowed",
                      minWidth: "140px",
                      lineHeight: 1.2,
                      opacity: pageBandImage ? 1 : 0.6,
                    }}
                    disabled={!pageBandImage && !previewImage && !finalCroppedUrl}
                    onClick={switchToManualCropFromDisplayDirect}
                  >
                    Recadrage manuel ✂️
                  </button>
                </div>
              )}
            </td>
          </tr>
        </tbody>
      )
    }

    // 5. fallback
    return (
      <tbody className="ltv-body-placeholder">
        <tr>
          <td className="ltv-td" colSpan={15}></td>
        </tr>
      </tbody>
    )
  }

  const ltvFormattedFetchedAt = formatLtvFetchedAt(ltvDisplayMeta.fetchedAt)
  const ltvCaptionIsStale = isLtvFetchedAtOlderThanTwoHours(
    ltvDisplayMeta.fetchedAt
  )

  const ltvCaptionText =
    typeof ltvDisplayMeta.displayedCount === "number" && ltvFormattedFetchedAt
      ? `LTV : ${ltvDisplayMeta.displayedCount} - Actualisées le ${ltvFormattedFetchedAt}`
      : typeof ltvDisplayMeta.displayedCount === "number"
        ? `LTV : ${ltvDisplayMeta.displayedCount}`
        : ltvFormattedFetchedAt
          ? `LTV - Actualisées le ${ltvFormattedFetchedAt}`
          : "LTV"

  // ------------------------------------------------------------------
  // Rendu global
  // ------------------------------------------------------------------
  return (
    <section className="ltv-wrap">
      <style>{`
        .ltv-wrap { 
          background: transparent; 
          position: relative; /* ✅ ancre l’overlay Replay */
        }

        .ltv-replay-overlay {
          position: absolute;
          left: 8px;
          right: 8px;
          top: 8px;
          z-index: 99999;
          pointer-events: auto;
        }

        .ltv-replay-card {
          border: 2px solid #000;
          background: rgba(255, 255, 255, 0.92);
          color: #000;
          border-radius: 12px;
          padding: 8px 10px;
          box-shadow: 0 8px 18px rgba(0,0,0,0.35);
          font-size: 12px;
          line-height: 1.2;
        }

        .dark .ltv-replay-card {
          border: 2px solid #fff;
          background: rgba(0, 0, 0, 0.72);
          color: #fff;
        }

        .ltv-replay-row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .ltv-replay-row + .ltv-replay-row {
          margin-top: 6px;
        }

        .ltv-replay-input {
          flex: 1;
          min-width: 260px;
          padding: 6px 8px;
          border-radius: 8px;
          border: 2px solid currentColor;
          background: transparent;
          color: inherit;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 11px;
        }

        .ltv-replay-btn {
          padding: 6px 10px;
          border-radius: 8px;
          border: 2px solid currentColor;
          background: transparent;
          color: inherit;
          font-weight: 700;
          cursor: pointer;
          user-select: none;
        }

        .ltv-replay-meta {
          opacity: 0.85;
          font-size: 11px;
        }

        .ltv-table {
          border-collapse: collapse;
          width: 100%;
          table-layout: fixed;
          border: 2px solid #000;

          background: #fff;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: #000;
        }

        .ltv-table caption {
          caption-side: top;
          background: #dedede;
          color: #000;
          font-weight: 700;
          font-size: 15px;
          border: 2px solid #000;
          border-bottom: 0;
          letter-spacing: 0.3px;
          padding: 4px 0;
          line-height: 1.05;
        }

        .ltv-table caption.ltv-caption-stale {
          color: #dc2626;
          animation: ltv-caption-stale-blink 1s step-start infinite;
        }

        .dark .ltv-table caption.ltv-caption-stale {
          color: #f87171;
        }

        @keyframes ltv-caption-stale-blink {
          0%, 50% {
            opacity: 1;
          }
          50.01%, 100% {
            opacity: 0.25;
          }
        }

        .ltv-th, .ltv-td {
          border: 2px solid #000;
          color: #000;
          background: #fff;
          font-size: 11.5px;
          line-height: 1.15;
          text-align: center;
          font-weight: 600;
        }

        /* Cellules verticales (compat iPad) */
        .ltv-th.vert,
        .ltv-td.vert {
          font-size: 10.5px;
          font-weight: 600;
          line-height: 1.05;
          text-align: center;
          white-space: nowrap;
          vertical-align: middle;
          padding: 0 2px;
        }

        /* Boîte interne qui force la hauteur de la cellule verticale */
        .vert-shell {
          position: relative;
          height: 55px; /* validé */
          width: 100%;
          display: block;
        }

        /* Libellé vertical tourné + centré */
        .vert-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-90deg);
          transform-origin: center center;

          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;

          white-space: nowrap;
          line-height: 1.05;
          font-weight: 600;
          text-align: center;
          max-width: 100%;
        }

        /* Ajustement fin pour les libellés verticaux sur 2 lignes
           (ex: "Sólo vehic." / "Cabeza") */
        .vert-label-2l {
          line-height: 1.1;
        }

        .ltv-th.left { text-align: left; font-weight: 700; }


        /* Largeurs recalées v3 (affinage post-capture)
           - Trayecto légèrement réduit
           - Motivo réduite
           - Solo/CSV corrigés
        */

        /* (CÓDIGO LTV) Trayecto / Estación */
        col.ltv-col-trayecto  { width: 21.43%; } /* (CÓDIGO LTV) Trayecto / Estación */

        /* Groupe B : Vía / Km Ini / Km Fin / Veloc. */
        col.ltv-col-via       { width: 2.23%; }  /* Vía */
        col.ltv-col-km        { width: 3.79%; }  /* Km. Ini */
        col.ltv-col-km2       { width: 3.68%; }  /* Km. Fin */
        col.ltv-col-vel       { width: 3.35%; }  /* Veloc. */

        /* Motivo */
        col.ltv-col-motivo    { width: 16.18%; } /* Motivo */

        /* Bloc Establecido / Fin prevista / No señalizada */
        col.ltv-col-small-a   { width: 5.13%; }  /* Establecido · Fecha */
        col.ltv-col-small-b   { width: 2.90%; }  /* Establecido · Hora */

        col.ltv-col-small-c   { width: 4.80%; }  /* Fin prevista · Fecha */
        col.ltv-col-small-d   { width: 3.13%; }  /* Fin prevista · Hora */

        col.ltv-col-small-e   { width: 6.03%; }  /* No señalizada · Vía */
        col.ltv-col-small-f   { width: 6.03%; }  /* No señalizada · Sistema */

        /* Sólo vehic. Cabeza */
        col.ltv-col-solo      { width: 3.13%; }  /* Sólo vehic. Cabeza */

        /* CSV (étroite) */
        col.ltv-col-csv-narrow { width: 2.34%; } /* CSV */

        /* Observaciones (dernière grande zone texte) */
        col.ltv-col-csv       { width: 15.85%; } /* Observaciones */


        .ltv-body-placeholder .ltv-td {
          height: 18px;
          font-weight: 400;
        }

        .ltv-body-noltv .noltv-cell {
          background: #dedede;
          border: 2px solid #000;
          height: 36px;
        }

        /* Mode sombre */
        .dark .ltv-table {
          border: 2px solid #fff;
          background: #000;
          color: #fff;
        }
        .dark .ltv-table caption {
          background: #444;
          color: #fff;
          border: 2px solid #fff;
          border-bottom: 0;
        }
        .dark .ltv-th,
        .dark .ltv-td {
          border: 2px solid #fff;
          color: #fff;
          background: #000;
        }
        .dark .ltv-body-noltv .noltv-cell {
          background: #333;
          border: 2px solid #fff;
          color: #fff;
        }

        /* inversion visuelle de l'image finale en mode sombre */
        .dark .ltv-body-final img {
          filter: invert(1) brightness(1.1);
          transition: filter 0.3s ease;
        }

        /* Bandes rouges de recadrage (hitbox large + ligne fine) */
        .crop-edge {
          position: absolute;
          background: transparent;
          z-index: 9999;
          cursor: grab;
          user-select: none;
          touch-action: none;
        }

        /* Horizontal edges (top & bottom) */
        .crop-edge.top,
        .crop-edge.bottom {
          height: 12px;            /* zone cliquable */
          left: 0;
          right: 0;
          transform: translateY(-50%);
        }

        /* Vertical edges (left & right) */
        .crop-edge.left,
        .crop-edge.right {
          width: 12px;             /* zone cliquable */
          top: 0;
          bottom: 0;
          transform: translateX(-50%);
        }

        /* Ligne rouge fine */
        .crop-edge::before {
          content: "";
          position: absolute;
          background: rgba(255, 0, 0, 0.6);
        }
        .crop-edge.top::before,
        .crop-edge.bottom::before {
          height: 2px;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
        }
        .crop-edge.left::before,
        .crop-edge.right::before {
          width: 2px;
          top: 0;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
        }

        @media print {
          .ltv-th, .ltv-td { font-size: 10.5px; }
          .ltv-th.vert, .ltv-td.vert { font-size: 10px; }
          .ltv-table caption { font-size: 14px; padding: 3px 0; }
        }
      `}</style>
      {/* ✅ Replay overlay : visible uniquement en simulation */}
      {simulationEnabled && (
        <div className="ltv-replay-overlay">
          <div className="ltv-replay-card">
            <div className="ltv-replay-row">
              <strong>REPLAY</strong>
              <span className="ltv-replay-meta">
                (simulation ON — commandes utilisateur bloquées)
              </span>
            </div>

            <div className="ltv-replay-row">
              <input
                className="ltv-replay-input"
                value={(window as any).__limgptReplayUrl ?? ""}
                placeholder="URL log (ex: https://radioequinoxe.com/limgpt/replay_get.php?f=....pdf)"
                onChange={(e) => {
                  // ✅ Simulation : autorisé (c’est le panneau du player)
                  ;(window as any).__limgptReplayUrl = e.target.value
                }}
              />

              <button
                className="ltv-replay-btn"
                onClick={async () => {
                  const url = String((window as any).__limgptReplayUrl ?? "").trim()
                  if (!url) return
                  try {
                    await (window as any).__limgptReplay?.loadUrl(url)
                  } catch (err) {
                    console.warn("[replay-overlay] load failed", err)
                  }
                }}
              >
                Load
              </button>

              <button
                className="ltv-replay-btn"
                onClick={() => (window as any).__limgptReplay?.play()}
              >
                Play
              </button>

              <button
                className="ltv-replay-btn"
                onClick={() => (window as any).__limgptReplay?.pause()}
              >
                Pause
              </button>

              <button
                className="ltv-replay-btn"
                onClick={() => (window as any).__limgptReplay?.stop()}
              >
                Stop
              </button>
            </div>

            <div className="ltv-replay-row">
              <span className="ltv-replay-meta">
                status: {(window as any).__limgptReplay?.status?.() ?? "n/a"}
              </span>
              <span className="ltv-replay-meta">
                cursor:{" "}
                {(() => {
                  try {
                    const c = (window as any).__limgptReplay?.cursor?.()
                    return c ? `${c.idx} @ ${Math.round(c.tMs)}ms` : "n/a"
                  } catch {
                    return "n/a"
                  }
                })()}
              </span>
            </div>
          </div>
        </div>
      )}

      <table className="ltv-table">
        <caption className={ltvCaptionIsStale ? "ltv-caption-stale" : undefined}>
          {ltvCaptionText}
        </caption>

        {/* Largeurs de colonnes calées */}
        <colgroup>
          {/* 1. (CÓDIGO LTV) Trayecto / Estación [= fusion 2 premières colonnes du PDF] */}
          <col className="ltv-col-trayecto" />

          {/* 2. Vía */}
          <col className="ltv-col-via" />

          {/* 3. Km. Ini */}
          <col className="ltv-col-km" />

          {/* 4. Km. Fin */}
          <col className="ltv-col-km2" />

          {/* 5. Veloc. */}
          <col className="ltv-col-vel" />

          {/* 6. Motivo */}
          <col className="ltv-col-motivo" />

          {/* 7-12. Colonnes techniques */}
          <col className="ltv-col-small-a" />
          <col className="ltv-col-small-b" />
          <col className="ltv-col-small-c" />
          <col className="ltv-col-small-d" />
          <col className="ltv-col-small-e" />
          <col className="ltv-col-small-f" />

          {/* 13. Sólo vehic. Cabeza */}
          <col className="ltv-col-solo" />

          {/* 14. CSV (col étroite dédiée) */}
          <col className="ltv-col-csv-narrow" />

          {/* 15. Observaciones (large bloc texte) */}
          <col className="ltv-col-csv" />
        </colgroup>

        <thead>
          <tr>
            <th className="ltv-th left" rowSpan={2}>
              (CÓDIGO LTV) Trayecto / Estación
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Vía</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Km. Ini</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Km. Fin</span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">Veloc.</span>
              </div>
            </th>

            <th className="ltv-th" rowSpan={2}>
              Motivo
            </th>

            <th className="ltv-th" colSpan={2}>
              Establecido
            </th>

            <th className="ltv-th" colSpan={2}>
              Fin prevista
            </th>

            <th className="ltv-th" colSpan={2}>
              No señalizada
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label vert-label-2l">
                  <span>Sólo vehic.</span>
                  <span>Cabeza</span>
                </span>
              </div>
            </th>

            <th className="ltv-th vert" rowSpan={2}>
              <div className="vert-shell">
                <span className="vert-label">CSV</span>
              </div>
            </th>

            <th className="ltv-th" rowSpan={2}>
              Observaciones
            </th>
          </tr>

          <tr>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Fecha</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Hora</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Fecha</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Hora</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Vía</span>
              </div>
            </th>
            <th className="ltv-th vert">
              <div className="vert-shell">
                <span className="vert-label">Sistema</span>
              </div>
            </th>
          </tr>
        </thead>

        {renderBody()}
      </table>
    </section>
  )
}

export default LTV
