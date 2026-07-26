// Gestion du pli/dépli du tableau LTV depuis un clic sur une zone LTV de la
// fiche train. Logique unique partagée par les DEUX fiches (verticale FT.tsx et
// horizontale FTHorizontal.tsx) pour garantir un comportement identique.
//
// Comportement (validé avec l'utilisateur) :
//   - tableau plié               → on ouvre et on cible la LTV cliquée ;
//   - tableau ouvert, MÊME LTV   → on replie ;
//   - tableau ouvert, AUTRE LTV  → on reste ouvert et on recentre sur elle.

export type LtvFocusRef = { current: { a: number; b: number } | null };

const SAME_EPS = 0.001;  // km : tolérance pour considérer deux LTV comme identiques

export function onLtvZoneClick(
  folded: boolean,
  lastFocus: LtvFocusRef,
  pkA: number,
  pkB: number,
): void {
  const a = Math.min(pkA, pkB);
  const b = Math.max(pkA, pkB);
  const prev = lastFocus.current;
  const same =
    prev != null && Math.abs(prev.a - a) < SAME_EPS && Math.abs(prev.b - b) < SAME_EPS;

  // Tableau déjà ouvert sur cette même LTV → on replie.
  if (!folded && same) {
    window.dispatchEvent(
      new CustomEvent("lim:infos-ltv-fold-change", { detail: { folded: true, source: "ltv-click" } }),
    );
    return;
  }

  // Sinon : ouvrir (si plié) ou recentrer sur une autre LTV (si déjà ouvert).
  window.dispatchEvent(
    new CustomEvent("lim:infos-ltv-fold-change", { detail: { folded: false, source: "ltv-click" } }),
  );
  window.dispatchEvent(
    new CustomEvent("lim:ltv-focus", { detail: { pkA, pkB } }),
  );
  lastFocus.current = { a, b };
}
