import { useEffect, useState } from "react";
import { Ban, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import type { OrderLine } from "@/features/orders/use-order";

/** Los motivos de siempre. Cualquier otra cosa se escribe. */
const PRESETS = ["void.mistake", "void.returned", "void.outOfStock", "void.customer"];

/**
 * Anular una línea de la comanda.
 *
 * El motivo no es papeleo: una anulación sin explicación es indistinguible de
 * comida que salió de la cocina y nadie pagó. Con el motivo y quién lo hizo, un
 * patrón raro se ve en el historial; sin ellos, no se ve nada.
 *
 * Avisa si el inventario se devuelve o no, porque no es lo mismo un plato que
 * se apuntó por error —la comida no se hizo— que uno que volvió de la mesa. El
 * sistema no puede saber cuál es, así que lo dice y deja decidir.
 */
export function VoidDialog({
  line,
  onClose,
  onConfirm,
}: {
  line: OrderLine | null;
  onClose: () => void;
  onConfirm: (line: OrderLine, reason: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (line) setReason("");
  }, [line]);

  const confirm = async () => {
    if (!line) return;
    setBusy(true);
    const ok = await onConfirm(line, reason);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={line !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("void.title")}</DialogTitle>
        </DialogHeader>

        {line ? (
          <div className="flex flex-col gap-4 py-1">
            <div className="sunken flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {line.quantity}×
                </span>
                <span className="truncate text-sm font-medium tracking-tight">
                  {line.product_name}
                </span>
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums">
                {formatCents(line.quantity * line.unit_price_cents - line.discount_cents)}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setReason(t(key))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      reason === t(key)
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border hover:bg-accent/40",
                    )}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <Input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
                placeholder={t("void.reasonPh")}
              />
            </div>

          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={busy || reason.trim() === ""}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Ban />}
            {t("void.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
