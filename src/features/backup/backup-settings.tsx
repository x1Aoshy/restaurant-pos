import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CircleAlert,
  CircleCheck,
  FolderOpen,
  HardDriveDownload,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { exec } from "@/lib/db";
import { useI18n } from "@/providers/i18n-provider";
import { useBackup } from "@/features/backup/use-backup";
import { BackupLog } from "@/features/backup/backup-log";
import {
  RestoreDialog,
  type RestoreCandidate,
} from "@/features/backup/restore-dialog";

const HOURS = [1, 3, 6, 12, 24] as const;

/** Aviso a partir de aquí: dos intervalos sin copiar ya no es un retraso. */
const STALE_FACTOR = 2;

export function BackupSettings() {
  const { t } = useI18n();
  const { row, running, hoursSince, runNow, reload } = useBackup();

  const [folder, setFolder] = useState("");
  const [keep, setKeep] = useState("14");
  const [restoring, setRestoring] = useState(false);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);

  /**
   * Elegir una copia y comprobarla, sin tocar nada todavía.
   *
   * La comprobación la hace Rust: abre el fichero en solo lectura, mira que sea
   * una base sana y que tenga las tablas de esta aplicación. Un fichero
   * equivocado se rechaza aquí, con la base actual intacta, y no a medias.
   */
  const pickRestore = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["db"] }],
    });
    if (typeof chosen !== "string") return;
    setRestoring(true);
    try {
      const check = await invoke<{ version: number; bytes: number }>("db_restore", {
        source: chosen,
      });
      setCandidate({ path: chosen, ...check });
    } catch (e) {
      toast.error(t("bk.restoreBad"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRestoring(false);
    }
  };

  /**
   * El cambio de fichero se hace al arrancar, no ahora: con la base abierta,
   * sustituirla por debajo deja a SQLite leyendo algo que ya no está.
   */
  const confirmRestore = async () => {
    setCandidate(null);
    toast.success(t("bk.restoreQueued"));
    await new Promise((r) => setTimeout(r, 1200));
    await invoke("app_restart");
  };

  useEffect(() => {
    if (!row) return;
    setFolder(row.folder);
    setKeep(String(row.keep));
  }, [row]);

  const pickFolder = async () => {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen !== "string") return;
    await save({ folder: chosen });
  };

  const save = async (patch: Partial<{
    folder: string;
    every_hours: number;
    keep: number;
    enabled: number;
  }>) => {
    try {
      const next = {
        folder: patch.folder ?? folder,
        every_hours: patch.every_hours ?? row?.every_hours ?? 6,
        keep: patch.keep ?? Math.min(200, Math.max(1, Number(keep) || 14)),
        enabled: patch.enabled ?? row?.enabled ?? 0,
      };
      await exec(
        `UPDATE backups SET folder = $1, every_hours = $2, keep = $3, enabled = $4
          WHERE id = 1`,
        [next.folder, next.every_hours, next.keep, next.enabled],
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const backupNow = async () => {
    try {
      const result = await runNow();
      if (!result) return toast.error(t("bk.pickFirst"));
      toast.success(t("bk.done"), {
        description: `${result.path} · ${(result.bytes / 1024).toFixed(0)} KB`,
      });
    } catch (e) {
      toast.error(t("bk.failed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const on = row?.enabled === 1;
  const configured = Boolean(row?.folder);
  const stale =
    on && hoursSince !== null && hoursSince > (row?.every_hours ?? 6) * STALE_FACTOR;
  const never = on && hoursSince === null;
  const broken = Boolean(row?.last_error) || stale || never;

  return (
    <div className="max-w-2xl">
      <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <Label htmlFor="bk-on" className="text-[13px]">
              {t("bk.enable")}
            </Label>
          </div>
          <Switch
            id="bk-on"
            checked={on}
            disabled={!configured && !on}
            onCheckedChange={(v) => void save({ enabled: v ? 1 : 0 })}
          />
        </div>

        <div className="flex flex-col gap-2 px-4 py-3.5">
          <Label>{t("bk.folder")}</Label>
          <div className="flex gap-2">
            <Input
              value={folder}
              readOnly
              placeholder={t("bk.folderPh")}
              className="font-mono text-xs"
            />
            <Button variant="outline" onClick={() => void pickFolder()}>
              <FolderOpen />
              {t("bk.choose")}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <Label className="text-[13px]">{t("bk.every")}</Label>
          <div className="flex gap-1.5">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => void save({ every_hours: h })}
                className={cn(
                  "h-9 min-w-11 rounded-lg border px-2.5 text-xs transition-colors",
                  row?.every_hours === h
                    ? "border-primary bg-accent font-medium text-accent-foreground"
                    : "border-border hover:bg-accent/40",
                )}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <Label htmlFor="bk-keep" className="text-[13px]">
              {t("bk.keep")}
            </Label>
          </div>
          <Input
            id="bk-keep"
            inputMode="numeric"
            value={keep}
            onChange={(e) => setKeep(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={() => void save({})}
            className="w-20 text-center font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={() => void backupNow()} disabled={running || !configured}>
          {running ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <HardDriveDownload />
          )}
          {t("bk.now")}
        </Button>
      </div>

      {/* El estado real, sin adornos. Es lo único que responde a «¿de verdad se
          está copiando?», y esa pregunta solo importa el día que hace falta. */}
      <div
        className={cn(
          "mt-4 rounded-xl border p-4",
          broken ? "border-status-billed/40 bg-status-billed-soft/40" : "border-border bg-muted/40",
        )}
      >
        <div className="flex items-start gap-2.5">
          {broken ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-status-billed" />
          ) : (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-free" />
          )}
          <div className="min-w-0 text-xs leading-relaxed">
            <p className="font-medium tracking-tight">
              {!on
                ? t("bk.stateOff")
                : row?.last_error
                  ? t("bk.stateError")
                  : never
                    ? t("bk.stateNever")
                    : stale
                      ? t("bk.stateStale", { n: Math.floor(hoursSince ?? 0) })
                      : t("bk.stateOk")}
            </p>
            {row?.last_at ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {row.last_path}
              </p>
            ) : null}
            {row?.last_error ? (
              <p className="mt-1 text-muted-foreground">{row.last_error}</p>
            ) : null}
          </div>
        </div>
      </div>

      <BackupLog refreshKey={row?.last_at ?? null} running={running} />

      {/* Restaurar vive aquí abajo, separado y en rojo, porque es la única
          acción de la aplicación que borra trabajo hecho: todo lo cobrado desde
          la copia se pierde. No es un botón más de la misma fila. */}
      <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-tight">{t("bk.restore")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void pickRestore()}
            disabled={restoring}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            {restoring ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            {t("bk.restorePick")}
          </Button>
        </div>
      </div>

      <RestoreDialog
        file={candidate}
        onClose={() => setCandidate(null)}
        onConfirm={confirmRestore}
      />
    </div>
  );
}
