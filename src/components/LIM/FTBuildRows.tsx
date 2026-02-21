// src/components/LIM/FTBuildRows.tsx
import React from "react";
import type { FTEntry, CsvSens } from "../../data/ligneFT";
import { renderDependenciaCell } from "./FTRenderHelpers";
import { computeCsvHighlightByIndex } from "./FTCsvHighlight";
import { logTestEvent } from "../../lib/testLogger";

type VisibleRows = { first: number; last: number };
type ReferenceMode = "HORAIRE" | "GPS";

export type BuildFtRowsParams = {
  rawEntries: FTEntry[];
  isEligible: (e: FTEntry) => boolean;

  // contexte UI / scroll
  visibleRows: VisibleRows;
  selectedRowIndex: number | null;
  setSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  recalibrateFromRowRef: React.MutableRefObject<number | null>;
  autoScrollEnabled: boolean;
  referenceModeRef: React.MutableRefObject<ReferenceMode>;

  // CSV
  currentCsvSens: CsvSens | null;
  CSV_ZONES: any;

  // horaires & codes
  heuresDetectees: string[];
  codesCParHeure: Record<string, string[]>;

  // indices et helpers horaires
  firstNonNoteIndex: number;
  lastNonNoteIndex: number;
  parseHoraToMinutes: (h?: string | null) => number | null;
  formatMinutesToHora: (totalMinutes: number) => string;

  // Vmax / breakpoints
  breakpointsSet: Set<string>;
  firstPk: string | null;
  lastPk: string | null;
  speedMap: Record<string, any>;

  // mode test
  testModeEnabled: boolean;
  horaTheoSecondsByIndex: Array<number | null>;
};

