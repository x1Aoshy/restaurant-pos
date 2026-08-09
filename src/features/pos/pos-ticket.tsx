import { useState } from "react";
import {
  CircleAlert,
  LoaderCircle,
  TicketPercent,
  Minus,
  Plus,
  Save,
  Store,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import type { useDraft } from "@/features/pos/use-draft";
import { PaymentDialog } from "@/features/orders/payment-dialog";
import { DiscountDialog } from "@/features/orders/discount-dialog";
import { useSession } from "@/providers/session-provider";
import { useTicket } from "@/features/tickets/use-ticket";
import { queryOne } from "@/lib/db";
import type { OrderRow, PaymentMethod } from "@/types/local";

export function PosTicket({ draft }: { draft: ReturnType<typeof useDraft> }) {
  const { t } = useI18n();
  const {
    tableNumber,
    setTableNumber,
    table,
    existingOrder,
    lines,
    preview,
    saving,
    setQuantity,
    clear,
    commit,
    counterSale,
  } = draft;

  const { generate } = useTicket();
  const { staff, settings } = useSession();

  // Mismo candado que en la mesa: la pantalla solo se lo ofrece a quien manda,
  // y `discount_by` deja dicho quién fue.
  const canDiscount = staff?.role === "admin" || staff?.role === "manager";
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<{ parts: number[]; reason: string } | null>(
    null,
  );

  const [counterOpen, setCounterOpen] = useState(false);

  const bases = lines.map((l) => l.quantity * l.product.price_cents);
  const discountCents = discount?.parts.reduce((n, d) => n + d, 0) ?? 0;

  // Si cambian las líneas, el reparto guardado deja de corresponderse con
  // ellas. Se descarta en vez de aplicarlo mal.
  if (discount && discount.parts.length !== lines.length) setDiscount(null);

  /** Cobra y emite el ticket de una venta de mostrador. */
  const onCounter = async (
    method: PaymentMethod,
    reference: string,
    tipCents: number,
    tenderedCents: number | null,
  ) => {
    const orderId = await counterSale(
      method,
      reference,
      tipCents,
      tenderedCents,
      discount,
    );
    if (!orderId) return;
    setCounterOpen(false);
    // La cuenta se relee de la base: los totales los acaba de calcular un
    // trigger y el objeto que tenemos aquí es solo la previsualización.
    const order = await queryOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [
      orderId,
    ]);
    if (order) await generate(order, 0, { method, reference });
    setDiscount(null);
  };

  const unknownTable = tableNumber.trim() !== "" && !table;
  const billedTable = existingOrder?.status === "billed";
  const canSave = !!table && lines.length > 0 && !saving && !billedTable;

  return (
    <div className="raised z-10 flex min-h-0 w-[24rem] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <label
          htmlFor="pos-table"
          className="shrink-0 text-xs font-medium text-muted-foreground"
        >
          {t("pos.table")}
        </label>
        <Input
          id="pos-table"
          data-tour="pos-table"
          inputMode="numeric"
          value={tableNumber}
          onChange={(e) =>
            setTableNumber(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))
          }
          placeholder="00"
          className={cn(
            "h-10 w-20 shrink-0 text-center font-mono text-xl tabular-nums",
            unknownTable && "border-destructive",
          )}
        />
        <div className="min-w-0 flex-1 text-xs leading-snug">
          {unknownTable ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <CircleAlert className="size-3.5 shrink-0" />
              {t("pos.unknownTable", { n: tableNumber })}
            </span>
          ) : billedTable ? (
            <span className="flex items-center gap-1.5 text-status-billed">
              <CircleAlert className="size-3.5 shrink-0" />
              {t("pos.billedWarn")}
            </span>
          ) : existingOrder ? (
            <span className="text-muted-foreground">
              {t("pos.openAccount")} ·{" "}
              <span className="font-mono tabular-nums">
                {formatCents(existingOrder.total_cents)}
              </span>
              <br />
              {t("pos.willAppend")}
            </span>
          ) : table ? (
            <span className="text-muted-foreground">
              {t("pos.newAccount", { n: table.capacity })}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("pos.writeTable")}</span>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {lines.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("pos.emptyDraft")}
              <br />
            </p>
          ) : null}

          {lines.map((line) => (
            <div
              key={line.product.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm tracking-tight">
                  {line.product.name}
                </div>
                <div className="font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                  {formatCents(line.product.price_cents)}
                </div>
              </div>

              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("a11y.removeUnit")}
                  onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                >
                  {line.quantity === 1 ? <Trash2 /> : <Minus />}
                </Button>
                <span className="w-6 text-center font-mono text-sm tabular-nums">
                  {line.quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("a11y.addUnit")}
                  onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                >
                  <Plus />
                </Button>
              </div>

              <span className="w-[4.25rem] shrink-0 text-right font-mono text-sm tabular-nums">
                {formatCents(line.quantity * line.product.price_cents)}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-3">
        {/* Línea troquelada: el corte de un ticket de papel. */}
        <div className="tear-line -mx-3 mb-3" />

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{t("pos.subtotal")}</span>
          <span className="font-mono tabular-nums">
            {formatCents(preview.subtotalCents)}
          </span>
        </div>

        {preview.byRate.map((row) => (
          <div
            key={row.bp}
            className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground"
          >
            <span>
              {t("pos.tax")} {formatBp(row.bp)}
            </span>
            <span className="font-mono tabular-nums">{formatCents(row.tax)}</span>
          </div>
        ))}

        {/* El descuento solo aparece en el camino del mostrador: en una mesa
            se guarda primero y se descuenta desde la comanda. Va como una fila
            más del desglose y no como otro botón, que es lo que sobraba. */}
        {canDiscount && tableNumber.trim() === "" && lines.length > 0 ? (
          <button
            type="button"
            onClick={() => setDiscountOpen(true)}
            className={cn(
              "mt-1.5 flex w-full items-baseline justify-between rounded-md px-1 py-1",
              "text-xs transition-colors hover:bg-accent/40",
              discountCents > 0 ? "text-status-billed" : "text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-1.5">
              <TicketPercent className="size-3.5" />
              {discount?.reason || t("disc.title")}
            </span>
            <span className="font-mono tabular-nums">
              {discountCents > 0 ? `−${formatCents(discountCents)}` : "+"}
            </span>
          </button>
        ) : null}

        <Separator className="my-2.5" />

        {/* El total es LA cifra de esta pantalla: hay que leerlo de pie. */}
        <div className="sunken flex items-baseline justify-between rounded-lg bg-muted/60 px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("pos.total")}
          </span>
          <span className="font-mono text-[1.75rem] font-semibold leading-none tracking-tight text-primary">
            {formatCents(preview.totalCents - discountCents)}
          </span>
        </div>

        {/* Una sola acción, la que toca.

            Con mesa escrita se guarda la comanda; sin mesa se cobra en el
            mostrador. Nunca las dos: son excluyentes por definición, y tener
            los dos botones a la vez obligaba a leerlos antes de pulsar. */}
        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={lines.length === 0 && tableNumber === ""}
            className="self-stretch"
          >
            {t("pos.clear")}
          </Button>
          {tableNumber.trim() === "" ? (
            <Button
              onClick={() => setCounterOpen(true)}
              disabled={lines.length === 0 || saving}
              className="h-11 flex-1 text-sm"
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Store />}
              {t("pos.counter")}
            </Button>
          ) : (
            <Button
              data-tour="pos-save"
              onClick={() => void commit()}
              disabled={!canSave}
              className="h-11 flex-1 text-sm"
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              {t("pos.save")}
            </Button>
          )}
        </div>

      </div>

      <DiscountDialog
        open={discountOpen}
        bases={bases}
        // La misma cadena de respaldo que usa la previsualización del total.
        // Con otra tasa aquí, el número del diálogo no sería el que se cobra.
        taxBps={lines.map(
          (l) => l.product.tax_bp ?? settings?.default_tax_bp ?? 1000,
        )}
        initialReason={discount?.reason}
        canClear={discountCents > 0}
        onClose={() => setDiscountOpen(false)}
        onApply={(parts, reason) => {
          setDiscount({ parts, reason });
          setDiscountOpen(false);
        }}
        onClear={() => {
          setDiscount(null);
          setDiscountOpen(false);
        }}
      />

      <PaymentDialog
        open={counterOpen}
        tableNumber={0}
        totalCents={preview.totalCents - discountCents}
        busy={saving}
        onCancel={() => setCounterOpen(false)}
        onConfirm={(method, reference, tipCents, tenderedCents) =>
          void onCounter(method, reference, tipCents, tenderedCents)
        }
      />
    </div>
  );
}
