import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { exec, queryOne } from "@/lib/db";

const DB_URL = "sqlite:pos.db";
/** Cada cuánto se mira si toca copiar. La copia en sí va por horas. */
const TICK_MS = 5 * 60_000;

export interface BackupRow {
  enabled: number;
  folder: string;
  every_hours: number;
  keep: number;
  last_at: string | null;
  last_path: string | null;
  last_error: string | null;
}

interface BackupResult {
  path: string;
  bytes: number;
  pruned: number;
}

/** «2026-08-02 19:04:12» sin marca de zona: SQLite lo guarda en UTC. */
function sqliteToDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `pos-20260802-190412.db` — hora local, para que el nombre se pueda leer. */
function fileName(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `pos-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.db`
  );
}

function join(folder: string, name: string) {
  const clean = folder.replace(/[\\/]+$/, "");
  // Windows entiende las dos barras; se conserva la que ya use la carpeta para
  // que la ruta que se enseña no quede mezclada.
  return `${clean}${clean.includes("\\") ? "\\" : "/"}${name}`;
}

// =============================================================================
// Registro
//
// `backups` guarda solo la última copia, y eso no responde a la pregunta que se
// hace cuando algo va mal: «¿desde cuándo no se copia?». Cada intento pisaba al
// anterior, así que un USB desenchufado el martes y reconectado el viernes
// dejaba el mismo rastro que si nunca hubiera fallado.
//
// La entrada se abre ANTES de copiar y se cierra después. Si el proceso muere a
// mitad —cerrar la aplicación es justo eso— queda una fila en `running`, que es
// exactamente la información útil: se intentó y no se llegó a terminar.
// =============================================================================

export type BackupReason = "scheduled" | "manual" | "shutdown";
export type BackupOutcome = "running" | "ok" | "error" | "skipped";

/** Cuántos intentos se conservan. Suficiente para ver varias semanas. */
const LOG_KEEP = 200;

export interface BackupLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  reason: BackupReason;
  outcome: BackupOutcome;
  path: string | null;
  bytes: number | null;
  pruned: number;
  error: string | null;
}

async function openLogEntry(reason: BackupReason): Promise<number | null> {
  try {
    await exec("INSERT INTO backup_log (reason) VALUES ($1)", [reason]);
    const row = await queryOne<{ id: number }>(
      "SELECT MAX(id) AS id FROM backup_log",
    );
    return row?.id ?? null;
  } catch {
    // Que no se pueda anotar no debe impedir la copia. El registro sirve para
    // explicar, y explicar importa menos que respaldar.
    return null;
  }
}

async function closeLogEntry(
  id: number | null,
  detail: {
    outcome: Exclude<BackupOutcome, "running">;
    result?: { path: string; bytes: number; pruned: number };
    error?: string;
  },
) {
  if (id === null) return;
  try {
    await exec(
      `UPDATE backup_log
          SET finished_at = datetime('now'), outcome = $1,
              path = $2, bytes = $3, pruned = $4, error = $5
        WHERE id = $6`,
      [
        detail.outcome,
        detail.result?.path ?? null,
        detail.result?.bytes ?? null,
        detail.result?.pruned ?? 0,
        detail.error ?? null,
        id,
      ],
    );
    // Se recorta aquí y no con un trigger: un trigger lo haría en cada inserto
    // y no hay ninguna prisa por soltar doscientas filas de texto.
    await exec(
      `DELETE FROM backup_log
        WHERE id <= (SELECT MAX(id) - $1 FROM backup_log)`,
      [LOG_KEEP],
    );
  } catch {
    // Igual que arriba.
  }
}

/** Deja constancia de un intento que se decidió no hacer. */
export async function logSkipped(reason: BackupReason, why: string) {
  const id = await openLogEntry(reason);
  await closeLogEntry(id, { outcome: "skipped", error: why });
}

/** Los últimos intentos, el más reciente primero. */
export async function readBackupLog(limit = 20): Promise<BackupLogRow[]> {
  const { query } = await import("@/lib/db");
  return query<BackupLogRow>(
    `SELECT id, started_at, finished_at, reason, outcome, path, bytes, pruned, error
       FROM backup_log ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}

/**
 * Copias automáticas de la base.
 *
 * El riesgo más probable de todo el sistema no es un atacante: es un disco que
 * falla una noche cualquiera. Esto es lo único que lo cubre.
 *
 * Se comprueba al arrancar y cada cinco minutos, pero solo copia cuando ha
 * pasado el intervalo configurado. Arrancar la aplicación diez veces en una
 * mañana no llena la carpeta de copias idénticas.
 */
export function useBackup() {
  const [row, setRow] = useState<BackupRow | null>(null);
  const [running, setRunning] = useState(false);
  // Dos copias a la vez escribirían el mismo fichero: el nombre tiene segundos,
  // no milisegundos.
  const busy = useRef(false);

  const reload = useCallback(async () => {
    try {
      setRow(
        await queryOne<BackupRow>(
          `SELECT enabled, folder, every_hours, keep, last_at, last_path, last_error
             FROM backups WHERE id = 1`,
        ),
      );
    } catch {
      // Sin base todavía; la pantalla de arranque ya cuenta ese fallo.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runNow = useCallback(async (
    reason: BackupReason = "manual",
  ): Promise<BackupResult | null> => {
    if (busy.current) return null;
    const current = await queryOne<BackupRow>(
      `SELECT enabled, folder, every_hours, keep, last_at, last_path, last_error
         FROM backups WHERE id = 1`,
    );
    if (!current || !current.folder) return null;

    busy.current = true;
    setRunning(true);
    const entry = await openLogEntry(reason);
    try {
      const result = await invoke<BackupResult>("db_backup", {
        db: DB_URL,
        path: join(current.folder, fileName()),
        keep: current.keep,
      });
      await closeLogEntry(entry, { outcome: "ok", result });
      await exec(
        `UPDATE backups
            SET last_at = datetime('now'), last_path = $1, last_error = NULL
          WHERE id = 1`,
        [result.path],
      );
      await reload();
      return result;
    } catch (e) {
      // El fallo se guarda para poder decir POR QUÉ no hay copias, en vez de
      // que la carpeta simplemente deje de crecer sin que nadie se entere.
      const message = e instanceof Error ? e.message : String(e);
      await closeLogEntry(entry, { outcome: "error", error: message });
      await exec("UPDATE backups SET last_error = $1 WHERE id = 1", [message]);
      await reload();
      throw e;
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [reload]);

  /** Cuánto hace de la última copia, en horas. `null` si no hay ninguna. */
  const hoursSince = useMemo(() => {
    const last = sqliteToDate(row?.last_at ?? null);
    if (!last) return null;
    return (Date.now() - last.getTime()) / 3_600_000;
  }, [row?.last_at]);

  useEffect(() => {
    if (!row || row.enabled !== 1 || !row.folder) return;

    const check = async () => {
      const last = sqliteToDate(row.last_at);
      const due =
        last === null || Date.now() - last.getTime() >= row.every_hours * 3_600_000;
      if (!due) return;
      // Falla en silencio a propósito: el aviso vive en el indicador y en la
      // pantalla de ajustes. Un mensaje rojo cada cinco minutos porque el USB
      // no está enchufado enseña a la gente a ignorar los mensajes.
      await runNow("scheduled").catch(() => {});
    };

    void check();
    const id = setInterval(() => void check(), TICK_MS);
    return () => clearInterval(id);
  }, [row, runNow]);

  return { row, running, hoursSince, runNow, reload };
}