export function buildFtRows(params: BuildFtRowsParams): {
  rows: JSX.Element[];
  arrivalEvents: { arrivalMin: number; rowIndex: number }[];
} {
  const {
    rawEntries,
    isEligible,
    visibleRows,
    selectedRowIndex,
    setSelectedRowIndex,
    recalibrateFromRowRef,
    autoScrollEnabled,
    referenceModeRef,
    currentCsvSens,
    CSV_ZONES,
    heuresDetectees,
    codesCParHeure,
    firstNonNoteIndex,
    lastNonNoteIndex,
    parseHoraToMinutes,
    formatMinutesToHora,
    breakpointsSet,
    firstPk,
    lastPk,
    speedMap,
    testModeEnabled,
    horaTheoSecondsByIndex,
  } = params;

  const rows: JSX.Element[] = [];

  const eligibleIndices: number[] = [];

  // --- Pré-calcul des segments de vitesse ---
  const speedSegmentIndex: number[] = [];
  const segmentPkLists = new Map<number, string[]>();
  let currentSegmentId = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];

    if (!e.isNoteOnly && e.pk) {
      const pk = e.pk;
      const isBreakpoint =
        breakpointsSet.has(pk) && pk !== firstPk && pk !== lastPk;

      if (currentSegmentId === 0) currentSegmentId = 1;

      if (isBreakpoint && i !== 0) currentSegmentId++;

      speedSegmentIndex[i] = currentSegmentId;

      if (!segmentPkLists.has(currentSegmentId)) {
        segmentPkLists.set(currentSegmentId, []);
      }
      segmentPkLists.get(currentSegmentId)!.push(pk);
    } else {
      speedSegmentIndex[i] = currentSegmentId;
    }
  }

  const segmentLabelRowIndex = new Map<number, number>();
  const segmentSpeed = new Map<number, any>();

  {
    for (let i = 0; i < rawEntries.length; i++) {
      const segId = speedSegmentIndex[i] ?? 0;
      if (segId <= 0) continue;

      if (segmentLabelRowIndex.has(segId)) continue;

      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;

      segmentLabelRowIndex.set(segId, i);
    }

    for (const [segId, pkList] of segmentPkLists.entries()) {
      let info: any = null;
      for (const pk of pkList) {
        const s = (speedMap as any)[pk];
        if (s) {
          info = s;
          break;
        }
      }
      if (info) segmentSpeed.set(segId, info);
    }
  }

  // --- Pré-calcul du type de surlignage CSV (zones par PK) ---
  const csvHighlightByIndex: ("none" | "full" | "top" | "bottom")[] =
    computeCsvHighlightByIndex(rawEntries, currentCsvSens, CSV_ZONES);

  console.log("[FT][CSV] sanity", {
    CSV_ZONES_type: typeof CSV_ZONES,
    CSV_ZONES_isArray: Array.isArray(CSV_ZONES),
    CSV_ZONES_len: Array.isArray(CSV_ZONES) ? CSV_ZONES.length : null,
    has_computeCsvHighlightByIndex: typeof computeCsvHighlightByIndex,
    rawEntries_len: rawEntries.length,
    currentCsvSens,
  });

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];
    if (isEligible(e)) eligibleIndices.push(i);
  }

  const totalEligible = eligibleIndices.length;
  const assignedCount = Math.min(heuresDetectees.length, totalEligible);
  console.log(
    "[FT] Mapping heures -> lignes éligibles (S&D):",
    `${assignedCount}/${totalEligible}`,
    {
      eligibleIndices: eligibleIndices.slice(0, 30),
      heures: heuresDetectees.slice(0, assignedCount),
    }
  );

  // ------------------------------------------------------------------
  // ✅ Reconstruction locale d'une table horaire "théo" complète :
  // - On part des points existants (horaTheoSecondsByIndex sur lignes éligibles)
  // - On interpole sur les lignes intermédiaires (entre deux points connus)
  // Objectif : ré-afficher des heures intermédiaires ET fournir une source continue
  // pour l'autoscroll horaire (td.ft-hora-cell).
  // ------------------------------------------------------------------
  const horaTheoSecondsByIndexFull: Array<number | null> = (() => {
    const out = horaTheoSecondsByIndex.slice(); // copie

    const pkNum = (idx: number): number | null => {
      const pkRaw = (rawEntries[idx] as any)?.pk;
      const n =
        typeof pkRaw === "number" || typeof pkRaw === "string" ? Number(pkRaw) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

    // indices "ancres" = là où on a déjà une heure (typiquement les 13 arrêts)
    const anchors: number[] = [];
    for (let i = 0; i < out.length; i++) {
      if (isNum(out[i])) anchors.push(i);
    }
    if (anchors.length < 2) return out;

    // Remplit chaque "trou" entre deux ancres successives
    for (let a = 0; a < anchors.length - 1; a++) {
      const i0 = anchors[a];
      const i1 = anchors[a + 1];

      const t0 = out[i0] as number;
      const t1 = out[i1] as number;

      const pk0 = pkNum(i0);
      const pk1 = pkNum(i1);

      const denomPk =
        pk0 != null && pk1 != null ? Math.abs(pk1 - pk0) : null;

      for (let i = i0 + 1; i < i1; i++) {
        if (isNum(out[i])) continue; // déjà rempli

        let ratio: number;

        const pki = pkNum(i);
        if (denomPk != null && denomPk > 0 && pki != null && pk0 != null) {
          ratio = Math.abs(pki - pk0) / denomPk;
        } else {
          // fallback : interpolation par index si PK indisponible
          ratio = (i - i0) / (i1 - i0);
        }

        // interpolation linéaire en secondes
        out[i] = t0 + (t1 - t0) * ratio;
      }
    }

    return out;
  })();

  let heuresDetecteesCursor = 0;
  let previousHoraForConc: string | null = null;

  // Gestion RC
  let rcCurrentSegmentId = 0;
  const rcPrintedSegments = new Set<number>();

  // Gestion VMax (scroll intelligent)
  const vPrintedSegments = new Set<number>();

  // Debug : index de ligne visuelle (toutes les <tr> rendues)
  let renderedRowIndex = 0;

  // CSV : état "zone ouverte" entre un bottom et un top
  let csvZoneOpen = false;
  // compteur des VRAIES lignes principales
  let mainRowCounter = 0;
  // radio : une seule fois dans le viewport
  let radioPrintedInThisRender = false;
  // bloqueo : une seule fois dans le viewport
  let bloqueoPrintedInThisRender = false;

  const arrivalEvents: { arrivalMin: number; rowIndex: number }[] = [];

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];

    const isSelected = selectedRowIndex === i;

    if (entry.isNoteOnly) {
      continue;
    }

    const nextEntry = rawEntries[i + 1];
    const hasNoteAfter = nextEntry && nextEntry.isNoteOnly === true;

    const sitKm = entry.isNoteOnly ? "" : entry.pk ?? "";

    const eligible = isEligible(entry);
    const horaAssigned =
      eligible && heuresDetecteesCursor < heuresDetectees.length
        ? heuresDetectees[heuresDetecteesCursor]
        : (entry as any).hora ?? "";
    const hora = horaAssigned;

    const depNorm = (entry.dependencia ?? "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();

    const isVoyageursStop =
      depNorm === "BARCELONA SANTS" ||
      depNorm === "LA SAGRERA AV" ||
      depNorm === "GIRONA" ||
      depNorm === "FIGUERES-VILAFANT";

    let com = "";
    let comMinutes: number | null = null;

    const isOriginOrTerminus =
      !entry.isNoteOnly &&
      (i === firstNonNoteIndex || i === lastNonNoteIndex);

    // Origine / destination utilisée pour le surlignage
    const isLimiteAdifLfspa = depNorm === "LIMITE ADIF - LFPSA";
    const isOriginOrDestinationForHighlight =
      isOriginOrTerminus && !isLimiteAdifLfspa;

    if (hora && isVoyageursStop && !isOriginOrTerminus) {
      const codesPourHeure = codesCParHeure[hora] ?? [];
      if (codesPourHeure.length > 0) {
        com = codesPourHeure.join(" ");

        const firstCode = codesPourHeure[0];
        const n = Number(firstCode);
        if (Number.isFinite(n)) {
          comMinutes = n;
        } else {
          console.warn(
            "[FT] Impossible de parser COM en minutes pour l'heure",
            hora,
            "code=",
            firstCode
          );
        }

        if (codesPourHeure.length > 1) {
          console.warn(
            "[FT] Plusieurs codes C détectés pour la même heure",
            hora,
            codesPourHeure
          );
        }
      }
    }

    if (eligible && heuresDetecteesCursor < heuresDetectees.length) {
      heuresDetecteesCursor++;
    }

    const tecnico = (entry as any).tecnico ?? "";
    let conc = (entry as any).conc ?? "";

    // Heure d'arrivée calculée
    let horaArrivee: string | null = null;
    if (hora && comMinutes != null && comMinutes > 0) {
      const depMinutes = parseHoraToMinutes(hora);
      if (depMinutes != null) {
        const arrMinutes = depMinutes - comMinutes;
        horaArrivee = formatMinutesToHora(arrMinutes);

        arrivalEvents.push({
          arrivalMin: arrMinutes,
          rowIndex: i,
        });
      }
    }

    const prevHoraStr = previousHoraForConc;
    const currentHoraStr = hora;

    const prevMinutes = parseHoraToMinutes(prevHoraStr);
    const currentMinutes = parseHoraToMinutes(currentHoraStr);

    if (prevMinutes != null && currentMinutes != null) {
      const comForThisRow = comMinutes ?? 0;
      const diff = currentMinutes - prevMinutes - comForThisRow;

      if (diff >= 0 && diff < 6 * 60) {
        conc = String(diff);
      } else {
        console.warn(
          "[FT] CONC calculé aberrant pour la ligne",
          i,
          "prevHora=",
          prevHoraStr,
          "hora=",
          currentHoraStr,
          "com=",
          comForThisRow,
          "diff=",
          diff
        );
      }
    }

    const radio = (entry as any).radio ?? "";
    const bloqueo = (entry as any).bloqueo ?? "";

    // Arrêt : ligne principale avec COM ou TECN non vide
    const hasComOrTecnico =
      (com && com.trim() !== "") || (tecnico && tecnico.trim() !== "");
    const isStopMainForHighlight = !!(hora && hasComOrTecnico);

    // Flag final pour le surlignage
    const shouldHighlightRow =
      isOriginOrDestinationForHighlight || isStopMainForHighlight;

    if (hora) {
      previousHoraForConc = hora;
    }

    const isCurrentlyVisible =
      i >= visibleRows.first && i <= visibleRows.last;

    // RC
    const isRcBreakpointHere = !!(entry as any).rc_bar && i !== firstNonNoteIndex;

    if (rcCurrentSegmentId === 0) rcCurrentSegmentId = 1;
    else if (isRcBreakpointHere) rcCurrentSegmentId++;

    const rawRamp =
      typeof (entry as any).rc === "number"
        ? (entry as any).rc.toString()
        : "";

    let ramp = "";

    const visibleStart = visibleRows.first;
    const visibleEnd = visibleRows.last;
    const targetVisible = visibleStart + 1;

    const isTargetVisibleRow =
      mainRowCounter >= targetVisible && mainRowCounter <= visibleEnd;

    if (
      !isRcBreakpointHere &&
      rawRamp !== "" &&
      rcCurrentSegmentId > 0 &&
      !rcPrintedSegments.has(rcCurrentSegmentId) &&
      isTargetVisibleRow
    ) {
      ramp = rawRamp;
      rcPrintedSegments.add(rcCurrentSegmentId);
    }

    const showRcBar = isRcBreakpointHere && i !== rawEntries.length - 1;

    const nivel = (entry as any).etcs ?? "①";

    // --- Vitesse par segment ---
    const segId = speedSegmentIndex[i] ?? 0;
    const labelRowIndex = segId > 0 ? segmentLabelRowIndex.get(segId) ?? null : null;
    const speedInfo = segId > 0 ? segmentSpeed.get(segId) ?? null : null;

    const currentSpeedText =
      speedInfo && typeof speedInfo.v === "number" ? String(speedInfo.v) : "";

    const isLabelRow = labelRowIndex === i;

    if (isLabelRow && segId > 0) {
      const segIsVisible = i >= visibleRows.first && i <= visibleRows.last;

      console.log(
        "[SCROLL INTELLIGENT VMAX]",
        "segment",
        segId,
        "| ligne principale =",
        i,
        "| visibleRows =",
        visibleRows.first,
        "→",
        visibleRows.last,
        "| segmentVisible =",
        segIsVisible,
        "| v =",
        currentSpeedText || "(aucune)"
      );
    }

    const isBreakpointRow =
      entry.pk &&
      breakpointsSet.has(entry.pk) &&
      entry.pk !== firstPk &&
      entry.pk !== lastPk;

    const showVBar = !!isBreakpointRow;

    let mainRowSpeedContent = "";
    let speedSpacerContent = "";

    if (isLabelRow && currentSpeedText) {
      if (showVBar) speedSpacerContent = currentSpeedText;
      else mainRowSpeedContent = currentSpeedText;
    } else if (segId > 0 && currentSpeedText && !vPrintedSegments.has(segId)) {
      const visibleStart2 = visibleRows.first;
      const visibleEnd2 = visibleRows.last;

      const labelIsVisible =
        labelRowIndex !== null &&
        labelRowIndex >= visibleStart2 &&
        labelRowIndex <= visibleEnd2;

      if (!labelIsVisible) {
        const segStillVisible = i >= visibleStart2 && i <= visibleEnd2;

        const targetVisible2 = visibleStart2 + 1;
        const isGoodSpot =
          mainRowCounter >= targetVisible2 && mainRowCounter <= visibleEnd2;

        if (segStillVisible && isGoodSpot) {
          speedSpacerContent = currentSpeedText;
          vPrintedSegments.add(segId);

          console.log(
            "[SCROLL INTELLIGENT VMAX] réaffiché sur ligne",
            i,
            "(mainRowCounter =",
            mainRowCounter,
            ") pour segment",
            segId,
            "valeur",
            currentSpeedText
          );
        }
      }
    }

    const showSpeedSpacer =
      speedSpacerContent && speedSpacerContent.trim() !== "";
    const showArrivalSpacer = horaArrivee && horaArrivee.trim() !== "";

    const highlightKind = csvHighlightByIndex[i];
    const isCsvStart = highlightKind === "bottom";
    const isCsvEnd = highlightKind === "top";

    let vmaxHighlightClass = "";
    if (highlightKind === "full") vmaxHighlightClass = " ft-v-csv-full";
    else if (highlightKind === "top") vmaxHighlightClass = " ft-v-csv-top";
    else if (highlightKind === "bottom") vmaxHighlightClass = " ft-v-csv-bottom";

    const pkForLog = entry.pk ?? "";
    const dependenciaForLog = entry.dependencia ?? "";
    console.log(
      "[CSV HIGHLIGHT]",
      "i=",
      i,
      "kind=",
      highlightKind,
      "pk=",
      pkForLog,
      "dependencia=",
      dependenciaForLog
    );

    const shouldRenderArrivalSpacer =
      showArrivalSpacer && !(hasNoteAfter && i < rawEntries.length - 1);

    // ⚠️ Ton code actuel utilise isOdd, ici on conserve EXACTEMENT le même comportement
    // via l'inférence : si les PK montent, on est "impaire" (tu avais ce switch ailleurs).
    // Comme tu ne passais pas isOdd à cette section, on reproduit le test au plus neutre :
    // => on considère "pair" si la portion est décroissante.
    // Si tu veux, je te le remets en paramètre pour 100% strict.
    const firstPkNum = Number(rawEntries[firstNonNoteIndex]?.pk ?? NaN);
    const lastPkNum = Number(rawEntries[lastNonNoteIndex]?.pk ?? NaN);
    const isOdd = Number.isFinite(firstPkNum) && Number.isFinite(lastPkNum) ? firstPkNum <= lastPkNum : true;

    if (!isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-inter" key={`note-before-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">{renderDependenciaCell(nextEntry as FTEntry)}</td>

          <td className="ft-td" />

          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    } else if (shouldRenderArrivalSpacer) {
      const vmaxClassForArrival = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-spacer" key={`arrival-${i}`}>
          <td className="ft-td"></td>

          <td className={"ft-td ft-v-cell" + vmaxClassForArrival}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          <td className="ft-td ft-hora-cell">
            <span className="ft-hora-arrivee">{horaArrivee}</span>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      renderedRowIndex++;
    }

    rows.push(
      <tr
        className={
          "ft-row-main" +
          (isCurrentlyVisible ? " ft-row-visible" : "") +
          (isSelected ? " ft-row-selected" : "")
        }
        key={`main-${i}`}
        data-ft-row={i}
        onClick={() => {
          if (referenceModeRef.current === "GPS") return;
          if (!hora || !depNorm) return;

          const isAlreadySelected = selectedRowIndex === i;

          if (!autoScrollEnabled && isAlreadySelected) {
            logTestEvent("ui:standby:resume", {
              rowIndex: i,
              hora,
              pk: entry?.pk ?? null,
              dependencia: entry?.dependencia ?? null,
              source: "ft:row-click",
            });

            recalibrateFromRowRef.current = i;

            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", { detail: { enabled: true } })
            );
            return;
          }

          setSelectedRowIndex(i);
          recalibrateFromRowRef.current = i;

          logTestEvent("ui:standby:enter", {
            rowIndex: i,
            hora,
            pk: entry?.pk ?? null,
            dependencia: entry?.dependencia ?? null,
            autoScrollWasEnabled: autoScrollEnabled,
            source: "ft:row-click",
          });

          if (autoScrollEnabled) {
            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", { detail: { enabled: false } })
            );

            window.dispatchEvent(
              new CustomEvent("lim:hourly-mode", { detail: { enabled: false, standby: true } })
            );
          }
        }}
      >
        {(() => {
          renderedRowIndex++;

          const isFirstRow = i === firstNonNoteIndex;
          const isFirstRowVisible = i >= visibleRows.first && i <= visibleRows.last;

          if (isFirstRow && isFirstRowVisible) {
            bloqueoPrintedInThisRender = true;
            return <td className="ft-td">{bloqueo}</td>;
          }

          const visibleStart3 = visibleRows.first;
          const visibleEnd3 = visibleRows.last;
          const targetVisible3 = visibleStart3 + 1;
          const isGoodSpot =
            mainRowCounter >= targetVisible3 && mainRowCounter <= visibleEnd3;

          if (!bloqueoPrintedInThisRender && isGoodSpot) {
            bloqueoPrintedInThisRender = true;
            return <td className="ft-td">{bloqueo}</td>;
          }

          return <td className="ft-td"></td>;
        })()}

        <td className={"ft-td ft-v-cell" + vmaxHighlightClass}>
          <div className="ft-v-inner">{mainRowSpeedContent}</div>
          {showVBar && <div className="ft-v-bar" />}
        </td>

        <td className={"ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")}>
          {sitKm}
        </td>

        <td className={"ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")}>
          {renderDependenciaCell(entry)}
        </td>

        <td className={"ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")}>
          {com}
        </td>

        <td className={"ft-td ft-hora-main" + (shouldHighlightRow ? " ft-highlight-cell" : "")}>
          {hora ? (
            <span className="ft-hora-depart">{hora}</span>
          ) : typeof horaTheoSecondsByIndexFull[i] === "number" ? (
            <span className="ft-hora-theo">
              {(() => {
                const sec = horaTheoSecondsByIndexFull[i] as number;
                const secondsInDay = 24 * 60 * 60;

                let t = sec % secondsInDay;
                if (t < 0) t += secondsInDay;

                const hh = Math.floor(t / 3600);
                const mm = Math.floor((t % 3600) / 60);
                const ss = Math.floor(t % 60);

                const pad = (n: number) => String(n).padStart(2, "0");
                return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
              })()}
            </span>
          ) : null}
        </td>

        <td className="ft-td">{tecnico}</td>
        <td className="ft-td">{conc}</td>

        <td className="ft-td">
          {(() => {
            const isFirstRow = i === firstNonNoteIndex;
            const isFirstRowVisible = i >= visibleRows.first && i <= visibleRows.last;

            if (isFirstRow && isFirstRowVisible) {
              radioPrintedInThisRender = true;
              return radio;
            }

            const visibleStart4 = visibleRows.first;
            const visibleEnd4 = visibleRows.last;
            const targetVisible4 = visibleStart4 + 1;
            const isGoodSpot =
              mainRowCounter >= targetVisible4 && mainRowCounter <= visibleEnd4;

            if (!radioPrintedInThisRender && isGoodSpot) {
              radioPrintedInThisRender = true;
              return radio;
            }

            return "";
          })()}
        </td>

        <td className="ft-td ft-rc-cell" id={`rc-cell-${i}`}>
          {showRcBar ? <div className="ft-rc-bar" /> : <div className="ft-rc-value">{ramp}</div>}
        </td>

        <td className="ft-td ft-td-nivel">{nivel}</td>
      </tr>
    );

    mainRowCounter++;

    if (isCsvStart) csvZoneOpen = true;
    else if (isCsvEnd) csvZoneOpen = false;

    if (isCsvEnd) {
      // ton comportement actuel
      csvHighlightByIndex[i] = "full";
    }

    if (showSpeedSpacer) {
      const vmaxClassForSpeed = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-spacer" key={`speed-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForSpeed}>
            <div className="ft-v-inner text-center">{speedSpacerContent}</div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          <td className="ft-td ft-hora-cell" />

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    }

    if (isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-inter" key={`note-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">{renderDependenciaCell(nextEntry as FTEntry)}</td>

          <td className="ft-td" />

          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      i++;
    }
  }

  return { rows, arrivalEvents };
}
