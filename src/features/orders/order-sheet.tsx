import { useCallback, useMemo, useState } from "react";
import { CreditCard, LoaderCircle, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { elapsedSince } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import { useFloor } from "@/providers/floor-provider";
import type { OrderStatus, PaymentMethod, TableRow } from "@/types/local";

import { MenuPicker } from "@/features/orders/menu-picker";
import { OrderLines } from "@/features/orders/order-lines";
import { useOrder } from "@/features/orders/use-order";
import { PaymentDialog } from "@/features/orders/payment-dialog";
import { useTicket } from "@/features/tickets/use-ticket";

const STATUS_KEY: Record<OrderStatus, string> = {
  open: "status.open",
  sent_to_kitchen: "status.kitchen",
  served: "status.served",
  billed: "floor.billed",
  paid: "billing.paid",
  cancelled: "billing.cancelled",
};

/**
 * Una sola acción por etapa. `sent_to_kitchen` y `served` no están en el camino
 * del mesero: con un terminal y comandas en papel no hay a quién pasarlas.
 * Siguen en el esquema por si algún día hay pantalla en cocina.
 */
const NEXT_ACTION: Partial<
  Record<OrderStatus, { labelKey: string; next: OrderStatus; icon: typeof CreditCard }>
> = {
  open: { labelKey: "sheet.charge", next: "billed", icon: ReceiptText },
  sent_to_kitchen: { labelKey: "sheet.charge", next: "billed", icon: ReceiptText },
  served: { labelKey: "sheet.charge", next: "billed", icon: ReceiptText },
  billed: { labelKey: "sheet.confirmPay", next: "paid", icon: CreditCard },
};

function sqliteToIso(value: string) {
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}

export function OrderSheet({
  table,
  onOpenChange,
}: {
  table: TableRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { reload } = useFloor();
  const {
    order,
    items,
    busy,
    taxBreakdown,
    openOrder,
    addProduct,
    setQuantity,
    setStatus,
    settle,
  } = useOrder(table);

  const [payOpen, setPayOpen] = useState(false);
  const { generate, busy: printing } = useTicket();

  const action = order ? NEXT_ACTION[order.status] : undefined;
  const readOnly = order?.status === "billed";

  const onAction = useCallback(async () => {
    if (!action) return;
    // Pasar a «pagado» abre el cobro: hay que registrar el método, no solo
    // cambiar el estado.
    if (action.next === "paid") {
      setPayOpen(true);
      return;
    }
    await setStatus(action.next);
  }, [action, setStatus]);

  /** Cobrar, emitir el ticket y cerrar — en ese orden. */
  const onSettle = useCallback(
    async (method: PaymentMethod, reference: string) => {
      if (!order || !table) return;
      const ok = await settle(method, reference);
      if (!ok) return;
      setPayOpen(false);
      await generate({ ...order, status: "paid" }, table.number, {
        method,
        reference,
      });
      await reload();
      onOpenChange(false);
    },
    [order, table, settle, generate, reload, onOpenChange],
  );

  const header = useMemo(() => {
    if (!table) return null;
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-2xl font-medium tabular-nums tracking-tight">
          {String(table.number).padStart(2, "0")}
        </span>
        <div className="flex flex-col gap-1">
          <SheetTitle className="text-sm">
            {t("sheet.tableMeta", { n: table.number, c: table.capacity })}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 text-xs">
            {order ? (
              <>
                <Badge variant="outline" className="text-[0.65rem]">
                  {t(STATUS_KEY[order.status])}
                </Badge>
                <span className="tabular-nums">
                  {elapsedSince(sqliteToIso(order.created_at))}
                </span>
              </>
            ) : (
              <span>{t("floor.free")}</span>
            )}
          </SheetDescription>
        </div>
      </div>
    );
  }, [table, order, t]);

  return (
    <Sheet open={table !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          // Sobrescribir el ancho necesita el mismo prefijo data-[side], si no
          // tailwind-merge conserva las dos reglas y gana la estrecha.
          "data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:xl:max-w-4xl",
          "gap-0 border-border bg-popover/80 p-0 backdrop-blur-xl",
        )}
      >
        <SheetHeader className="border-b border-border p-4">{header}</SheetHeader>

        {!table ? null : !order ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10 text-center">
            <div>
              <p className="text-sm font-medium tracking-tight">
                {t("sheet.isFree", { n: table.number })}
              </p>
            </div>
            <Button onClick={() => void openOrder()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t("sheet.open")}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="flex min-h-0 flex-1 flex-col lg:border-r lg:border-border">
              <MenuPicker onAdd={(p) => void addProduct(p)} disabled={readOnly} />
            </div>
            <div className="flex min-h-0 flex-col border-t border-border lg:w-[24rem] lg:border-t-0">
              <OrderLines
                order={order}
                items={items}
                taxBreakdown={taxBreakdown}
                onQuantity={(item, qty) => void setQuantity(item, qty)}
                readOnly={!!readOnly}
              />
            </div>
          </div>
        )}

        {order && action ? (
          <SheetFooter className="flex-row items-center justify-between gap-2 border-t border-border p-4">
            <span className="text-xs text-muted-foreground">
              {items.length}{" "}
              {items.length === 1 ? t("sheet.lineOne") : t("sheet.lineMany")}
            </span>
            <Button
              onClick={() => void onAction()}
              disabled={busy || items.length === 0}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <action.icon />}
              {t(action.labelKey)}
            </Button>
          </SheetFooter>
        ) : null}

        {order && table ? (
          <PaymentDialog
            open={payOpen}
            tableNumber={table.number}
            totalCents={order.total_cents}
            busy={busy || printing}
            onCancel={() => setPayOpen(false)}
            onConfirm={(method, reference) => void onSettle(method, reference)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
