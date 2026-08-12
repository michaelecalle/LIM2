// Adaptateur du normalisé 2026 vers le type FTEntry consommé par le bloc fiche
// train (FT.tsx, FTHorizontal.tsx, FTHorizontalSchedule.tsx).
//
// STRATÉGIE : produire EXACTEMENT la même forme que
// `ligneFT.normalized.adapter.ts` (getFtLignePair / getFtLigneImpair) pour que le
// code de rendu n'ait pas à changer de contrat. Seule la source change.
//
// Correspondances (vérifiées sur le fichier publié) :
//   bloc → bloqueo · rampe → rc · etablissement → dependencia
//   pkAdif/pkLfp/pkRfn → pk_adif/pk_lfp/pk_rfn · pkRac → pk_rac (NOUVEAU)
//   vmax / csv / radio / etcs : directs
//   horaires du train → arrivee / passage / depart (3 colonnes explicites, plus
//   de `hora` unique ni de `com`/`tecn`/`conc` calculés)
//
// Absents du 2026, donc reconstruits ici : `reseau` (déduit du PK renseigné) et
// les barres de zone (calculées, comme dans l'ancien adaptateur).

import type { FTEntry } from "./ligneFT";
// Normalisé 2026 PUBLIÉ par l'éditeur (écrit dans ce dépôt par « Publier »).
// Import STATIQUE : il part dans le bundle, donc disponible hors ligne — même
// principe que l'ancien normalisé, volontairement conservé (décision 11/08).
// ⚠️ Ce fichier est protégé dans PUSH.bat : ne jamais l'éditer à la main.
import ligneFt2026Published from "./normalized/ligneFT2026.normalized.json";

type Direction = "sudNord" | "nordSud";

type LigneRow2026 = {
  type?: "note";
  texte?: string;
  position?: "au-dessus" | "en-dessous";
  surligne?: boolean;

  bloc?: string;
  vmax?: string;
  csv?: boolean;
  radio?: string;
  rampe?: string;
  etcs?: string;
  etablissement?: string;

  pkAdif?: string;
  pkLfp?: string;
  pkRac?: string;
  pkRfn?: string;
  pkInterne?: string;
};

type Horaire2026 = { arrivee?: string; passage?: string; depart?: string };

export type LigneFt2026Doc = {
  ligneVersions?: Record<
    string,
    { sudNord?: LigneRow2026[]; nordSud?: LigneRow2026[] }
  >;
  trains?: Record<
    string,
    {
      variants?: Array<{
        ligneVersionId?: string;
        meta?: { direction?: string; horaires?: Record<string, Horaire2026> };
      }>;
    }
  >;
};

// Ordre des référentiels PK DANS LE SENS DE MARCHE. Sert au PK affiché (empilé
// aux transitions) et à la déduction du réseau. Repris de `kmDisplay()` de
// l'éditeur (`buildFtRows2026.ts`), déjà validé visuellement.
const PK_FIELDS_BY_DIRECTION: Record<Direction, ReadonlyArray<keyof LigneRow2026>> = {
  sudNord: ["pkAdif", "pkLfp", "pkRac", "pkRfn"],
  nordSud: ["pkRfn", "pkRac", "pkLfp", "pkAdif"],
};

