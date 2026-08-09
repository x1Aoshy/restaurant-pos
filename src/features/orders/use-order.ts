import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { exec, newId, query } from "@/lib/db";
import { lineTaxCents } from "@/lib/money";
import { useFloor } from "@/providers/floor-provider";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";
import type {
  OrderItemRow,
  OrderStatus,
  ProductRow,
  TableRow,
} from "@/types/local";

/** Línea con el nombre del producto ya resuelto, para poder pintarla. */
export interface OrderLine extends OrderItemRow {
  product_name: string;
  /** De la carta, no de la línea: dice por qué impresora salió y sale. */
  print_group: string;
}

export function useOrder(table: TableRow | null) {
  const { staff, settings } = useSession();
  const { liveOrders, reload } = useFloor();
  const { t } = useI18n();

  const [items, setItems] = useState<OrderLine[]>([]);
  const [busy, setBusy] = useState(false);

  const order = table ? liveOrders[table.id] : undefined;
  const orderId = order?.id;

  const loadItems = useCallback(async (id: string) => {
    const rows = await query<OrderLine>(
      `SELECT oi.*, p.name AS product_name, p.print_group
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at`,
      [id],
    );
    setItems(rows);
  }, []);

  useEffect(() => {
    if (!orderId) {
      setItems([]);
      return;
    }
    void loadItems(orderId);
  }, [orderId, loadItems]);

  /** Recarga las líneas y el salón: los totales los recalculó un trigger. */
  const refresh = useCallback(async () => {
    if (orderId) await loadItems(orderId);
    await reload();
  }, [orderId, loadItems, reload]);

  const openOrder = useCallback(async () => {
    if (!table) return;
    setBusy(true);
    try {
      await exec(
        `INSERT INTO orders (id, table_id, tax_bp, opened_by)
         VALUES ($1, $2, $3, $4)`,
        [newId(), table.id, settings?.default_tax_bp ?? 1000, staff?.id ?? null],
      );
      await reload();
    } catch (e) {
      // El índice único parcial impide una segunda cuenta viva por mesa.
      toast.error(
        String(e).includes("UNIQUE")
          ? t("toast.tableTaken")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }, [table, settings?.default_tax_bp, staff?.id, reload, t]);

  const addProduct = useCallback(
    async (product: ProductRow) => {
      if (!orderId || !order) return;

      // Se agrupa en una línea existente en vez de apilar duplicados.
      const existing = items.find((i) => i.product_id === product.id && !i.notes);
      try {
        if (existing) {
          await exec("UPDATE order_items SET quantity = quantity + 1 WHERE id = $1", [
            existing.id,
          ]);
        } else {
          await exec(
            `INSERT INTO order_items
               (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
             VALUES ($1, $2, $3, 1, $4, $5)`,
            [
              newId(),
              orderId,
              product.id,
              product.price_cents,
              product.tax_bp ?? order.tax_bp,
            ],
          );
        }
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [orderId, order, items, refresh],
  );

  const setQuantity = useCallback(
    async (item: OrderLine, quantity: number) => {
      // Bajar de uno ya no borra: quitar una línea entera es anular, y eso pasa
      // por `voidLine` con motivo. Aquí solo se corrige la cantidad, que el
      // trigger de inventario ajusta por la diferencia.
      if (quantity <= 0) return;
      try {
        await exec("UPDATE order_items SET quantity = $1 WHERE id = $2", [
          quantity,
          item.id,
        ]);
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  /**
   * Anula una línea. No la borra.
   *
   * Cuando una línea llega a `order_items` ya se guardó la comanda y el papel
   * salió por cocina: alguien está cocinando eso. Borrarla sin más deja la
   * cuenta cuadrando sola y ninguna explicación de por qué se cocinó de más.
   *
   * Los totales dejan de contarla y el inventario devuelve lo que consumió, los
   * dos por trigger. Aquí solo se marca.
   */
  const voidLine = useCallback(
    async (item: OrderLine, reason: string) => {
      try {
        await exec(
          `UPDATE order_items
              SET voided_at = datetime('now'), void_reason = $1, voided_by = $2
            WHERE id = $3 AND voided_at IS NULL`,
          [reason.trim() || null, staff?.id ?? null, item.id],
        );
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [refresh, staff?.id],
  );

  const setStatus = useCallback(
    async (status: OrderStatus) => {
      if (!orderId) return;
      setBusy(true);
      try {
        await exec("UPDATE orders SET status = $1 WHERE id = $2", [status, orderId]);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [orderId, reload],
  );

  /** Cierra la cuenta dejando constancia de cómo se cobró. */
  const settle = useCallback(
    async (
      method: string,
      reference: string,
      tipCents = 0,
      tenderedCents: number | null = null,
    ) => {
      if (!orderId) return false;
      setBusy(true);
      try {
        // La propina y lo entregado entran en el MISMO UPDATE que el cobro.
        // Guardarlos aparte dejaría un instante con la cuenta ya pagada y los
        // dos a cero, y el trigger que mete el efectivo en el cajón —que mira
        // justamente esas columnas— se llevaría el importe equivocado.
        await exec(
          `UPDATE orders
              SET status = 'paid', payment_method = $1, payment_ref = $2,
                  tip_cents = $3, tendered_cents = $4
            WHERE id = $5`,
          [
            method,
            reference || null,
            Math.max(0, Math.round(tipCents)),
            tenderedCents === null ? null : Math.max(0, Math.round(tenderedCents)),
            orderId,
          ],
        );
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orderId],
  );

  /** Base imponible e impuesto por tasa — el desglose que necesita el ticket. */
  const taxBreakdown = useMemo(() => {
    const map = new Map<number, { base: number; tax: number }>();
    for (const item of items) {
      // La línea anulada no existe para el ticket ni para el impuesto.
      if (item.voided_at) continue;
      const entry = map.get(item.tax_bp) ?? { base: 0, tax: 0 };
      // El descuento rebaja la base imponible, igual que en los triggers. Si
      // aquí se calculara sobre el bruto, el papel y la base dirían cifras
      // distintas justo en las cuentas con descuento.
      const base = item.quantity * item.unit_price_cents - item.discount_cents;
      entry.base += base;
      entry.tax += lineTaxCents(1, base, item.tax_bp);
      map.set(item.tax_bp, entry);
    }
    return Array.from(map.entries())
      .map(([bp, v]) => ({ bp, ...v }))
      .sort((a, b) => a.bp - b.bp);
  }, [items]);

  return {
    order,
    items,
    busy,
    taxBreakdown,
    openOrder,
    addProduct,
    setQuantity,
    voidLine,
    setStatus,
    settle,
    refresh,
  };
}
