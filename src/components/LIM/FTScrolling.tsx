import React, { useState, useEffect, useRef } from "react";

interface FTScrollingProps {
  children: React.ReactNode;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void; // le parent peut écouter le scroll
  onContainerRef?: (el: HTMLDivElement | null) => void; // le parent récupère le conteneur scrollable
  overlay?: React.ReactNode; // ✅ nouveau : contenu overlay (indicateur position, etc.)
}

const FTScrolling: React.FC<FTScrollingProps> = ({
  children,
  onScroll,
  onContainerRef,
  overlay,
}) => {
  const [maxHeight, setMaxHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateMaxHeight = (reason: string) => {
      if (!containerRef.current) return;

      const rectTop = containerRef.current.getBoundingClientRect().top;
      const availableHeight = window.innerHeight - rectTop;

      console.log(
        "[FTScrolling][MAX_HEIGHT]",
        "reason=",
        reason,
        "| innerHeight=",
        window.innerHeight,
        "| top=",
        Math.round(rectTop),
        "| maxHeight=",
        Math.round(availableHeight)
      );

      setMaxHeight(availableHeight);
    };

    const onResize = () => updateMaxHeight("resize");

    const onFoldChange = () => {
      // iPad : laisser le DOM se reflow avant de mesurer
      requestAnimationFrame(() => {
        // 1) mesure immédiate (proche du toggle)
        window.setTimeout(() => {
          updateMaxHeight("fold-change@0ms");
        }, 0);

        // 2) mesure retardée (layout iOS parfois stabilisé plus tard)
        window.setTimeout(() => {
          updateMaxHeight("fold-change@120ms");
        }, 120);
      });
    };

    const onPdfModeChange = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const mode = ce?.detail?.mode as "blue" | "green" | "red" | undefined;
      if (mode === "green") {
        // après import, le layout bouge : on re-mesure
        requestAnimationFrame(() => {
          window.setTimeout(() => updateMaxHeight("pdf-mode-green@0ms"), 0);
          window.setTimeout(() => updateMaxHeight("pdf-mode-green@120ms"), 120);
        });
      }
    };

    // ✅ Mesure initiale au montage
    requestAnimationFrame(() => {
      updateMaxHeight("mount@raf");
      window.setTimeout(() => updateMaxHeight("mount@0ms"), 0);
      window.setTimeout(() => updateMaxHeight("mount@120ms"), 120);
    });

    const onLtvLayoutStable = () => {
      requestAnimationFrame(() => {
        window.setTimeout(() => updateMaxHeight("ltv-layout-stable@0ms"), 0);
        window.setTimeout(() => updateMaxHeight("ltv-layout-stable@120ms"), 120);
      });
    };

    window.addEventListener("resize", onResize);
    window.addEventListener(
      "lim:infos-ltv-fold-change",
      onFoldChange as EventListener
    );
    window.addEventListener("lim:pdf-mode-change", onPdfModeChange as EventListener);
    window.addEventListener("ltv:layout-stable", onLtvLayoutStable as EventListener);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener(
        "lim:infos-ltv-fold-change",
        onFoldChange as EventListener
      );
      window.removeEventListener("lim:pdf-mode-change", onPdfModeChange as EventListener);
      window.removeEventListener("ltv:layout-stable", onLtvLayoutStable as EventListener);
    };

  }, []);



  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (onContainerRef) {
          onContainerRef(el);
        }
      }}
      style={{
        // ⚠️ 14/08 — dimensionnement par FLEX, plus par auto-mesure.
        // L'ancien `maxHeight: innerHeight − top` était la béquille compensant
        // la page sans plafond : mesuré trop tôt il valait parfois 0 (fiche
        // invisible), et il était recalé à coups de setTimeout sur chaque
        // pli/dépli (fragile iPad). Depuis que l'app est plafonnée à l'écran
        // (App `h-[100dvh]`) et que le wrapper de la fiche est une colonne
        // flex, `flex: 1` donne exactement la hauteur restante — en continu,
        // sans mesure. `maxHeight` est conservé en garde-fou UNIQUEMENT s'il
        // est plausible (> 100 px), le temps de valider sur iPad.
        flex: "1 1 0%",
        minHeight: 0,
        maxHeight: maxHeight > 100 ? maxHeight : undefined,
        overflowY: "auto",
        position: "relative", // ✅ nécessaire pour l’overlay
      }}
      // ⚠️ 14/08 — BORDURE-TÉMOIN (idée de l'utilisateur), stylée dans FT.tsx
      // (`.ft-scroll-frame`) pour suivre le thème jour/nuit. Elle borne le CADRE
      // défilant, pas le tableau : elle reste donc toujours en bas de la zone
      // visible. D'où sa vertu de contrôle immédiat — bordure visible = la fiche
      // tient dans l'écran ; bordure absente = elle déborde. Posée sur le
      // tableau, elle défilerait avec le contenu et ne prouverait rien.
      className="ft-scroll-frame"
      onScroll={onScroll} // c’est CE conteneur qui scroll
    >
      {/* ✅ Couche overlay "collée au viewport" du conteneur scrollable */}
      {overlay ? (
        <div
          style={{
            position: "sticky",
            top: 0,
            left: 0,
            right: 0,
            height: 0, // n’occupe pas d’espace
            pointerEvents: "none",
            zIndex: 50,
          }}
        >
          {overlay}
        </div>
      ) : null}

      {children}
    </div>
  );
};

export default FTScrolling;