// RAC (raccordement) est rattaché à LFP : cohérent avec `networkFromSkm()`
// (gpsPkEngine), qui regroupe déjà LFP_MAIN + LFP_LINK sous "LFP".
const NETWORK_OF_FIELD: Record<string, "ADIF" | "LFP" | "RFN"> = {
  pkAdif: "ADIF",
  pkLfp: "LFP",
  pkRac: "LFP",
  pkRfn: "RFN",
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

/** PK non vides, dans l'ordre du sens de marche (le réseau quitté d'abord). */
function pkFieldsPresent(row: LigneRow2026, direction: Direction): string[] {
  return PK_FIELDS_BY_DIRECTION[direction].filter(
    (f) => str(row[f]) !== undefined
  ) as string[];
}

/**
 * Clé de jointure avec les horaires du train : PK composite `adif|lfp|rac|rfn`,
 * exactement la clé produite par l'éditeur (`identityKey`).
 */
function horaireKey(row: LigneRow2026): string {
  return [row.pkAdif ?? "", row.pkLfp ?? "", row.pkRac ?? "", row.pkRfn ?? ""].join("|");
}

/**
 * Ajoute une barre de zone au changement de valeur. Patron unique repris des 4
 * fonctions de l'ancien adaptateur (addVmaxBars / addRcBars / addBloqueoBars /
 * addRadioBars) — la valeur est PROPAGÉE quand la ligne ne la porte pas.
 */
function addZoneBars(
  entries: FTEntry[],
  read: (e: FTEntry) => string | number | undefined,
  mark: (e: FTEntry) => FTEntry
): FTEntry[] {
  let previous: string | number | undefined;
  let hasPreviousDataRow = false;

  return entries.map((entry) => {
    if (entry.isNoteOnly) return entry;

    const raw = read(entry);
    const current = raw !== undefined ? raw : previous;

    if (!hasPreviousDataRow) {
      hasPreviousDataRow = true;
      previous = current;
      return entry;
    }

    const shouldAddBar = current !== previous;
    previous = current;

    return shouldAddBar ? mark(entry) : entry;
  });
}

function buildFtEntries2026(
  rows: LigneRow2026[],
  direction: Direction,
  horaires: Record<string, Horaire2026>
): FTEntry[] {
  const entries: FTEntry[] = rows.map((row) => {
    // --- Ligne de note ---
    if (row.type === "note") {
      const texte = str(row.texte) ?? "";
      return {
        pk: "",
        dependencia: "",
        isNoteOnly: true,
        // ⚠️ UNIQUEMENT `notes` (tableau), JAMAIS `note` en plus : le rendu
        // VERTICAL prend l'un OU l'autre, mais FTHorizontal empile les DEUX
        // (`rowNotes.push(e.note)` puis `push(...e.notes)`) → chaque remarque
        // rouge apparaîtrait deux fois. Bug constaté en test le 11/08.
        notes: texte ? [texte] : [],
        // Surlignage pêche (champ `surligne` du 2026). Le PLACEMENT (`position`)
        // n'est volontairement PAS traité pour l'instant (décision 11/08).
        noteSurligne: row.surligne === true,
      } as FTEntry;
    }

    // --- Ligne de données ---
    const present = pkFieldsPresent(row, direction);
    const pkDisplay = present
      .map((f) => str(row[f as keyof LigneRow2026]))
      .filter(Boolean)
      .join("\n");

    const entry: FTEntry = {
      // `pk` = PK CONTINU INTERNE (615.9 → 805.5), comme dans l'ancien format.
      // ⚠️ NE PAS y mettre le PK du réseau : `pk` sert aux CALCULS (plage de PK
      // du parcours qui filtre les LTV, zones CSV, breakpoints...) et doit rester
      // MONOTONE sur tout le trajet. Avec un PK par réseau, Barcelone donnait
      // 621.0 (ADIF) et Perpignan 467.5 (RFN) → plage [467.5 ; 621.0] et LTV
      // totalement fausses (bug constaté en test le 11/08).
      // L'affichage, lui, passe par `pk_display` (PK réseau, empilé aux transitions).
      pk: str(row.pkInterne) ?? "",
      dependencia: str(row.etablissement) ?? "",
    };

    // PK affiché : empilé seulement s'il y a réellement plusieurs référentiels.
    if (pkDisplay) entry.pk_display = pkDisplay;

    const network = present.length > 0 ? NETWORK_OF_FIELD[present[0]] : undefined;
    if (network) entry.network = network;

    const pkAdif = str(row.pkAdif);
    const pkLfp = str(row.pkLfp);
    const pkRac = str(row.pkRac);
    const pkRfn = str(row.pkRfn);
    if (pkAdif) entry.pk_adif = pkAdif;
    if (pkLfp) entry.pk_lfp = pkLfp;
    if (pkRac) entry.pk_rac = pkRac;
    if (pkRfn) entry.pk_rfn = pkRfn;

    const pkInternal = num(row.pkInterne);
    if (pkInternal !== undefined) entry.pk_internal = pkInternal;

    const bloqueo = str(row.bloc);
    if (bloqueo) entry.bloqueo = bloqueo;

    const vmax = num(row.vmax);
    if (vmax !== undefined) entry.vmax = vmax;
    if (row.csv === true) entry.vmax_highlight = true;

    const radio = str(row.radio);
    if (radio) entry.radio = radio;

    const rc = num(row.rampe);
    if (rc !== undefined) entry.rc = rc;

    const etcs = str(row.etcs);
    if (etcs) entry.etcs = etcs;

    // --- Horaires du train : 3 colonnes explicites, aucune conversion ---
    const h = horaires[horaireKey(row)];
    if (h) {
      const arrivee = str(h.arrivee);
      const passage = str(h.passage);
      const depart = str(h.depart);
      if (arrivee) entry.arrivee = arrivee;
      if (passage) entry.passage = passage;
      if (depart) entry.depart = depart;

      // (Le pont de compatibilité `hora`/`com` a été retiré le 11/08 : tous les
      // consommateurs — bloc horaire horizontal, « prochain arrêt », détection
      // d'arrêt, stand-by — lisent désormais directement arrivee/passage/depart.)
    }

    // Clé de traçabilité (l'ancien format utilisait `rowKey` pour la jointure ;
    // ici la jointure est déjà faite, on la conserve pour le débogage).
    entry.rowKey = horaireKey(row);

    return entry;
  });

  // Barres de zone — mêmes règles que l'ancien adaptateur, plus ETCS (nouveau).
  let out = addZoneBars(entries, (e) => e.vmax, (e) => ({ ...e, vmax_bar: true }));
  out = addZoneBars(out, (e) => e.rc, (e) => ({ ...e, rc_bar: true }));
  out = addZoneBars(out, (e) => e.bloqueo, (e) => ({ ...e, bloqueo_bar: 1 }));
  out = addZoneBars(out, (e) => e.radio, (e) => ({ ...e, radio_bar: true }));
  out = addZoneBars(out, (e) => e.etcs, (e) => ({ ...e, etcs_bar: true }));

  return out;
}

/** Version de ligne référencée par le train, sinon la première disponible. */
function resolveLigneRows(
  doc: LigneFt2026Doc,
  trainNumber: number | string | null | undefined,
  direction: Direction
): { rows: LigneRow2026[]; horaires: Record<string, Horaire2026> } {
  const versions = doc?.ligneVersions ?? {};
  const key = String(trainNumber ?? "").trim();
  const variant = key ? doc?.trains?.[key]?.variants?.[0] : undefined;

  const versionId =
    (variant?.ligneVersionId && versions[variant.ligneVersionId]
      ? variant.ligneVersionId
      : Object.keys(versions)[0]) ?? "";

  return {
    rows: versions[versionId]?.[direction] ?? [],
    horaires: variant?.meta?.horaires ?? {},
  };
}

// Mêmes noms/sémantique que l'ancien adaptateur : « Pair » = jeu sudNord,
// « Impair » = jeu nordSud (nommage historique conservé pour ne rien casser).
export function getFtLignePair2026(
  doc: LigneFt2026Doc,
  trainNumber: number | string | null | undefined
): FTEntry[] {
  const { rows, horaires } = resolveLigneRows(doc, trainNumber, "sudNord");
  return buildFtEntries2026(rows, "sudNord", horaires);
}

export function getFtLigneImpair2026(
  doc: LigneFt2026Doc,
  trainNumber: number | string | null | undefined
): FTEntry[] {
  const { rows, horaires } = resolveLigneRows(doc, trainNumber, "nordSud");
  return buildFtEntries2026(rows, "nordSud", horaires);
}

// ---------------------------------------------------------------------------
// Point d'entrée du bloc fiche train : MÊMES SIGNATURES que l'ancien
// adaptateur, pour que les composants n'aient qu'une ligne d'import à changer.
// ---------------------------------------------------------------------------

const PUBLISHED_DOC = ligneFt2026Published as unknown as LigneFt2026Doc;

export function getFtLignePair(
  trainNumber: number | string | null | undefined
): FTEntry[] {
  return getFtLignePair2026(PUBLISHED_DOC, trainNumber);
}

export function getFtLigneImpair(
  trainNumber: number | string | null | undefined
): FTEntry[] {
  return getFtLigneImpair2026(PUBLISHED_DOC, trainNumber);
}

/** Métadonnées du train dans le normalisé publié (1re variante). */
function trainMeta(trainNumber: number | string | null | undefined) {
  const key = String(trainNumber ?? "").trim();
  if (!key) return undefined;
  return PUBLISHED_DOC.trains?.[key]?.variants?.[0]?.meta as
    | { origine?: string; destination?: string }
    | undefined;
}

export function getTrainOrigine(
  trainNumber: number | string | null | undefined
): string | undefined {
  return str(trainMeta(trainNumber)?.origine);
}

export function getTrainDestination(
  trainNumber: number | string | null | undefined
): string | undefined {
  return str(trainMeta(trainNumber)?.destination);
}
