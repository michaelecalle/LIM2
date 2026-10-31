import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

// 31/10 — BOÎTE AUX LETTRES « Envoyer vers LIM ».
// Le raccourci Apple (feuille de partage de l'iPad, depuis Mail) POSTe ici le PDF DHLTV ;
// la fonction le dépose TEL QUEL dans `inbox/` du dépôt lim-logs. Aucune logique métier :
// c'est LIM, au lancement, qui liste `inbox/`, propose le fichier dans le menu de démarrage
// et le retire une fois le parcours confirmé (cf. src/lib/managedDocs.ts, fetchInboxLtvPdf).
//
// Authentification : clé partagée dans l'en-tête `X-LIM-Key`, comparée à la variable
// d'environnement Vercel `LIM_INBOX_KEY`. Le dépôt GitHub réutilise le jeton des journaux
// (`VITE_GITHUB_LOG_TOKEN`, également exposé à process.env côté fonctions).
//
// Corps accepté : le fichier brut (corps « Fichier » de l'action « Obtenir le contenu de l'URL »)
// ou un formulaire multipart dont la première partie fichier est le document (corps « Formulaire »).
// Formats : PDF, PNG ou JPEG (depuis le 28/10 le DHLTV peut arriver en images, une par page :
// le raccourci envoie alors une requête par image). Reconnaissance par les premiers octets,
// jamais par le nom. Limite Vercel : 4,5 Mo par requête.

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 4_500_000;
const INBOX_DIR = "inbox";

type Json = Record<string, unknown>;

function reply(res: VercelResponse, status: number, body: Json) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BYTES + 1_000_000) {
        reject(new Error("too-large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Clé valide ? Comparaison à temps constant, longueurs égales exigées. */
function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Première partie « fichier » d'un corps multipart/form-data : { data, filename }. */
function extractMultipartFile(
  body: Buffer,
  contentType: string
): { data: Buffer; filename: string | null } | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1]}`);
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const partStart = pos + boundary.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") break; // fin
    const headEnd = body.indexOf("\r\n\r\n", partStart);
    if (headEnd === -1) break;
    const head = body.slice(partStart, headEnd).toString("utf8");
    const next = body.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    let dataEnd = next;
    if (body.slice(dataEnd - 2, dataEnd).toString() === "\r\n") dataEnd -= 2;
    const data = body.slice(headEnd + 4, dataEnd);
    const fn = /filename="([^"]*)"/i.exec(head);
    if (fn || /application\/pdf/i.test(head) || data.slice(0, 5).toString() === "%PDF-") {
      return { data, filename: fn ? fn[1] : null };
    }
    pos = next;
  }
  return null;
}

type Kind = { ext: "pdf" | "png" | "jpg"; label: string };

/** Type reconnu aux premiers octets (jamais au nom) : PDF, PNG ou JPEG ; null sinon. */
function sniff(buf: Buffer): Kind | null {
  if (buf.length >= 5 && buf.slice(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", label: "PDF" };
  if (buf.length >= 8 && buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") return { ext: "png", label: "image PNG" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", label: "image JPEG" };
  return null;
}

/** Nom de fichier sûr pour le dépôt : caractères simples, longueur bornée, extension du type reconnu. */
function safeName(raw: string | null | undefined, ext: Kind["ext"]): string {
  let base = (raw ?? "").replace(/[\\/]+/g, "_");
  base = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // accents retirés
  base = base.replace(/\.(pdf|png|jpe?g)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) base = "dhltv";
  return `${base.slice(0, 60)}.${ext}`;
}

/** Horodatage UTC compact, trié naturellement par nom : 20261031-143015. */
function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function headerString(req: VercelRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { ok: false, message: "Méthode non autorisée : POST attendu." });
  }

  const expectedKey = process.env.LIM_INBOX_KEY;
  if (!expectedKey) {
    return reply(res, 503, { ok: false, message: "Boîte aux lettres non configurée (LIM_INBOX_KEY absente)." });
  }
  if (!keyMatches(headerString(req, "x-lim-key"), expectedKey)) {
    return reply(res, 401, { ok: false, message: "Clé refusée." });
  }

  const token = process.env.VITE_GITHUB_LOG_TOKEN;
  const owner = process.env.VITE_GITHUB_LOG_OWNER ?? "michaelecalle";
  const repo = process.env.VITE_GITHUB_LOG_REPO ?? "lim-logs";
  if (!token) {
    return reply(res, 503, { ok: false, message: "Jeton GitHub absent côté serveur." });
  }

  let body: Buffer;
  try {
    body = await readRawBody(req);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === "too-large";
    return reply(res, tooLarge ? 413 : 400, {
      ok: false,
      message: tooLarge ? "Fichier trop volumineux (limite 4,5 Mo)." : "Corps de requête illisible.",
    });
  }

  const contentType = headerString(req, "content-type") ?? "";
  let pdf = body;
  let filename: string | null = headerString(req, "x-lim-name") ?? null;
  if (/^multipart\/form-data/i.test(contentType)) {
    const part = extractMultipartFile(body, contentType);
    if (!part) return reply(res, 400, { ok: false, message: "Formulaire reçu sans fichier." });
    pdf = part.data;
    filename = filename ?? part.filename;
  }

  if (pdf.length === 0) return reply(res, 400, { ok: false, message: "Aucun fichier reçu." });
  if (pdf.length > MAX_BYTES) return reply(res, 413, { ok: false, message: "Fichier trop volumineux (limite 4,5 Mo)." });
  const kind = sniff(pdf);
  if (!kind) {
    return reply(res, 415, { ok: false, message: "Format refusé : PDF, PNG ou JPEG attendu." });
  }

  const name = `${stamp(new Date())}-${safeName(filename, kind.ext)}`;
  const path = `${INBOX_DIR}/${name}`;
  const kb = Math.round(pdf.length / 1024);

  try {
    const gh = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        message: `inbox: ${name} (${kb} Ko)`,
        content: pdf.toString("base64"),
      }),
    });
    if (!gh.ok) {
      const txt = await gh.text().catch(() => "");
      console.error("inbox: GitHub PUT failed", gh.status, txt.slice(0, 300));
      return reply(res, 502, { ok: false, message: `Dépôt refusé par GitHub (${gh.status}).` });
    }
  } catch (err) {
    console.error("inbox: GitHub PUT error", err);
    return reply(res, 502, { ok: false, message: "Dépôt impossible (GitHub injoignable)." });
  }

  return reply(res, 200, {
    ok: true,
    name,
    path,
    size: pdf.length,
    kind: kind.ext,
    message: `Déposé dans LIM : ${safeName(filename, kind.ext)} (${kind.label}, ${kb} Ko). Ouvre LIM pour démarrer avec ce DHLTV.`,
  });
}
