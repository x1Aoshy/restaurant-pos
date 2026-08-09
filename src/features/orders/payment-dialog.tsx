import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, Printer } from "lucide-react";

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
import { COUNTER_TABLE, formatCents } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import {
  cashSplit,
  cashSuggestions,
  notesFor,
  parseAmount,
} from "@/features/orders/cash";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/local";

/** Porcentajes sugeridos. Se calculan sobre la venta, nunca sobre venta+propina. */
const TIP_PERCENTS = [10, 15, 20] as const;

type TipMode = "none" | 10 | 15 | 20 | "custom";
type Step = "method" | "tendered" | "reference" | "confirm";

/** Centavos a lo que se teclea: 50000 → «500». Sin decimales si son cero. */
function unitsOf(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Cobro paso a paso.
 *
 * ## Por qué en pasos y no todo junto
 *
 * Cabía todo en una pantalla, y se probó dos veces. El problema no era el
 * tamaño: era que había cuatro decisiones a la vista a la vez y ninguna pedía
 * el turno. Quien cobra lo hace de pie, con el cliente delante y con prisa, y
 * en esa situación una pantalla con cuatro grupos se lee como un formulario.
 *
 * Una pregunta por ventana no se puede leer mal. Y cada paso puede usar toda
 * la anchura: los botones son grandes y el número que importa —lo que se cobra
 * primero, el cambio después— es lo más grande de su pantalla.
 *
 * El camino normal son tres toques: efectivo, con qué billete, cobrar.
 *
 * ## Lo que no se puede hacer sin querer
 *
 * - El cambio no aparece hasta que se dice con cuánto paga, así que no hay un
 *   «0,00» al que acostumbrarse a ignorar.
 * - Enter avanza desde un campo, pero **nunca cobra**. Cobrar es siempre un
 *   clic deliberado en el último paso.
 * - Se puede volver atrás en cualquier momento sin perder lo tecleado.
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
  onConfirm: (
    method: PaymentMethod,
    ref: string,
    tipCents: number,
    tenderedCents: number | null,
  ) => void;
}) {
  const { t } = useI18n();
  const { settings } = useSession();

  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [tipMode, setTipMode] = useState<TipMode>("none");
  const [tipOpen, setTipOpen] = useState(false);
  const [customTip, setCustomTip] = useState("");
  const [tendered, setTendered] = useState("");


  // Cada cobro empieza de cero y por el principio. Sin esto, la propina del
  // cliente anterior aparecería marcada en el siguiente.
  useEffect(() => {
    if (!open) return;
    setStep("method");
    setMethod("cash");
    setReference("");
    setTipMode("none");
    setTipOpen(false);
    setCustomTip("");
    setTendered("");
  }, [open]);

  const tipCents =
    tipMode === "none"
      ? 0
      : tipMode === "custom"
        ? (parseAmount(customTip) ?? 0)
        : Math.round((totalCents * tipMode) / 100);

  const chargeCents = totalCents + tipCents;
  const tenderedCents = parseAmount(tendered);
  const { changeCents: change, shortCents: short } = cashSplit(
    chargeCents,
    tenderedCents,
  );
  const suggestions = cashSuggestions(chargeCents, notesFor(settings?.currency ?? "NIO"));
  const cash = method === "cash";

  const pickMethod = (m: PaymentMethod) => {
    setMethod(m);
    setStep(m === "cash" ? "tendered" : "reference");
  };

  const pickAmount = (cents: number) => {
    setTendered(unitsOf(cents));
    setStep("confirm");
  };

  const back = () => {
    if (step === "confirm") setStep(cash ? "tendered" : "reference");
    else setStep("method");
  };

  const steps: Step[] = cash
    ? ["method", "tendered", "confirm"]
    : ["method", "reference", "confirm"];
  const position = steps.indexOf(step) + 1;

  /** Botón grande de elección. Toda la anchura disponible entre dos columnas. */
  const bigButton = (key: string, label: string, onClick: () => void, sub?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-border",
        "text-base transition-colors duration-150 hover:border-primary hover:bg-accent/50",
        "active:scale-[0.98]",
      )}
    >
      <span className="font-medium">{label}</span>
      {sub ? (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {sub}
        </span>
      ) : null}
    </button>
  );

  const question =
    step === "method"
      ? t("pay.stepMethod")
      : step === "tendered"
        ? t("pay.stepTendered")
        : step === "reference"
          ? t("pay.stepReference")
          : t("pay.stepConfirm");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* El contador de pasos NO va aquí: la esquina superior derecha la
              ocupa la X de cerrar, que va en `absolute`, y se pisaban. */}
          <DialogTitle>
            {tableNumber === COUNTER_TABLE
              ? t("pay.titleCounter", { n: t("pos.counterShort") })
              : t("pay.title", { n: tableNumber })}
          </DialogTitle>
        </DialogHeader>

        <div
          className="flex flex-col gap-4 py-1"
          onKeyDown={(e) => {
            // Enter AVANZA, nunca cobra. Cobrar es un clic deliberado en el
            // último paso: si Enter también cobrara, una pulsación de más
            // cerraría la cuenta sin que nadie hubiera visto el cambio.
            if (e.key !== "Enter") return;
            if ((e.target as HTMLElement).tagName !== "INPUT") return;
            if (step === "tendered" || step === "reference") setStep("confirm");
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">{question}</p>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {t("pay.step", { n: position, m: steps.length })}
            </span>
          </div>

          {step === "method" ? (
            <>
              <div className="sunken rounded-xl bg-muted/60 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("pay.toCharge")}
                </div>
                <div className="mt-1 font-mono text-4xl font-semibold leading-none tracking-tight text-primary tabular-nums">
                  {formatCents(chargeCents)}
                </div>
                {tipCents > 0 ? (
                  <div className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatCents(totalCents)} + {formatCents(tipCents)} {t("pay.tip")}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((m) =>
                  bigButton(m, t(`method.${m}`), () => pickMethod(m)),
                )}
              </div>

              {/* La propina, plegada. Es lo que menos se usa y ocupaba la
                  primera fila; aquí no estorba a quien no la cobra. */}
              {tipOpen || tipCents > 0 ? (
                <div className="grid grid-cols-5 gap-1">
                  {(["none", ...TIP_PERCENTS, "custom"] as TipMode[]).map((mode) => (
                    <button
                      key={String(mode)}
                      type="button"
                      onClick={() => {
                        setTipMode(mode);
                        if (mode !== "custom") setCustomTip("");
                      }}
                      className={cn(
                        "h-9 rounded-lg border text-xs transition-colors duration-150",
                        tipMode === mode
                          ? "border-primary bg-accent font-medium text-accent-foreground"
                          : "border-border hover:bg-accent/40",
                      )}
                    >
                      {mode === "none"
                        ? t("pay.noTip")
                        : mode === "custom"
                          ? t("pay.otherTip")
                          : `${mode}%`}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setTipOpen(true)}
                  className="self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  + {t("pay.tip")}
                </button>
              )}

              {tipMode === "custom" ? (
                <Input
                  value={customTip}
                  onChange={(e) => setCustomTip(e.currentTarget.value)}
                  inputMode="decimal"
                  placeholder={t("pay.tenderedPh")}
                  className="h-10 text-right font-mono tabular-nums"
                />
              ) : null}
            </>
          ) : null}

          {step === "tendered" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {bigButton(
                  "exact",
                  t("pay.exact"),
                  () => pickAmount(chargeCents),
                  formatCents(chargeCents),
                )}
                {suggestions.map((v) =>
                  bigButton(String(v), formatCents(v), () => pickAmount(v)),
                )}
              </div>

              {/* Se escribe en la moneda, no en centavos: teclear 500 son
                  quinientos. La versión anterior llenaba por la derecha y
                  quinientos había que escribirlos «50000». */}
              <div className="flex flex-col gap-1.5">
                <span className="px-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("pay.otherAmount")}
                </span>
                <Input
                  autoFocus
                  value={tendered}
                  onChange={(e) => setTendered(e.currentTarget.value)}
                  inputMode="decimal"
                  placeholder={t("pay.tenderedPh")}
                  className="h-11 text-right font-mono text-lg tabular-nums"
                />
              </div>
            </>
          ) : null}

          {step === "reference" ? (
            <Input
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.currentTarget.value)}
              inputMode="numeric"
              placeholder="000000"
              className="h-11 font-mono text-lg tabular-nums"
            />
          ) : null}

          {step === "confirm" ? (
            <>
              {/* El cambio, en el tamaño más grande del diálogo: es la cifra
                  que se cuenta en billetes delante del cliente. Solo sale si
                  hay algo que devolver. */}
              {cash && (change > 0 || short > 0) ? (
                <div
                  className={cn(
                    "rounded-xl px-4 py-4",
                    short > 0 ? "bg-destructive/10" : "bg-status-free/10",
                  )}
                >
                  <div
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-wider",
                      short > 0 ? "text-destructive" : "text-status-free",
                    )}
                  >
                    {short > 0 ? t("pay.short") : t("pay.change")}
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-5xl font-semibold leading-none tracking-tight tabular-nums",
                      short > 0 ? "text-destructive" : "text-status-free",
                    )}
                  >
                    {formatCents(short > 0 ? short : change)}
                  </div>
                </div>
              ) : null}

              <div className="sunken flex flex-col gap-2 rounded-xl bg-muted/60 px-4 py-3">
                {tipCents > 0 ? (
                  <>
                    <Row label={t("pos.total")} value={formatCents(totalCents)} />
                    <Row label={t("pay.tip")} value={`+${formatCents(tipCents)}`} />
                  </>
                ) : null}
                <Row
                  label={t("pay.toCharge")}
                  value={formatCents(chargeCents)}
                  strong
                />
                <div className="border-t border-border" />
                <Row label={t("pay.method")} value={t(`method.${method}`)} />
                {cash && tenderedCents !== null ? (
                  <Row label={t("pay.tendered")} value={formatCents(tenderedCents)} />
                ) : null}
                {!cash && reference.trim() ? (
                  <Row label={t("pay.ref")} value={reference.trim()} />
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {step === "method" ? (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t("common.cancel")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={back} disabled={busy}>
              <ArrowLeft />
              {t("pay.back")}
            </Button>
          )}

          {step === "confirm" ? (
            <Button onClick={
              () => onConfirm(method, reference.trim(), tipCents, cash ? tenderedCents : null)
            } disabled={busy} className="h-11 flex-1 sm:flex-none">
              {busy ? <LoaderCircle className="animate-spin" /> : <Printer />}
              {busy
                ? t("pay.printing")
                : short > 0
                  ? t("pay.confirmShort")
                  : `${t("pay.confirm")} ${formatCents(chargeCents)}`}
            </Button>
          ) : step === "method" ? null : (
            <Button onClick={() => setStep("confirm")} disabled={busy} className="h-11">
              {t("pay.next")}
              <ArrowRight />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Una línea del resumen final. */
function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={cn(
          "text-xs",
          strong
            ? "font-semibold uppercase tracking-wider"
            : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums leading-none",
          strong ? "text-2xl font-semibold tracking-tight text-primary" : "text-sm",
        )}
      >
        {value}
      </span>
    </div>
  );
}
