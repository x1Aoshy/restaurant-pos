import { Ban, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import type { OrderLine } from "@/features/orders/use-order";
import type { OrderRow } from "@/types/local";

interface TaxRow {
  bp: number;
  base: number;
  tax: number;
}

export function OrderLines({
  order,
  items,
  taxBreakdown,
  onQuantity,
  onVoid,
  canVoid,
  readOnly,
}: {
  order: OrderRow;
  items: OrderLine[];
  taxBreakdown: TaxRow[];
  onQuantity: (item: OrderLine, quantity: number) => void;
  onVoid: (item: OrderLine) => void;
  canVoid: boolean;
  readOnly: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-4">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("lines.empty")}
            </p>
          ) : null}

          {items.map((item) => {
            const voided = item.voided_at !== null;
            const net = item.quantity * item.unit_price_cents - item.discount_cents;

            return (
              <div
                key={item.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2",
                  "transition-colors duration-150 hover:bg-muted/50",
                  // La anulada se queda a la vista, apagada. Ocultarla sería lo
                  // mismo que borrarla, y el motivo de no borrarla es que se vea.
                  voided && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-sm tracking-tight",
                      voided && "line-through",
                    )}
                  >
                    {item.product_name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                    {voided
                      ? `${t("void.voided")}${item.void_reason ? ` · ${item.void_reason}` : ""}`
                      : `${formatCents(item.unit_price_cents)} · ${formatBp(item.tax_bp)}`}
                  </div>
                </div>

                {readOnly || voided ? (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {item.quantity}×
                  </span>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("a11y.removeUnit")}
                      // Con una sola unidad no queda nada que restar: quitarla
                      // entera es anular, y eso tiene su propio botón y su
                      // propio motivo.
                      disabled={item.quantity === 1}
                      onClick={() => onQuantity(item, item.quantity - 1)}
                    >
                      <Minus />
                    </Button>
                    <span className="w-6 text-center font-mono text-sm tabular-nums">
                      {item.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("a11y.addUnit")}
                      onClick={() => onQuantity(item, item.quantity + 1)}
                    >
                      <Plus />
                    </Button>
                    {canVoid ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t("void.title")}
                        aria-label={t("void.title")}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => onVoid(item)}
                      >
                        <Ban />
                      </Button>
                    ) : null}
                  </div>
                )}

                <span
                  className={cn(
                    "w-20 shrink-0 text-right font-mono text-sm tabular-nums",
                    voided && "line-through",
                  )}
                >
                  {item.discount_cents > 0 && !voided ? (
                    <span className="mr-1 text-[0.65rem] text-muted-foreground line-through">
                      {formatCents(item.quantity * item.unit_price_cents)}
                    </span>
                  ) : null}
                  {formatCents(net)}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/50 p-4 backdrop-blur-xl">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{t("pos.subtotal")}</span>
          <span className="font-mono tabular-nums">
            {formatCents(order.subtotal_cents)}
          </span>
        </div>

        {order.discount_cents > 0 ? (
          <div className="mt-1.5 flex items-baseline justify-between text-xs">
            <span className="text-status-billed">
              {t("ticket.discount")}
              {order.discount_reason ? ` · ${order.discount_reason}` : ""}
            </span>
            <span className="font-mono tabular-nums text-status-billed">
              −{formatCents(order.discount_cents)}
            </span>
          </div>
        ) : null}

        {taxBreakdown.map((row) => (
          <div
            key={row.bp}
            className="mt-1.5 flex items-baseline justify-between text-xs text-muted-foreground"
          >
            <span>
              {t("pos.tax")} {formatBp(row.bp)}
            </span>
            <span className="font-mono tabular-nums">{formatCents(row.tax)}</span>
          </div>
        ))}

        <Separator className="my-3" />

        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium tracking-tight">{t("pos.total")}</span>
          {/* Directo de la base: nunca se recalcula en el cliente. */}
          <span className="font-mono text-lg font-medium tabular-nums tracking-tight">
            {formatCents(order.total_cents)}
          </span>
        </div>
      </div>
    </div>
  );
}
