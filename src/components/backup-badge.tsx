import { useNavigate } from "react-router";
import { HardDriveDownload } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { useBackup } from "@/features/backup/use-backup";

/** Dos intervalos sin copiar ya no es un retraso, es que algo dejó de funcionar. */
const STALE_FACTOR = 2;

/**
 * Aviso de copias.
 *
 * Solo aparece cuando hay algo que decir. Una copia que dejó de hacerse —el USB
 * desenchufado, la carpeta renombrada— no se nota sola: la carpeta simplemente
 * deja de crecer y nadie mira una carpeta hasta el día que la necesita.
 *
 * Cuando está apagada del todo tampoco insiste. Es una decisión legítima, y un
 * icono permanente de reproche se aprende a ignorar en una semana.
 */
export function BackupBadge() {
  const { row, hoursSince } = useBackup();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (!row || row.enabled !== 1) return null;

  const stale =
    hoursSince !== null && hoursSince > row.every_hours * STALE_FACTOR;
  const never = hoursSince === null;
  if (!row.last_error && !stale && !never) return null;

  const label = row.last_error
    ? t("bk.stateError")
    : never
      ? t("bk.stateNever")
      : t("bk.stateStale", { n: Math.floor(hoursSince ?? 0) });

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/settings")}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors duration-150",
        "text-status-billed hover:bg-status-billed-soft",
      )}
    >
      <HardDriveDownload className="size-4" />
    </button>
  );
}
