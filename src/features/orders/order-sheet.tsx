import { useCallback, useMemo, useState } from "react";
import {
  ChefHat,
  CreditCard,
  LoaderCircle,
  ReceiptText,
  TicketPercent,
} from "lucide-react";

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
import { toast } from "sonner";

import { transaction, type Statement } from "@/lib/db";
import { cn } from "@/lib/utils";
import { elapsedSince, formatCents, tableLabel } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import { useFloor } from "@/providers/floor-provider";
import { useSession } from "@/providers/session-provider";
import type { OrderStatus, PaymentMethod, TableRow } from "@/types/local";

import { MenuPicker } from "@/features/orders/menu-picker";
import { OrderLines } from "@/features/orders/order-lines";
import { useOrder, type OrderLine } from "@/features/orders/use-order";
import { PaymentDialog } from "@/features/orders/payment-dialog";
import { DiscountDialog } from "@/features/orders/discount-dialog";
import { VoidDialog } from "@/features/orders/void-dialog";
import { useTicket } from "@/features/tickets/use-ticket";
import { usePrinting } from "@/features/printing/use-printing";

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
  const { staff } = useSession();
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
    voidLine,
  } = useOrder(table);

  const [payOpen, setPayOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidFor, setVoidFor] = useState<OrderLine | null>(null);

  // El descuento solo lo ofrece la pantalla a quien manda. No es una barrera
  // real —quien abra el fichero hace lo que quiera— pero evita que se conceda
  // por descuido, y `discount_by` deja dicho quién fue.
  const canDiscount = staff?.role === "admin" || staff?.role === "manager";
  const { generate, busy: printing } = useTicket();
  const { printKitchen, printVoid } = usePrinting();

  /**
   * Anular avisa a cocina si el plato ya había salido.
   *
   * Sin el papel de anulación la cocina termina un plato que nadie va a pagar:
   * la comanda original sigue clavada en el pase y allí no se ve la base de
   * datos. Si nunca se imprimió no hay nada que retirar y no se manda nada.
   */
  const onVoid = useCallback(
    async (line: OrderLine, reason: string) => {
      const ok = await voidLine(line, reason);
      if (ok && line.printed_at && table && order) {
        await printVoid({
          group: line.print_group,
          tableNumber: table.number,
          zoneId: table.zone_id,
          orderId: order.id,
          name: line.product_name,
          quantity: line.quantity,
          reason: reason.trim() || null,
        });
      }
      return ok;
    },
    [voidLine, printVoid, table, order],
  );

  const sendToKitchen = useCallback(async () => {
    if (!order || !table) return;
    const sent = await printKitchen(order.id, table.number, table.zone_id);
    if (sent) {
      toast.success(t("sheet.sentToKitchen", { n: sent }));
      await reload();
    } else {
      // Sin ruta de impresión no hay nada que hacer, pero aquí sí conviene
      // decirlo: el botón se pulsó a propósito.
      toast.error(t("print.noPrinters"));
    }
  }, [order, table, printKitchen, reload, t]);

  const action = order ? NEXT_ACTION[order.status] : undefined;
  const readOnly = order?.status === "billed";

  /** Solo las líneas vivas llevan descuento; una anulada no se cobra. */
  const liveItems = useMemo(() => items.filter((i) => !i.voided_at), [items]);

  // Líneas que todavía no han salido a cocina. Se cuenta sobre lo que ya está
  // cargado: una consulta más por render, para el mismo dato, solo añade
  // parpadeo.
  const pending = liveItems.filter((i) => !i.printed_at).length;

  /**
   * Escribe el descuento sobre una cuenta que ya existe.
   *
   * Los importes, el motivo y la firma van en la misma transacción: por
   * separado podría quedar un descuento sin decir quién ni por qué, que es
   * justo lo que hay que poder auditar.
   */
  const applyDiscount = useCallback(
    async (parts: number[] | null, reason: string) => {
      if (!order) return;
      const statements: Statement[] = liveItems.map((item, i) => ({
        sql: "UPDATE order_items SET discount_cents = $1 WHERE id = $2",
        values: [parts ? parts[i] : 0, item.id],
      }));
      statements.push({
        sql: "UPDATE orders SET discount_reason = $1, discount_by = $2 WHERE id = $3",
        values: [
          parts ? reason : null,
          parts ? (staff?.id ?? null) : null,
          order.id,
        ],
      });
      try {
        await transaction(statements);
        toast.success(parts ? t("disc.applied") : t("disc.removed"));
        setDiscountOpen(false);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [order, liveItems, staff?.id, reload, t],
  );

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
    async (
      method: PaymentMethod,
      reference: string,
      tipCents: number,
      tenderedCents: number | null,
    ) => {
      if (!order || !table) return;
      const ok = await settle(method, reference, tipCents, tenderedCents);
      if (!ok) return;
      setPayOpen(false);
      // El ticket sale con la propina y lo entregado ya puestos: quien los
      // guardó fue la base, así que el objeto que tenemos en memoria todavía
      // los lleva a cero.
      await generate(
        {
          ...order,
          status: "paid",
          tip_cents: tipCents,
          tendered_cents: tenderedCents,
        },
        table.number,
        { method, reference },
      );
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
          {tableLabel(table.number, t("pos.counterShort"))}
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
                onVoid={setVoidFor}
                canVoid={canDiscount}
                readOnly={!!readOnly}
              />
            </div>
          </div>
        )}

        {order && action ? (
          <SheetFooter className="flex-row items-center justify-between gap-2 border-t border-border p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {items.length}{" "}
                {items.length === 1 ? t("sheet.lineOne") : t("sheet.lineMany")}
              </span>
              {/* Sin `readOnly`: el descuento se pide justo cuando la cuenta ya
                  está por cobrar y el cliente mira el papel. Bloquearlo ahí
                  dejaba el botón fuera del único momento en que hace falta.
                  Añadir productos sigue bloqueado; eso sí desincronizaría el
                  ticket ya impreso. */}
              {canDiscount && items.length > 0 ? (
                <Button
                  variant={order.discount_cents > 0 ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setDiscountOpen(true)}
                  className={cn(order.discount_cents > 0 && "text-status-billed")}
                >
                  <TicketPercent />
                  {order.discount_cents > 0
                    ? t("disc.short", { n: formatCents(order.discount_cents) })
                    : t("disc.title")}
                </Button>
              ) : null}
            </div>
            {/* Mandar a cocina lo que aún no salió. Antes esto solo pasaba al
                guardar desde el POS, así que un plato añadido aquí no llegaba
                nunca a la cocina. */}
            {pending > 0 && !readOnly ? (
              <Button variant="outline" onClick={() => void sendToKitchen()}>
                <ChefHat />
                {t("sheet.toKitchen", { n: pending })}
              </Button>
            ) : null}
            <Button
              onClick={() => void onAction()}
              disabled={busy || items.length === 0}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <action.icon />}
              {t(action.labelKey)}
            </Button>
          </SheetFooter>
        ) : null}

        <VoidDialog
          line={voidFor}
          onClose={() => setVoidFor(null)}
          onConfirm={onVoid}
        />

        {order ? (
          <DiscountDialog
            open={discountOpen}
            bases={liveItems.map((i) => i.quantity * i.unit_price_cents)}
            taxBps={liveItems.map((i) => i.tax_bp)}
            initialReason={order.discount_reason}
            canClear={order.discount_cents > 0}
            busy={busy}
            onClose={() => setDiscountOpen(false)}
            onApply={(parts, reason) => void applyDiscount(parts, reason)}
            onClear={() => void applyDiscount(null, "")}
          />
        ) : null}

        {order && table ? (
          <PaymentDialog
            open={payOpen}
            tableNumber={table.number}
            totalCents={order.total_cents}
            busy={busy || printing}
            onCancel={() => setPayOpen(false)}
            onConfirm={(method, reference, tipCents, tenderedCents) =>
              void onSettle(method, reference, tipCents, tenderedCents)
            }
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
