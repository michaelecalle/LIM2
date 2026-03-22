// src/data/ligneFT.normalized.adapter.ts

import { LIGNE_FT_NORMALIZED } from "./normalized/ligneFT.normalized";
import type { FTEntry, FtNetwork } from "./ligneFT";

type NormalizedRow = (typeof LIGNE_FT_NORMALIZED)["nordSud"]["rows"][number];
type CsvSens = "PAIR" | "IMPAIR";

type CsvZone = {
  sens: CsvSens;
  pkFrom: number;
  pkTo: number;
  ignoreIfFirst?: boolean;
};

function asNonEmptyString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function asOptionalNumber(value: string | undefined | null): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asOptionalNetwork(value: string | undefined | null): FtNetwork | undefined {
  const trimmed = asNonEmptyString(value);
  if (trimmed === "RFN" || trimmed === "LFP" || trimmed === "ADIF") {
    return trimmed;
  }
  return undefined;
}

function mapDataRow(row: NormalizedRow): FTEntry {
  const entry: FTEntry = {
    pk: row.sitKm,
    dependencia: row.dependencia,
    ...(row.csv ? { csv: true } : {}),
  };

  const network = asOptionalNetwork(row.reseau);
  if (network) entry.network = network;

  const pkInternal = asOptionalNumber(row.pkInterne);
  if (pkInternal !== undefined) entry.pk_internal = pkInternal;

  const pkAdif = asNonEmptyString(row.pkAdif);
  if (pkAdif) entry.pk_adif = pkAdif;

  const pkLfp = asNonEmptyString(row.pkLfp);
  if (pkLfp) entry.pk_lfp = pkLfp;

  const pkRfn = asNonEmptyString(row.pkRfn);
  if (pkRfn) entry.pk_rfn = pkRfn;

  const bloqueo = asNonEmptyString(row.bloqueo);
  if (bloqueo) entry.bloqueo = bloqueo;

  const radio = asNonEmptyString(row.radio);
  if (radio) entry.radio = radio;

  const vmax = asOptionalNumber(row.vmax);
  if (vmax !== undefined) entry.vmax = vmax;

  const rc = asOptionalNumber(row.rampCaract);
  if (rc !== undefined) entry.rc = rc;

  const etcs = asNonEmptyString((row as any).etcs);
  if (etcs !== undefined) entry.etcs = etcs;

  return entry;
}

function mapNoteRow(row: NormalizedRow): FTEntry {
  const entry: FTEntry = {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: row.notes,
    ...(row.csv ? { csv: true } : {}),
  };

  const bloqueo = asNonEmptyString(row.bloqueo);
  if (bloqueo) entry.bloqueo = bloqueo;

  const radio = asNonEmptyString(row.radio);
  if (radio) entry.radio = radio;

  const rc = asOptionalNumber(row.rampCaract);
  if (rc !== undefined) entry.rc = rc;

  return entry;
}

function mapRow(row: NormalizedRow): FTEntry {
  if (row.type === "note") return mapNoteRow(row);
  return mapDataRow(row);
}

