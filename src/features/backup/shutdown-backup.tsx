import { useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { LoaderCircle } from "lucide-react";

import { exec, queryOne } from "@/lib/db";
import { useI18n } from "@/providers/i18n-provider";
import { logSkipped, type BackupRow } from "@/features/backup/use-backup";

/**
 * Copia de seguridad antes de cerrar la aplicación.
 *
 * Es la copia que más vale de todas. Las programadas caen a media faena y se
 * llevan un servicio a medias; esta se lleva el día entero, cerrado y cuadrado,
 * que es justo el estado que alguien querría recuperar.
 *
 * ## La regla que manda sobre todo lo demás
 *
 * **Nunca impedir que la aplicación se cierre.** Son las once de la noche, hay
 * que apagar y el disco de copias no está enchufado: si esto se planta ahí, lo
 * que aprende el personal es a matar el proceso desde el administrador de
 * tareas, y entonces se pierden también las copias que sí funcionaban.
 *
 * Por eso el fallo no detiene nada: se anota en el registro y se cierra igual.
 * Y por eso hay un botón para cerrar sin esperar, visible desde el primer
 * momento en vez de aparecer cuando ya se ha hecho larga la espera.
 *
 * ## Por qué cerrar a mitad ya no rompe nada
 *
 * `VACUUM INTO` no es atómico. Antes, matar el proceso a mitad dejaba un `.db`
 * incompleto con pinta de copia buena. Ahora se escribe en `.part` y se
 * renombra al terminar (`backup.rs`), así que una copia interrumpida no se
 * cuenta, no se conserva y no engaña a nadie.
 */

/**
 * Margen por debajo del cual no se vuelve a copiar al cerrar.
 *
 * Abrir y cerrar la aplicación tres veces seguidas —algo que pasa configurando
 * impresoras— no debería dejar tres copias idénticas y empujar fuera de la
 * carpeta a las que sí tienen contenido distinto. Diez minutos es corto para el
 * cierre de un día y largo para un reinicio.
 */
const RECENT_MS = 10 * 60_000;

const DB_URL = "sqlite:pos.db";

/**
 * Marca de módulo, no estado de React.
 *
 * `close()` vuelve a disparar `onCloseRequested`, así que sin una bandera fuera
 * del ciclo de vida del componente el segundo cierre se interceptaría otra vez y
 * la ventana no se cerraría nunca. Va aquí y no en un `ref` porque el
 * componente puede desmontarse mientras se copia.
 */
let closing = false;

function fileName(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `pos-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.db`
  );
}

function join(folder: string, name: string) {
  const clean = folder.replace(/[\\/]+$/, "");
  return `${clean}${clean.includes("\\") ? "\\" : "/"}${name}`;
}

function sqliteToDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ShutdownBackup() {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  // La ventana se guarda al registrarse para poder cerrarla desde el botón sin
  // volver a importar la API en caliente.
  const windowRef = useRef<{ close: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (cancelled) return;
      windowRef.current = win;

      unlisten = await win.onCloseRequested(async (event) => {
        // Segunda vuelta: la que provoca el `close()` de abajo. Se deja pasar.
        if (closing) return;

        const row = await queryOne<BackupRow>(
          `SELECT enabled, folder, every_hours, keep, last_at, last_path, last_error
             FROM backups WHERE id = 1`,
        ).catch(() => null);

        // Sin copias configuradas no hay nada que hacer y la ventana se cierra
        // como siempre. No se interrumpe a nadie para contarle que no hay copia.
        if (!row || row.enabled !== 1 || !row.folder) return;

        const last = sqliteToDate(row.last_at);
        if (last && Date.now() - last.getTime() < RECENT_MS) {
          // Se anota igualmente: un historial que salta cierres sin explicar por
          // qué es peor que uno que dice «no hacía falta».
          void logSkipped("shutdown", "reciente");
          return;
        }

        event.preventDefault();
        closing = true;
        setSaving(true);

        try {
          await runShutdownBackup(row);
        } catch {
          // Deliberado: el fallo ya quedó en el registro y en `last_error`. Aquí
          // solo queda cerrar, que es lo que la persona pidió.
        }
        await win.close();
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!saving) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="raised flex flex-col items-center gap-4 rounded-xl border border-border bg-card px-8 py-7">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium">{t("backup.closing")}</p>
        <button
          type="button"
          className="text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => void windowRef.current?.close()}
        >
          {t("backup.closeAnyway")}
        </button>
      </div>
    </div>
  );
}

/**
 * La copia en sí. Se escribe aparte de `useBackup` porque aquel corre dentro de
 * un componente con su propio candado, y aquí hace falta poder ejecutarla desde
 * un manejador de evento que sobrevive al desmontaje.
 */
async function runShutdownBackup(row: BackupRow) {
  await exec("INSERT INTO backup_log (reason) VALUES ('shutdown')");
  const entry = await queryOne<{ id: number }>(
    "SELECT MAX(id) AS id FROM backup_log",
  );
  const id = entry?.id ?? null;

  try {
    const result = await invoke<{ path: string; bytes: number; pruned: number }>(
      "db_backup",
      { db: DB_URL, path: join(row.folder, fileName()), keep: row.keep },
    );
    if (id !== null) {
      await exec(
        `UPDATE backup_log
            SET finished_at = datetime('now'), outcome = 'ok',
                path = $1, bytes = $2, pruned = $3
          WHERE id = $4`,
        [result.path, result.bytes, result.pruned, id],
      );
    }
    await exec(
      `UPDATE backups
          SET last_at = datetime('now'), last_path = $1, last_error = NULL
        WHERE id = 1`,
      [result.path],
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (id !== null) {
      await exec(
        `UPDATE backup_log
            SET finished_at = datetime('now'), outcome = 'error', error = $1
          WHERE id = $2`,
        [message, id],
      ).catch(() => {});
    }
    await exec("UPDATE backups SET last_error = $1 WHERE id = 1", [
      message,
    ]).catch(() => {});
    throw e;
  }
}
