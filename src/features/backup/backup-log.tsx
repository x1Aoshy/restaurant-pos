import { useEffect, useState } from "react";
import { Check, CircleAlert, Minus, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { readBackupLog, type BackupLogRow } from "@/features/backup/use-backup";

/**
 * Historial de intentos de copia.
 *
 * `backups` guarda solo el último, y con eso no se contesta la pregunta que se
 * hace cuando algo huele mal: «¿desde cuándo?». Un USB desenchufado el martes y
 * reconectado el viernes dejaba el mismo rastro que si no hubiera pasado nada.
 *
 * Aquí se ve el patrón, que es lo que dice la causa: si las programadas entran y
 * las del cierre no, el problema no es la carpeta —es que alguien apaga el
 * equipo por el interruptor.
 */

const LIMIT = 20;

function shortTime(value: string | null): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Fecha y hora locales y cortas: quien mira esto compara con «ayer al cerrar»,
  // no necesita el año ni los segundos.
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ICON = {
  ok: Check,
  error: CircleAlert,
  skipped: Minus,
  running: LoaderCircle,
} as const;

const TONE = {
  ok: "text-emerald-600 dark:text-emerald-500",
  error: "text-destructive",
  skipped: "text-muted-foreground",
  // Una fila que quedó en «sin terminar» no es un fallo del que avisar en rojo,
  // pero tampoco es normal: casi siempre significa que se mató el proceso a
  // mitad de la copia.
  running: "text-amber-600 dark:text-amber-500",
} as const;

export function BackupLog({
  refreshKey,
  running,
}: {
  /** Cambia cuando se hace una copia, para volver a leer sin sondear. */
  refreshKey: string | null;
  running: boolean;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<BackupLogRow[]>([]);

  useEffect(() => {
    if (running) return;
    void readBackupLog(LIMIT)
      .then(setRows)
      .catch(() => setRows([]));
  }, [refreshKey, running]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium tracking-tight">{t("bk.log")}</p>
        <p className="text-[13px] text-muted-foreground">
          {t("bk.logHint", { n: LIMIT })}
        </p>
      </div>

      <div className="raised overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            {t("bk.logEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const Icon = ICON[r.outcome];
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      TONE[r.outcome],
                      r.outcome === "running" && "animate-spin",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className="font-medium">{shortTime(r.started_at)}</span>
                      <span className="text-muted-foreground">
                        {t(`bk.why.${r.reason}`)}
                      </span>
                      <span className={cn("ml-auto", TONE[r.outcome])}>
                        {t(`bk.out.${r.outcome}`)}
                      </span>
                    </div>
                    {r.error ? (
                      <p className="mt-0.5 break-words text-[12px] text-muted-foreground">
                        {r.error}
                      </p>
                    ) : r.bytes ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {t("bk.logSize", { mb: (r.bytes / 1_048_576).toFixed(1) })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
