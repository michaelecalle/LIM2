// src/lib/replay/replayPlayer.ts
//
// LIMGPT — Replay Player v1 (squelette opérationnel)
// - Charge un log NDJSON (local text ou URL distante)
// - Normalise en timeline ms relative
// - Play/Pause/Stop/Seek/Speed
// - Injection via CustomEvent (bus existant)
// - Barrier "import:pdf" : attend lim:parsed + ft:conc:resolved
//
// Remarque : ce module ne dépend pas de React.

export type ReplayStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "done"
  | "error";

export type TestLogEvent = {
  t: string; // ISO
  kind: string;
  payload?: any;
};

export type ReplayEvent = {
  idx: number;
  iso: string;
  tMs: number;
  kind: string;
  payload: any;
};

export type ReplayCursor = { idx: number; tMs: number };

export type ReplayError = { message: string; detail?: any };

export type ReplayPlayerOptions = {
  // Forcer simulation ON pendant le replay (recommandé)
  forceSimulation?: boolean;

  // Timeout pour les barriers (import PDF)
  importBarrierTimeoutMs?: number;

  // Logger optionnel
  logger?: (msg: string, data?: any) => void;
};

const DEFAULT_OPTS: Required<ReplayPlayerOptions> = {
  forceSimulation: true,
  importBarrierTimeoutMs: 45_000,
  logger: () => {},
};

function safeParseJson(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isHttpUrl(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim());
}

