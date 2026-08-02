import { Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  readOnly,
}: {
  order: OrderRow;
  items: OrderLine[];
  taxBreakdown: TaxRow[];
  onQuantity: (item: OrderLine, quantity: number) => void;
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

          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm tracking-tight">
                  {item.product_name}
                </div>
                <div className="mt-0.5 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                  {formatCents(item.unit_price_cents)} · {formatBp(item.tax_bp)}
                </div>
              </div>

              {readOnly ? (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {item.quantity}×
                </span>
              ) : (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("a11y.removeUnit")}
                    onClick={() => onQuantity(item, item.quantity - 1)}
                  >
                    {item.quantity === 1 ? <Trash2 /> : <Minus />}
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
                </div>
              )}

              <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums">
                {formatCents(item.quantity * item.unit_price_cents)}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/50 p-4 backdrop-blur-xl">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{t("pos.subtotal")}</span>
          <span className="font-mono tabular-nums">
            {formatCents(order.subtotal_cents)}
          </span>
        </div>

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
