import { CloudAlert, CloudOff, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { useSync } from "@/providers/sync-provider";

/**
 * Estado de la sincronización, en el raíl.
 *
 * Callado mientras todo va bien: un indicador permanente de «correcto» es
 * ruido, nadie lo mira hasta que falla. Solo aparece cuando hay algo que decir
 * —está subiendo, hay cambios atascados o falló— y desaparece al arreglarse.
 */
export function SyncBadge() {
  const { status, pending, errorKey, syncNow } = useSync();
  const { t } = useI18n();

  if (status === "off") return null;

  const broken = status === "error" || status === "unconfigured";
  const busy = status === "syncing";

  // Al día y sin nada pendiente: no hay nada que contar.
  if (!broken && !busy && pending === 0) return null;

  const label = broken
    ? t(errorKey ?? "sync.errNetwork")
    : busy
      ? t("sync.syncing")
      : t("sync.pending", { n: pending });

  const Icon = status === "unconfigured" ? CloudOff : broken ? CloudAlert : RefreshCw;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={`${label} · ${t("sync.syncNow")}`}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors duration-150",
        broken
          ? "text-status-billed hover:bg-status-billed-soft"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", busy && "animate-spin")} />
    </button>
  );
}