function getRowPkNumber(row: NormalizedRow): number | undefined {
  if (row.type !== "data") return undefined;
  const parsed = Number((row.sitKm ?? "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reconstruit les zones CSV dans l'ordre AFFICHÉ.
 *
 * Règle :
 * - une séquence contiguë de lignes data csv:true ouvre une zone
 * - si la séquence se termine sur une vraie ligne data csv:false,
 *   cette ligne false devient la borne basse visuelle de la zone
 * - si la séquence est coupée par une note (ou fin de tableau),
 *   on s'arrête à la dernière ligne csv:true
 */
function buildCsvZonesFromDisplayedRows(rows: NormalizedRow[], sens: CsvSens): CsvZone[] {
  const zones: CsvZone[] = [];

  const firstDataIndex = rows.findIndex((row) => getRowPkNumber(row) !== undefined);

  let sequenceStartIndex: number | null = null;
  let sequenceStartPk: number | null = null;
  let lastTruePk: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const pk = getRowPkNumber(row);

    const isDataRow = row.type === "data" && pk !== undefined;
    const isCsvTrueDataRow = isDataRow && row.csv === true;

    if (isCsvTrueDataRow) {
      if (sequenceStartIndex === null) {
        sequenceStartIndex = i;
        sequenceStartPk = pk!;
      }
      lastTruePk = pk!;
      continue;
    }

    // Une note ne coupe jamais une séquence CSV en cours.
    if (row.type === "note") {
      continue;
    }

    if (sequenceStartIndex !== null && sequenceStartPk !== null && lastTruePk !== null) {
      let zoneEndPk = lastTruePk;

      // La séquence CSV se termine sur cette vraie ligne data non-csv :
      // elle devient la borne basse visuelle de la zone.
      if (isDataRow && pk !== undefined) {
        zoneEndPk = pk;
      }

      zones.push({
        sens,
        pkFrom: sequenceStartPk,
        pkTo: zoneEndPk,
        ...(sequenceStartIndex === firstDataIndex ? { ignoreIfFirst: true } : {}),
      });

      sequenceStartIndex = null;
      sequenceStartPk = null;
      lastTruePk = null;
    }
  }

  if (sequenceStartIndex !== null && sequenceStartPk !== null && lastTruePk !== null) {
    zones.push({
      sens,
      pkFrom: sequenceStartPk,
      pkTo: lastTruePk,
      ...(sequenceStartIndex === firstDataIndex ? { ignoreIfFirst: true } : {}),
    });
  }

  return zones;
}

function addVmaxBars(entries: FTEntry[]): FTEntry[] {
  let previousEffectiveVmax: number | undefined = undefined;
  let hasPreviousDataRow = false;

  return entries.map((entry) => {
    if (entry.isNoteOnly) return entry;

    const currentEffectiveVmax =
      entry.vmax !== undefined ? entry.vmax : previousEffectiveVmax;

    if (!hasPreviousDataRow) {
      hasPreviousDataRow = true;
      previousEffectiveVmax = currentEffectiveVmax;
      return entry;
    }

    const shouldAddBar = currentEffectiveVmax !== previousEffectiveVmax;
    previousEffectiveVmax = currentEffectiveVmax;

    if (!shouldAddBar) return entry;

    return { ...entry, vmax_bar: true };
  });
}

function addRcBars(entries: FTEntry[]): FTEntry[] {
  let previousRc: number | undefined = undefined;
  let hasPreviousDataRow = false;

  return entries.map((entry) => {
    if (entry.isNoteOnly) return entry;

    const currentRc = entry.rc;

    if (!hasPreviousDataRow) {
      hasPreviousDataRow = true;
      previousRc = currentRc;
      return entry;
    }

    const shouldAddBar = currentRc !== previousRc;
    previousRc = currentRc;

    if (!shouldAddBar) return entry;

    return { ...entry, rc_bar: true };
  });
}

function addBloqueoBars(entries: FTEntry[]): FTEntry[] {
  let previousEffectiveBloqueo: string | undefined = undefined;
  let hasPreviousDataRow = false;

  return entries.map((entry) => {
    if (entry.isNoteOnly) return entry;

    const currentEffectiveBloqueo =
      entry.bloqueo !== undefined ? entry.bloqueo : previousEffectiveBloqueo;

    if (!hasPreviousDataRow) {
      hasPreviousDataRow = true;
      previousEffectiveBloqueo = currentEffectiveBloqueo;
      return entry;
    }

    const shouldAddBar = currentEffectiveBloqueo !== previousEffectiveBloqueo;
    previousEffectiveBloqueo = currentEffectiveBloqueo;

    if (!shouldAddBar) return entry;

    return { ...entry, bloqueo_bar: 1 };
  });
}

function addRadioBars(entries: FTEntry[]): FTEntry[] {
  let previousEffectiveRadio: string | undefined = undefined;
  let hasPreviousDataRow = false;

  return entries.map((entry) => {
    if (entry.isNoteOnly) return entry;

    const currentEffectiveRadio =
      entry.radio !== undefined ? entry.radio : previousEffectiveRadio;

    if (!hasPreviousDataRow) {
      hasPreviousDataRow = true;
      previousEffectiveRadio = currentEffectiveRadio;
      return entry;
    }

    const shouldAddBar = currentEffectiveRadio !== previousEffectiveRadio;
    previousEffectiveRadio = currentEffectiveRadio;

    if (!shouldAddBar) return entry;

    return { ...entry, radio_bar: true };
  });
}

// Jeux de données historiques conservés pour FT.tsx
const pairBase: FTEntry[] = LIGNE_FT_NORMALIZED.sudNord.rows.map(mapRow);
const impairBase: FTEntry[] = LIGNE_FT_NORMALIZED.nordSud.rows.map(mapRow);

export const FT_LIGNE_PAIR: FTEntry[] =
  addRadioBars(addBloqueoBars(addRcBars(addVmaxBars(pairBase))));

export const FT_LIGNE_IMPAIR: FTEntry[] =
  addRadioBars(addBloqueoBars(addRcBars(addVmaxBars(impairBase))));

// CSV_ZONES reconstruites dans l'ordre affiché réel
// - PAIR   = train pair = nordSud affiché en ordre inversé
// - IMPAIR = train impair = sudNord affiché tel quel
export const CSV_ZONES: CsvZone[] = [
  ...buildCsvZonesFromDisplayedRows(
    [...LIGNE_FT_NORMALIZED.nordSud.rows].reverse(),
    "PAIR"
  ),
  ...buildCsvZonesFromDisplayedRows(
    LIGNE_FT_NORMALIZED.sudNord.rows,
    "IMPAIR"
  ),
];

function debugCsvZoneWindow(
  label: string,
  rows: NormalizedRow[],
  pks: string[]
) {
  const wanted = new Set(pks);

  console.log(
    `[FT ADAPTER CSV WINDOW ${label}]`,
    JSON.stringify(
      rows
        .map((row, i) => ({
          i,
          type: row.type,
          pk: row.sitKm ?? "",
          dependencia: row.dependencia ?? "",
          csv: !!row.csv,
          vmax: row.vmax ?? "",
        }))
        .filter((row) => wanted.has(row.pk))
    )
  );
}

// Nord-sud affiché = nordSud inversé
debugCsvZoneWindow(
  "NORD_SUD_LA_SAGRERA",
  [...LIGNE_FT_NORMALIZED.nordSud.rows].reverse(),
  ["630.7", "629.4", "627.7", "626.7", "624.3"]
);