function dispatch(name: string, detail?: any) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function waitForEvent(name: string, timeoutMs: number): Promise<CustomEvent> {
  return new Promise((resolve, reject) => {
    const handler = (e: Event) => {
      cleanup();
      resolve(e as CustomEvent);
    };

    const to = window.setTimeout(() => {
      cleanup();
      reject(new Error(`waitForEvent timeout: ${name} (${timeoutMs}ms)`));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(to);
      window.removeEventListener(name, handler as EventListener);
    };

    window.addEventListener(name, handler as EventListener);
  });
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function fetchPdfAsFile(payload: any): Promise<File> {
  const pdfId = payload?.pdfId ?? null;
  const name =
    typeof payload?.name === "string" && payload.name.trim().length > 0
      ? payload.name
      : pdfId
      ? `${pdfId}.pdf`
      : "replay.pdf";

  const lastModified =
    typeof payload?.lastModified === "number" && Number.isFinite(payload.lastModified)
      ? payload.lastModified
      : Date.now();

  // 1) Source distante (OVH remoteUrl stocké dans remotePath)
  const remotePath = payload?.remotePath;
  if (isHttpUrl(remotePath)) {
    // ✅ CORS: si le fichier est servi en statique par OVH, fetch() est bloqué.
    // On passe donc par replay_get.php qui ajoute les headers CORS.
    let fetchUrl = remotePath;

    try {
      const u = new URL(remotePath);

      // Cas attendu : https://radioequinoxe.com/limgpt/replay/pdfs/<file>
      // On convertit vers : https://radioequinoxe.com/limgpt/replay_get.php?f=<file>
      const m = u.pathname.match(/\/limgpt\/replay\/pdfs\/([^\/]+)$/i);
      if (m && m[1]) {
        const filename = m[1];
        fetchUrl = `${u.origin}/limgpt/replay_get.php?f=${encodeURIComponent(filename)}`;
      }
    } catch {
      // si URL parsing échoue, on tente quand même remotePath direct
      fetchUrl = remotePath;
    }

    const res = await fetch(fetchUrl, { method: "GET" });
    if (!res.ok) throw new Error(`PDF fetch failed HTTP ${res.status} (${fetchUrl})`);
    const blob = await res.blob();
    return new File([blob], name, {
      type: "application/pdf",
      lastModified,
    });
  }


  // 2) Fallback local cache (même appareil)
  const replayKey = payload?.replayKey;
  if (typeof replayKey === "string" && replayKey.trim().length > 0) {
    const cache = await caches.open("limgpt-pdf-replay");
    const match = await cache.match(new Request(replayKey));
    if (!match) throw new Error(`PDF cache miss (replayKey=${replayKey})`);
    const blob = await match.blob();
    return new File([blob], name, {
      type: match.type || "application/pdf",
      lastModified,
    });
  }

  throw new Error("No PDF source: expected payload.remotePath (http) or payload.replayKey");
}

export class ReplayPlayer {
  private opts: Required<ReplayPlayerOptions>;

  private status: ReplayStatus = "idle";
  private error: ReplayError | null = null;

  private events: ReplayEvent[] = [];
  private cursorIdx = 0;

    private startIso: string | null = null;


  private nowMs = 0;
  private durationMs = 0;

  private skipImportPdfEvents = false;
  private interactive = false;
  private interactivePrompt: ((desc: string) => Promise<boolean>) | null = null;
  private seenFirstGreenMode = false;
  private seenFirstUnfold = false;

  private startedAtPerf: number | null = null;
  private startedAtNowMs: number | null = null;

  private rafId: number | null = null;
  private isDraining = false;

  constructor(options?: ReplayPlayerOptions) {
    this.opts = { ...DEFAULT_OPTS, ...(options ?? {}) };
  }

  // ---------------- public API ----------------

  getStatus(): ReplayStatus {
    return this.status;
  }

  getError(): ReplayError | null {
    return this.error;
  }

  getCursor(): ReplayCursor {
    // Toujours retourner nowMs (position réelle), pas le prochain événement.
    // Évite le saut visuel vers le prochain event quand il n'y a pas d'event proche.
    return { idx: this.cursorIdx, tMs: this.nowMs };
  }

  getDurationMs(): number {
    return this.durationMs;
  }
  getStartIso(): string | null {
    return this.startIso;
  }

  // Heure absolue au "temps courant du replay"
  getNowIso(): string | null {
    if (!this.startIso) return null;
    const base = Date.parse(this.startIso);
    if (!Number.isFinite(base)) return null;
    return new Date(base + Math.max(0, this.nowMs)).toISOString();
  }

  setSkipImportPdfEvents(skip: boolean): void {
    this.skipImportPdfEvents = skip;
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
  }

  setInteractivePrompt(fn: ((desc: string) => Promise<boolean>) | null): void {
    this.interactivePrompt = fn;
  }

  async loadFromUrl(remoteLogUrl: string): Promise<void> {
    this.setStatus("loading");
    try {
      const text = await fetchText(remoteLogUrl);
      await this.loadFromText(text);
    } catch (err: any) {
      this.fail(err?.message ?? String(err), err);
    }
  }

  async loadFromText(ndjson: string): Promise<void> {
    this.setStatus("loading");
    try {
      const parsed = this.parseNdjson(ndjson);
      const normalized = this.normalizeEvents(parsed);
      this.startIso = parsed[0]?.t ?? null;

      this.events = normalized;
      this.cursorIdx = 0;
      this.nowMs = 0;
      this.durationMs = normalized.length
        ? normalized[normalized.length - 1].tMs
        : 0;

      this.error = null;
      this.setStatus("ready");
    } catch (err: any) {
      this.fail(err?.message ?? String(err), err);
    }
  }

  play(): void {
    if (this.status !== "ready" && this.status !== "paused") return;
    if (!this.events.length) return;

    if (this.opts.forceSimulation) {
      dispatch("sim:enable", { enabled: true });
    }

    this.startedAtPerf = performance.now();
    this.startedAtNowMs = this.nowMs;
    this.setStatus("playing");
    this.loop();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.stopLoop();
    this.setStatus("paused");
  }

  stop(): void {
    this.stopLoop();

    // remise à zéro timeline
    this.cursorIdx = 0;
    this.nowMs = 0;
    this.startedAtPerf = null;
    this.startedAtNowMs = null;
    this.isDraining = false;

    if (this.opts.forceSimulation) {
      dispatch("sim:enable", { enabled: false });
    }

    // reste "ready" si un log est chargé (pratique pour rejouer)
    this.setStatus(this.events.length ? "ready" : "idle");
  }

  seek(tMs: number): void {
    if (!Number.isFinite(tMs)) return;
    const clamped = Math.max(0, Math.min(this.durationMs, tMs));

    // pause implicite pendant seek
    if (this.status === "playing") {
      this.pause();
    }

    // Catch-up : rejouer tous les événements entre la position actuelle et la cible
    // pour que l'état de l'app (autoscroll, GPS, mode…) soit cohérent.
    // En recul : on repart depuis le début (idx=0).
    const isBackward = clamped < this.nowMs;
    const fromIdx = isBackward ? 0 : this.cursorIdx;
    const toIdx = this.findCursorForTime(clamped);

    if (toIdx > fromIdx) {
      this.opts.logger(
        `[replay] seek catch-up ${isBackward ? "↩ recul" : "↪ avance"} : ${toIdx - fromIdx} événements`,
        { fromIdx, toIdx, fromMs: this.nowMs, toMs: clamped }
      );
      this.applyCatchupRange(fromIdx, toIdx);
    }

    this.nowMs = clamped;
    this.cursorIdx = toIdx;
  }

  // Rejoue une plage d'événements de façon synchrone (sans barrier async).
  // Utilisé lors d'un seek pour reconstruire l'état de l'app.
  private applyCatchupRange(fromIdx: number, toIdx: number): void {
    // Optimisation : pour gps:position, on ne dispatche que le dernier de la plage
    // (évite de spammer la FT avec des milliers de positions GPS).
    let lastGpsPosIdx = -1;
    for (let i = fromIdx; i < toIdx; i++) {
      if (this.events[i].kind === "gps:position") lastGpsPosIdx = i;
    }

    for (let i = fromIdx; i < toIdx; i++) {
      const ev = this.events[i];
      if (ev.kind === "gps:position" && i !== lastGpsPosIdx) continue;
      this.applyCatchupEvent(ev);
    }
  }

  // Version synchrone de applyEvent : même logique, mais sans await (pas de barrier).
  private applyCatchupEvent(ev: ReplayEvent): void {
    const { kind, payload } = ev;

    switch (kind) {
      case "import:pdf":
        // PDF déjà chargé depuis le ZIP — on ignore
        return;

      case "ui:autoScroll:toggle": {
        const enabled = !!payload?.enabled;
        const isFirstPlay = !!payload?.isFirstPlay;
        const standby = !!payload?.standby || (isFirstPlay && enabled);
        dispatch("ft:auto-scroll-change", { ...(payload ?? {}), enabled, standby, source: "replay-catchup" });
        dispatch("lim:hourly-mode", { enabled, standby });
        return;
      }

      case "ui:standby:enter": {
        dispatch("ft:standby:set", { rowIndex: payload?.rowIndex });
        dispatch("ft:auto-scroll-change", { enabled: false, standby: true, source: "replay-catchup" });
        dispatch("lim:hourly-mode", { enabled: false, standby: true });
        return;
      }

      case "ui:standby:resume": {
        dispatch("ft:standby:set", { rowIndex: payload?.rowIndex });
        dispatch("ft:auto-scroll-change", { enabled: true, source: "replay-catchup" });
        dispatch("lim:hourly-mode", { enabled: true, standby: false });
        return;
      }

      case "settings:ocrOnline:set": {
        try {
          localStorage.setItem("ocrOnlineEnabled", !!payload?.enabled ? "1" : "0");
        } catch {}
        return;
      }

      case "settings:simulation:set": {
        dispatch("sim:enable", { enabled: !!payload?.enabled });
        return;
      }

      case "ui:pdf:mode-change": {
        dispatch("lim:pdf-mode-change", { ...(payload ?? {}), source: "replay-catchup" });
        return;
      }

      case "gps:state-change": {
        const state = payload?.nextState;
        const pk = payload?.pk ?? null;
        if (state) dispatch("lim:gps-state", { state, pk, source: "replay-catchup" });
        return;
      }

      case "gps:position": {
        dispatch("gps:position", payload);
        return;
      }

      case "ui:schedule-delta": {
        const text = payload?.text ?? null;
        const isLargeDelay = !!(payload?.isLargeDelay ?? payload?.isLarge);
        const deltaSec = typeof payload?.deltaSec === "number" ? payload.deltaSec : null;
        dispatch("lim:schedule-delta", { text, isLargeDelay, deltaSec });
        return;
      }

      case "ft:reference-mode": {
        const mode = payload?.mode as "HORAIRE" | "GPS" | undefined;
        if (mode === "HORAIRE" || mode === "GPS") {
          dispatch("lim:reference-mode", { mode });
        }
        return;
      }

      default:
        return;
    }
  }

  // ---------------- core ----------------

  private loop() {
    if (this.rafId != null) return;

    const tick = async () => {
      this.rafId = window.requestAnimationFrame(() => {
        void tick();
      });

      if (this.status !== "playing") return;
      if (this.startedAtPerf == null || this.startedAtNowMs == null) return;

      const elapsed = performance.now() - this.startedAtPerf;
      this.nowMs = this.startedAtNowMs + elapsed;

      // évite réentrance si un barrier async est en cours
      if (this.isDraining) return;
      this.isDraining = true;

      try {
        await this.drainDueEvents();
      } catch (err: any) {
        this.fail(err?.message ?? String(err), err);
      } finally {
        this.isDraining = false;
      }
    };

    void tick();
  }

  private stopLoop() {
    if (this.rafId != null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // figer nowMs au moment pause
    if (this.startedAtPerf != null && this.startedAtNowMs != null) {
      const elapsed = performance.now() - this.startedAtPerf;
      this.nowMs = this.startedAtNowMs + elapsed;
    }
    this.startedAtPerf = null;
    this.startedAtNowMs = null;
  }

  private async drainDueEvents(): Promise<void> {
    while (
      this.cursorIdx < this.events.length &&
      this.events[this.cursorIdx].tMs <= this.nowMs
    ) {
      const ev = this.events[this.cursorIdx];
      await this.applyEvent(ev);
      this.cursorIdx++;
    }

    if (this.cursorIdx >= this.events.length) {
      this.stopLoop();
      this.setStatus("done");
      if (this.opts.forceSimulation) {
        dispatch("sim:enable", { enabled: false });
      }
    }
  }

  private describeUserAction(kind: string, payload: any): string | null {
    switch (kind) {
      case "ui:autoScroll:toggle":
        return payload?.enabled ? "Activation du défilement automatique" : "Arrêt du défilement automatique";
      case "ui:standby:enter":
        return `Entrée en stand-by sur ${payload?.dependencia ?? `ligne ${payload?.rowIndex}`}`;
      case "ui:standby:resume":
        return `Sortie du stand-by depuis ${payload?.dependencia ?? `ligne ${payload?.rowIndex}`}`;
      case "ui:pdf:mode-change": {
        // Le premier passage en mode "green" est automatique (initialisation), pas un clic
        if (payload?.mode === "green" && !this.seenFirstGreenMode) {
          this.seenFirstGreenMode = true;
          return null;
        }
        this.seenFirstGreenMode = true;
        return `Changement de mode : ${payload?.mode === "red" ? "secours" : payload?.mode === "green" ? "normal" : payload?.mode}`;
      }
      case "ui:infos-ltv:fold-change": {
        // Le premier dépliage est automatique (initialisation)
        if (!payload?.folded && !this.seenFirstUnfold) {
          this.seenFirstUnfold = true;
          return null;
        }
        this.seenFirstUnfold = true;
        return payload?.folded ? "Passage en mode plié" : "Passage en mode déplié";
      }
      // ui:displayed-train-number-change et ui:displayed-composition-change
      // sont des conséquences automatiques, pas des actions utilisateur
      default:
        return null;
    }
  }

  private async applyEvent(ev: ReplayEvent): Promise<void> {
    const { kind, payload } = ev;

    // Mode interactif : pause + confirmation pour les actions utilisateur
    if (this.interactive && this.interactivePrompt) {
      const desc = this.describeUserAction(kind, payload);
      if (desc != null) {
        // Geler le temps : mettre startedAtPerf à null pour que le tick retourne immédiatement
        const frozenNowMs = this.nowMs;
        this.startedAtPerf = null;
        this.startedAtNowMs = null;
        const accepted = await this.interactivePrompt(desc);
        // Recalibrer le temps à la reprise (reprend là où on s'est arrêté)
        this.startedAtPerf = performance.now();
        this.startedAtNowMs = frozenNowMs;
        if (!accepted) return;
      }
    }

    // --- mapping v1 ---
    switch (kind) {
      case "import:pdf": {
        if (this.skipImportPdfEvents) {
          this.opts.logger("[replay] import:pdf skipped (PDF déjà chargé depuis le ZIP)");
          return;
        }
        this.opts.logger("[replay] import:pdf", payload);

        const file = await fetchPdfAsFile(payload);

        // Dispatch identique à ce que l'app attend
        const detail = { ...payload, file };
        dispatch("lim:import-pdf", detail);
        dispatch("ft:import-pdf", detail);

        // Barrier : attendre la fin parsing LIM + pipeline FT
        await Promise.all([
          waitForEvent("lim:parsed", this.opts.importBarrierTimeoutMs),
          waitForEvent("ft:conc:resolved", this.opts.importBarrierTimeoutMs),
        ]);
        return;
      }

      case "ui:autoScroll:toggle": {
        this.opts.logger("[replay] ui:autoScroll:toggle", payload);
        const enabled = !!payload?.enabled;
        const isFirstPlay = !!payload?.isFirstPlay;

        // Reconstituer "standby: true" pour le premier Play :
        // Le log stocke isFirstPlay mais pas standby (standby est ajouté côté
        // dispatchEvent dans TitleBar mais pas dans logTestEvent). On le
        // reconstruit ici pour rétrocompatibilité avec les anciens logs.
        const standby = !!payload?.standby || (isFirstPlay && enabled);

        dispatch("ft:auto-scroll-change", {
          ...(payload ?? {}),
          enabled,
          standby,
          source: "replay",
        });
        // Met à jour les indicateurs TitleBar (bouton play, mode horaire)
        dispatch("lim:hourly-mode", { enabled, standby });
        return;
      }

      case "ui:standby:enter": {
        const rowIndex = payload?.rowIndex;
        dispatch("ft:standby:set", { rowIndex });
        dispatch("ft:auto-scroll-change", {
          enabled: false,
          standby: true,
          source: "replay",
        });
        dispatch("lim:hourly-mode", { enabled: false, standby: true });
        return;
      }

      case "ui:standby:resume": {
        const rowIndex = payload?.rowIndex;
        dispatch("ft:standby:set", { rowIndex });
        dispatch("ft:auto-scroll-change", { enabled: true, source: "replay" });
        dispatch("lim:hourly-mode", { enabled: true, standby: false });
        return;
      }

      case "settings:ocrOnline:set": {
        // On laisse l'app piloter via sa source de vérité (localStorage)
        // Si tu veux, on pourra plus tard importer setOcrOnlineEnabled ici.
        try {
          const enabled = !!payload?.enabled;
          localStorage.setItem("ocrOnlineEnabled", enabled ? "1" : "0");
        } catch {}
        return;
      }

      case "settings:simulation:set": {
        // En replay, on force généralement simulation ON.
        // Mais si tu veux rejouer exactement les bascules, on les applique.
        const enabled = !!payload?.enabled;
        dispatch("sim:enable", { enabled });
        return;
      }

      // --- mapping v1 (compléments validés étape par étape) ---
      case "ui:pdf:mode-change": {
        // L'app écoute: lim:pdf-mode-change
        dispatch("lim:pdf-mode-change", { ...(payload ?? {}), source: "replay" });
        return;
      }

      case "gps:state-change": {
        const state = payload?.nextState;
        const pk = payload?.pk ?? null;
        if (state) dispatch("lim:gps-state", { state, pk, source: "replay" });
        return;
      }

      case "gps:position": {
        dispatch("gps:position", payload);
        return;
      }

      case "ui:schedule-delta": {
        // Indicateur retard/avance dans TitleBar.
        // Le log utilise "isLarge", TitleBar écoute "isLargeDelay" — on passe les deux.
        const text = payload?.text ?? null;
        const isLargeDelay = !!(payload?.isLargeDelay ?? payload?.isLarge);
        const deltaSec = typeof payload?.deltaSec === "number" ? payload.deltaSec : null;
        dispatch("lim:schedule-delta", { text, isLargeDelay, deltaSec });
        return;
      }

      case "ft:reference-mode": {
        // Indicateur mode référence (HORAIRE / GPS) dans TitleBar.
        const mode = payload?.mode as "HORAIRE" | "GPS" | undefined;
        if (mode === "HORAIRE" || mode === "GPS") {
          dispatch("lim:reference-mode", { mode });
        }
        return;
      }

      // --- actions utilisateur supplémentaires ---
      case "ui:infos-ltv:fold-change": {
        const folded = !!payload?.folded;
        dispatch("lim:infos-ltv-fold-change", { folded, source: "replay" });
        return;
      }

      case "ui:displayed-train-number-change": {
        dispatch("lim:train-display-change", { ...(payload ?? {}), source: "replay" });
        return;
      }

      case "ui:displayed-composition-change": {
        dispatch("lim:composition-display-change", { ...(payload ?? {}), source: "replay" });
        return;
      }

      // --- ignorer : conséquences (l'app les dérive des actions/GPS) ---
      case "ft:auto:arrival-stop":
      case "ft:delta:gps-recalage":
      case "ft:delta:gps-recalage:skip":
      case "ft:delta:recalage:mark":
      case "ft:delta:capture-base-from-row":
      case "ft:standby:visual-clear":
      case "gps:arret:armed":
      case "gps:arret:departure-confirmed":
      case "gps:arret:departure-implausible":
      case "gps:arret:departure-no-recal":
      case "gps:arret:first-movement":
      case "gps:arret:rejected-approach":
      case "gps:arret:approach-warning":
      case "gps:arret:approach-warning-near-station":
      case "gps:arret:rejected-tunnel-zone":
      case "gps:arret:rearm-blocked":
      case "gps:freeze-red:entered":
      case "gps:freeze-red:station-arret":
      case "gps:freeze-red:station-standby-skip":
      case "gps:orange-to-red:fire":
      case "gps:orange-to-red:start":
      case "gps:orange-to-red:stop":
      case "gps:state-change:watchdog":
      case "gps:mode-change:watchdog":
      case "direction:expected:set":
      case "direction:lock":
      case "direction:mismatch":
      case "figueres:armed":
      case "ft:ltv:rows-received":
      case "ltv:source:loaded":
      // --- ignorer : diagnostics/infrastructure ---
      case "ft:scroll:viewport":
      case "ft:delta:tick":
      case "gps:watch:start":
      case "gps:watch:stop":
      case "gps:watch:error":
      case "gps:mode-change":
      case "gps:mode-check":
      case "testlog:uploaded":
      case "testlog:silent-start":
      case "session:start":
      case "session:stop":
      case "ui:test:auto-start":
      case "ui:test:stop":
      case "ui:gps-state:red":
      case "ui:auto:precal:ok":
      case "ui:lim:parsed":
      case "ui:manual-import:train-selected":
      default: {
        // no-op
        return;
      }

    }
  }

  // ---------------- parsing / normalization ----------------

  private parseNdjson(text: string): TestLogEvent[] {
    const lines = String(text ?? "").split(/\r?\n/);
    const out: TestLogEvent[] = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue;

      const json = safeParseJson(line);
      if (!json) continue;

      if (typeof json.kind !== "string" || typeof json.t !== "string") continue;

      out.push({
        t: String(json.t),
        kind: String(json.kind),
        payload: json.payload,
      });
    }

    return out;
  }

  private normalizeEvents(src: TestLogEvent[]): ReplayEvent[] {
    if (!src.length) return [];

    const t0 = Date.parse(src[0].t);
    const base = Number.isFinite(t0) ? t0 : Date.now();

    const out: ReplayEvent[] = src.map((e, idx) => {
      const ts = Date.parse(e.t);
      const tMs = Number.isFinite(ts) ? ts - base : idx;

      return {
        idx,
        iso: e.t,
        tMs: Math.max(0, tMs),
        kind: e.kind,
        payload: e.payload ?? {},
      };
    });

    out.sort((a, b) => (a.tMs - b.tMs) || (a.idx - b.idx));
    return out;
  }

  private findCursorForTime(tMs: number): number {
    // premier index dont event.tMs > tMs
    // (donc cursor pointe le prochain à jouer)
    let lo = 0;
    let hi = this.events.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].tMs <= tMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ---------------- helpers ----------------

  private setStatus(s: ReplayStatus) {
    this.status = s;
  }

  private fail(message: string, detail?: any) {
    this.stopLoop();
    this.status = "error";
    this.error = { message, detail };
    this.opts.logger("[replay] ERROR: " + message, detail);
  }
}
