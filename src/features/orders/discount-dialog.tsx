import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, TicketPercent } from "lucide-react";
import { toast } from "sonner";

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
import { lineTaxCents, parseCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { percentOff, prorate } from "@/features/orders/discount";

// El 100 % es invitar la cuenta entera. No necesita su propio botón: es un
// porcentaje más, y sacarlo de la fila obligaba a leer una línea de texto para
// entender algo que el número ya dice.
const PERCENTS = [10, 20, 50, 100] as const;

/** Motivos habituales. Escribir el mismo texto cada noche no aporta nada. */
const PRESETS = ["disc.staff", "disc.regular", "disc.promo", "disc.complaint"];

type Mode = { kind: "percent"; value: number } | { kind: "amount" };

/**
 * Elegir un descuento. No lo guarda.
 *
 * Devuelve el reparto ya calculado y el motivo; quien lo abrió decide qué hacer
 * con eso. La hoja de mesa lo escribe sobre una cuenta que ya existe, y el
 * mostrador lo mete en la misma transacción que crea la venta.
 *
 * Antes esto escribía en la base por su cuenta, y por eso la barra se quedaba
 * sin descuentos: allí no hay ninguna cuenta que actualizar todavía.
 *
 * Se pide el motivo **siempre**. Un descuento sin motivo es indistinguible de
 * dinero que falta, y a fin de mes nadie recuerda por qué la mesa 7 pagó menos.
 */
export function DiscountDialog({
  open,
  bases,
  taxBps,
  initialReason,
  canClear,
  busy,
  onApply,
  onClear,
  onClose,
}: {
  open: boolean;
  /** Importe bruto de cada línea, en el mismo orden que las líneas. */
  bases: number[];
  /** Tasa de cada línea, para enseñar el total con el impuesto ya aplicado. */
  taxBps: number[];
  initialReason?: string | null;
  canClear?: boolean;
  busy?: boolean;
  onApply: (parts: number[], reason: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const [mode, setMode] = useState<Mode>({ kind: "percent", value: 10 });
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const gross = bases.reduce((n, b) => n + b, 0);

  useEffect(() => {
    if (!open) return;
    setMode({ kind: "percent", value: 10 });
    setAmount("");
    setReason(initialReason ?? "");
  }, [open, initialReason]);

  const parts = useMemo(
    () =>
      mode.kind === "percent"
        ? percentOff(bases, mode.value)
        : prorate(bases, parseCents(amount) ?? 0),
    [mode, bases, amount],
  );

  const discountCents = parts.reduce((n, d) => n + d, 0);

  // El total se previsualiza con la misma fórmula que los triggers: base
  // rebajada, impuesto por línea. Si aquí se calculara de otra forma, el número
  // que ve quien autoriza no sería el que acaba cobrando.
  const preview = useMemo(() => {
    let tax = 0;
    bases.forEach((base, i) => {
      tax += lineTaxCents(1, base - parts[i], taxBps[i] ?? 0);
    });
    return gross - discountCents + tax;
  }, [bases, parts, taxBps, gross, discountCents]);

  const submit = () => {
    if (discountCents <= 0) return toast.error(t("disc.nothing"));
    if (reason.trim() === "") return toast.error(t("disc.needReason"));
    onApply(parts, reason.trim());
  };

  const chip = (active: boolean) =>
    cn(
      "h-12 rounded-xl border text-sm transition-colors duration-150 active:scale-[0.97]",
      active
        ? "border-primary bg-accent font-medium text-accent-foreground"
        : "border-border hover:bg-accent/40",
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("disc.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="grid grid-cols-5 gap-1.5">
            {PERCENTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setMode({ kind: "percent", value: p })}
                className={chip(mode.kind === "percent" && mode.value === p)}
              >
                {p}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMode({ kind: "amount" })}
              className={chip(mode.kind === "amount")}
            >
              {t("disc.amount")}
            </button>
          </div>

          {mode.kind === "amount" ? (
            <Input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              placeholder="0.00"
              className="h-12 text-center font-mono text-xl tabular-nums"
            />
          ) : null}

          {/* Los motivos habituales van dentro del campo, como sugerencias. Una
              fila de pastillas encima del cuadro era otra cosa que leer para
              acabar escribiendo lo mismo. */}
          <Input
            list="disc-reasons"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder={t("disc.reasonPh")}
          />
          <datalist id="disc-reasons">
            {PRESETS.map((key) => (
              <option key={key} value={t(key)} />
            ))}
          </datalist>

          {/* Una sola cifra: lo que va a pagar. El desglose ya está detrás. */}
          <div className="sunken flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("pay.toCharge")}
              </div>
              {discountCents > 0 ? (
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatCents(gross)} − {formatCents(discountCents)}
                </div>
              ) : null}
            </div>
            <span className="font-mono text-3xl font-semibold leading-none tracking-tight text-primary">
              {formatCents(preview)}
            </span>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {canClear && onClear ? (
            <Button
              variant="ghost"
              onClick={onClear}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
            >
              {t("disc.remove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <TicketPercent />}
              {t("disc.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
