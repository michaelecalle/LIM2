import * as React from "react";
import type { CsvSens } from "../../data/ligneFT";
import { logTestEvent } from "../../lib/testLogger";

type VisibleRows = { first: number; last: number };

type UseScrollViewportArgs = {
  autoScrollEnabled: boolean;
  autoScrollEnabledRef: React.MutableRefObject<boolean>;
  referenceModeRef: React.MutableRefObject<"HORAIRE" | "GPS">;
  // si tu veux, on peut virer currentCsvSens ici : pas utile pour le scroll
  currentCsvSens?: CsvSens | null;
};

type UseScrollViewportResult = {
  visibleRows: VisibleRows;
  setVisibleRows: React.Dispatch<React.SetStateAction<VisibleRows>>;

  scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  setContainerRef: (el: HTMLDivElement | null) => void;

  isManualScrollRef: React.MutableRefObject<boolean>;
  manualScrollTimeoutRef: React.MutableRefObject<number | null>;
  lastAutoScrollTopRef: React.MutableRefObject<number | null>;
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;

  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
};

export function useScrollViewport(args: UseScrollViewportArgs): UseScrollViewportResult {
  const { autoScrollEnabled, autoScrollEnabledRef, referenceModeRef } = args;

  const [visibleRows, setVisibleRows] = React.useState<VisibleRows>({
    first: 0,
    last: 0,
  });

  // Référence vers le conteneur scrollable
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Suivi du scroll manuel pendant que le mode horaire est actif
  const isManualScrollRef = React.useRef(false);
  const manualScrollTimeoutRef = React.useRef<number | null>(null);
  const lastAutoScrollTopRef = React.useRef<number | null>(null);
  const isProgrammaticScrollRef = React.useRef(false);

  const setContainerRef = React.useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
  }, []);

  const handleScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      scrollContainerRef.current = el;

      const scrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;

      // --- Gestion scroll manuel vs scroll automatique ---
      if (autoScrollEnabled) {
        if (isProgrammaticScrollRef.current) {
          // Scroll provoqué par notre code (auto-scroll) → on ne déclenche pas le mode manuel
          isProgrammaticScrollRef.current = false;
          // On met à jour la position "officielle" de l'auto-scroll
          lastAutoScrollTopRef.current = scrollTop;
        } else {
          // Scroll manuel utilisateur pendant que le mode horaire est actif
          isManualScrollRef.current = true;

          // On relance un timer de 5s à chaque nouveau mouvement manuel
          if (manualScrollTimeoutRef.current !== null) {
            window.clearTimeout(manualScrollTimeoutRef.current);
          }

          manualScrollTimeoutRef.current = window.setTimeout(() => {
            manualScrollTimeoutRef.current = null;
            isManualScrollRef.current = false;

            const container = scrollContainerRef.current;
            if (!container) return;
            if (!autoScrollEnabledRef.current) return;

            const target = lastAutoScrollTopRef.current;
            if (target == null) return;

            // On revient à la position auto d'avant le scroll manuel
            isProgrammaticScrollRef.current = true;
            container.scrollTo({
              top: target,
              behavior: "auto",
            });
          }, 5000);
        }
      } else {
        // Mode horaire coupé → on désactive toute logique de retour auto
        isManualScrollRef.current = false;
        if (manualScrollTimeoutRef.current !== null) {
          window.clearTimeout(manualScrollTimeoutRef.current);
          manualScrollTimeoutRef.current = null;
        }
      }

      // 1) on récupère les lignes principales
      const rowEls = el.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
      if (!rowEls.length) return;

      // 2) première ligne dont le bas est sous le haut du viewport
      let firstVisible = 0;
      for (let i = 0; i < rowEls.length; i++) {
        const r = rowEls[i];
        const top = r.offsetTop;
        const bottom = top + r.offsetHeight;
        if (bottom >= scrollTop) {
          firstVisible = i;
          break;
        }
      }

      // 3) dernière ligne dont le haut est encore dans le viewport
      const viewportBottom = scrollTop + clientHeight;
      let lastVisible = firstVisible;
      for (let i = firstVisible; i < rowEls.length; i++) {
        const r = rowEls[i];
        const top = r.offsetTop;
        if (top <= viewportBottom) {
          lastVisible = i;
        } else {
          break;
        }
      }

      // 🔎 Debug : mapping "index dans rowEls" -> "data-ft-row"
      const firstDataAttr = rowEls[firstVisible]?.getAttribute("data-ft-row") ?? "";
      const lastDataAttr = rowEls[lastVisible]?.getAttribute("data-ft-row") ?? "";
      const firstDataRow = firstDataAttr ? parseInt(firstDataAttr, 10) : null;
      const lastDataRow = lastDataAttr ? parseInt(lastDataAttr, 10) : null;

      console.log(
        "[FT][scroll] scrollTop=",
        scrollTop,
        " / clientHeight=",
        clientHeight,
        " / rows=",
        rowEls.length
      );
      console.log("[FT][visible-rows] first=", firstVisible, "last=", lastVisible);

      console.log(
        "[FT][VISIBLE_ROWS_DATA_ROW]",
        "firstVisible=",
        firstVisible,
        "lastVisible=",
        lastVisible,
        "| firstAttr=",
        firstDataAttr,
        "lastAttr=",
        lastDataAttr,
        "| firstDataRow=",
        firstDataRow,
        "lastDataRow=",
        lastDataRow
      );

      // on met à jour le state : ✅ indices "réels" (data-ft-row) si disponibles
      const nextFirst =
        typeof firstDataRow === "number" && Number.isFinite(firstDataRow)
          ? firstDataRow
          : firstVisible;

      const nextLast =
        typeof lastDataRow === "number" && Number.isFinite(lastDataRow)
          ? lastDataRow
          : lastVisible;

      setVisibleRows({ first: nextFirst, last: nextLast });
    },
    [autoScrollEnabled, autoScrollEnabledRef, referenceModeRef]
  );

  return {
    visibleRows,
    setVisibleRows,

    scrollContainerRef,
    setContainerRef,

    isManualScrollRef,
    manualScrollTimeoutRef,
    lastAutoScrollTopRef,
    isProgrammaticScrollRef,

    handleScroll,
  };
}
