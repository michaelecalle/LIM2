const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  ribbon: path.join(ROOT, "src", "lib", "ligne050_ribbon_dense.ts"),
  adif: path.join(ROOT, "src", "lib", "ancres_pk_s.ts"),
  lfp: path.join(ROOT, "src", "lib", "ancres_lfp.ts"),
  rfn: path.join(ROOT, "src", "lib", "ancres_rfn.ts"),
};

const OUTPUT_DIR = path.join(ROOT, "exports");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "diagnostic_ruban_ancres.kml");

// ===== Helpers lecture TS simple =====

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractExportedArray(tsSource, exportName) {
  const marker = `export const ${exportName}`;
  const start = tsSource.indexOf(marker);
  if (start === -1) {
    throw new Error(`Export introuvable: ${exportName}`);
  }

  const equalsIndex = tsSource.indexOf("=", start);
  if (equalsIndex === -1) {
    throw new Error(`Signe "=" introuvable pour: ${exportName}`);
  }

  const bracketStart = tsSource.indexOf("[", equalsIndex);
  if (bracketStart === -1) {
    throw new Error(`Début de tableau introuvable pour: ${exportName}`);
  }

  let depth = 0;
  let end = -1;

  for (let i = bracketStart; i < tsSource.length; i++) {
    const ch = tsSource[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(`Fin de tableau introuvable pour: ${exportName}`);
  }

  return tsSource.slice(bracketStart, end + 1);
}

function parseArrayLiteral(arrayLiteral) {
  return Function(`"use strict"; return (${arrayLiteral});`)();
}

function loadExportedArray(filePath, exportName) {
  const text = readText(filePath);
  const arrayLiteral = extractExportedArray(text, exportName);
  const data = parseArrayLiteral(arrayLiteral);

  if (!Array.isArray(data)) {
    throw new Error(`${exportName} n'est pas un tableau`);
  }

  return data;
}

// ===== Helpers KML =====

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function coord(lon, lat, alt = 0) {
  return `${lon},${lat},${alt}`;
}

function makePointPlacemark({ name, description, lon, lat, styleUrl }) {
  return `
    <Placemark>
      <name>${xmlEscape(name)}</name>
      <description><![CDATA[${description}]]></description>
      <styleUrl>${styleUrl}</styleUrl>
      <Point>
        <coordinates>${coord(lon, lat)}</coordinates>
      </Point>
    </Placemark>`;
}

function makeLinePlacemark({ name, description, coordinates, styleUrl }) {
  return `
    <Placemark>
      <name>${xmlEscape(name)}</name>
      <description><![CDATA[${description}]]></description>
      <styleUrl>${styleUrl}</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
${coordinates.map((c) => `          ${c}`).join("\n")}
        </coordinates>
      </LineString>
    </Placemark>`;
}

function anchorDescription(anchor, family, pkField) {
  return [
    `<b>Famille :</b> ${xmlEscape(family)}`,
    `<b>Label :</b> ${xmlEscape(anchor.label ?? "")}`,
    `<b>${xmlEscape(pkField)} :</b> ${anchor[pkField]}`,
    `<b>s_km :</b> ${anchor.s_km}`,
    `<b>index_ruban :</b> ${anchor.index_ruban}`,
    `<b>lat :</b> ${anchor.lat}`,
    `<b>lon :</b> ${anchor.lon}`,
  ].join("<br>");
}

function ribbonPointDescription(point, index) {
  return [
    `<b>Index ruban :</b> ${index}`,
    `<b>s_km :</b> ${point.s_km}`,
    `<b>lat :</b> ${point.lat}`,
    `<b>lon :</b> ${point.lon}`,
  ].join("<br>");
}

function buildKml({ ribbonPoints, adifAnchors, lfpAnchors, rfnAnchors }) {
  const ribbonCoords = ribbonPoints.map((p) => coord(p.lon, p.lat));

  const ribbonLine = makeLinePlacemark({
    name: "Ruban complet",
    description: `Points: ${ribbonPoints.length}`,
    coordinates: ribbonCoords,
    styleUrl: "#rubanLine",
  });

  const ribbonPointPlacemarks = ribbonPoints
    .map((p, i) =>
      makePointPlacemark({
        name: `RIB ${i}`,
        description: ribbonPointDescription(p, i),
        lon: p.lon,
        lat: p.lat,
        styleUrl: "#rubanPoint",
      })
    )
    .join("\n");

  const adifPlacemarks = adifAnchors
    .map((a) =>
      makePointPlacemark({
        name: `ADIF ${a.pk} — ${a.label}`,
        description: anchorDescription(a, "ADIF", "pk"),
        lon: a.lon,
        lat: a.lat,
        styleUrl: "#adifAnchor",
      })
    )
    .join("\n");

  const lfpPlacemarks = lfpAnchors
    .map((a) =>
      makePointPlacemark({
        name: `LFP ${a.pk_lfp} — ${a.label}`,
        description: anchorDescription(a, "LFP", "pk_lfp"),
        lon: a.lon,
        lat: a.lat,
        styleUrl: "#lfpAnchor",
      })
    )
    .join("\n");

  const rfnPlacemarks = rfnAnchors
    .map((a) =>
      makePointPlacemark({
        name: `RFN ${a.pk_rff} — ${a.label}`,
        description: anchorDescription(a, "RFN", "pk_rff"),
        lon: a.lon,
        lat: a.lat,
        styleUrl: "#rfnAnchor",
      })
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Diagnostic ruban + ancres</name>

    <Style id="rubanLine">
      <LineStyle>
        <color>ff00ffff</color>
        <width>3</width>
      </LineStyle>
    </Style>

    <Style id="rubanPoint">
      <IconStyle>
        <scale>0.4</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <scale>0.4</scale>
      </LabelStyle>
    </Style>

    <Style id="adifAnchor">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <scale>0.9</scale>
      </LabelStyle>
    </Style>

    <Style id="lfpAnchor">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <scale>0.9</scale>
      </LabelStyle>
    </Style>

    <Style id="rfnAnchor">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <scale>0.9</scale>
      </LabelStyle>
    </Style>

    <Folder>
      <name>01 - Ruban complet</name>
      ${ribbonLine}
    </Folder>

    <Folder>
      <name>02 - Points du ruban (indices)</name>
      ${ribbonPointPlacemarks}
    </Folder>

    <Folder>
      <name>03 - Ancres ADIF</name>
      ${adifPlacemarks}
    </Folder>

    <Folder>
      <name>04 - Ancres LFP</name>
      ${lfpPlacemarks}
    </Folder>

    <Folder>
      <name>05 - Ancres RFN</name>
      ${rfnPlacemarks}
    </Folder>
  </Document>
</kml>`;
}

// ===== Main =====

function main() {
  console.log("[KML] Lecture des fichiers...");

  const ribbonPoints = loadExportedArray(FILES.ribbon, "RIBBON_POINTS");
  const adifAnchors = loadExportedArray(FILES.adif, "ANCRES_PK_S");
  const lfpAnchors = loadExportedArray(FILES.lfp, "ANCRES_LFP");
  const rfnAnchors = loadExportedArray(FILES.rfn, "ANCRES_RFF");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const kml = buildKml({
    ribbonPoints,
    adifAnchors,
    lfpAnchors,
    rfnAnchors,
  });

  fs.writeFileSync(OUTPUT_FILE, kml, "utf8");

  console.log("[KML] OK");
  console.log(`[KML] Ruban : ${ribbonPoints.length} points`);
  console.log(`[KML] ADIF  : ${adifAnchors.length} ancres`);
  console.log(`[KML] LFP   : ${lfpAnchors.length} ancres`);
  console.log(`[KML] RFN   : ${rfnAnchors.length} ancres`);
  console.log(`[KML] Fichier généré : ${OUTPUT_FILE}`);
}

main();