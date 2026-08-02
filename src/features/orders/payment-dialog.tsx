import { useRef, useState } from "react";
import { LoaderCircle, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/local";

/**
 * Cobro en un solo paso: método, referencia opcional y emisión del ticket.
 * Antes «Confirmar pago» cerraba la cuenta sin dejar registro de cómo se
 * cobró, que es justo lo que hace falta para cuadrar la caja al cierre.
 */
export function PaymentDialog({
  open,
  tableNumber,
  totalCents,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  tableNumber: number;
  totalCents: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (method: PaymentMethod, ref: string) => void;
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");

  // Al elegir tarjeta o transferencia, el cursor salta al número: el cajero
  // tiene el comprobante del datáfono en la mano justo en ese momento.
  const refInput = useRef<HTMLInputElement>(null);
  const pick = (m: PaymentMethod) => {
    setMethod(m);
    if (m !== "cash") requestAnimationFrame(() => refInput.current?.focus());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("pay.title", { n: tableNumber })}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="sunken flex items-baseline justify-between rounded-lg bg-muted/60 px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("pos.total")}
            </span>
            <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-primary">
              {formatCents(totalCents)}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("pay.method")}</Label>
            {/* Botones grandes en vez de desplegable: se cobra con prisa y a
                veces de pie. */}
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm transition-colors duration-150",
                    method === m
                      ? "border-primary bg-accent font-medium text-accent-foreground"
                      : "border-border hover:bg-accent/40",
                  )}
                >
                  {t(`method.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {method !== "cash" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-ref">{t("pay.ref")}</Label>
              <Input
                id="pay-ref"
                ref={refInput}
                value={reference}
                onChange={(e) => setReference(e.currentTarget.value)}
                inputMode="numeric"
                placeholder="000000"
                className="font-mono tabular-nums"
              />
              <p className="text-xs leading-snug text-muted-foreground">
                {t("pay.refHint")}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm(method, reference.trim())}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Printer />}
            {busy ? t("pay.printing") : t("pay.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
