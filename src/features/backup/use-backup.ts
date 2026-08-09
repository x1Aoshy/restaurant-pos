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

  const runNow = useCallback(async (): Promise<BackupResult | null> => {
    if (busy.current) return null;
    const current = await queryOne<BackupRow>(
      `SELECT enabled, folder, every_hours, keep, last_at, last_path, last_error
         FROM backups WHERE id = 1`,
    );
    if (!current || !current.folder) return null;

    busy.current = true;
    setRunning(true);
    try {
      const result = await invoke<BackupResult>("db_backup", {
        db: DB_URL,
        path: join(current.folder, fileName()),
        keep: current.keep,
      });
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
      await runNow().catch(() => {});
    };

    void check();
    const id = setInterval(() => void check(), TICK_MS);
    return () => clearInterval(id);
  }, [row, runNow]);

  return { row, running, hoursSince, runNow, reload };
}
