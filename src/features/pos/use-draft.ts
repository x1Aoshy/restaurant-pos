import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { newId, queryOne, transaction, type Statement } from "@/lib/db";
import { lineTaxCents } from "@/lib/money";
import { useFloor } from "@/providers/floor-provider";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";
import { LIVE_ORDER_STATUSES, type OrderRow, type ProductRow } from "@/types/local";

export interface DraftLine {
  product: ProductRow;
  quantity: number;
}

/**
 * El POS construye la comanda en memoria y la guarda de una vez.
 *
 * Es deliberado: el mesero transcribe una nota de papel ya cerrada, así que
 * escribir en la base en cada toque solo añadiría latencia, y abandonar a
 * medias dejaría una cuenta vacía ocupando la mesa.
 *
 * Los totales que se ven aquí son una PREVISUALIZACIÓN. Al guardar, los
 * triggers de la base recalculan subtotal e impuestos, y esos son los que
 * mandan.
 */
export function useDraft() {
  const { staff, settings } = useSession();
  const { tables, liveOrders, reload } = useFloor();
  const { t } = useI18n();

  const [tableNumber, setTableNumber] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const parsed = Number.parseInt(tableNumber, 10);
  const table = useMemo(
    () =>
      Number.isFinite(parsed) ? tables.find((x) => x.number === parsed) : undefined,
    [tables, parsed],
  );

  const existingOrder = table ? liveOrders[table.id] : undefined;

  const addProduct = useCallback((product: ProductRow) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i === -1) return [...prev, { product, quantity: 1 }];
      const next = prev.slice();
      next[i] = { ...next[i], quantity: next[i].quantity + 1 };
      return next;
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setTableNumber("");
  }, []);

  const preview = useMemo(() => {
    // Si la mesa ya tiene cuenta, la base aplicará la tasa CONGELADA en ella,
    // no la tasa actual de la casa. Usar la de ajustes haría que la vista
    // previa y el ticket discreparan tras un cambio a mitad de servicio.
    const fallbackBp =
      existingOrder?.tax_bp ?? settings?.default_tax_bp ?? 1000;

    const byRate = new Map<number, { base: number; tax: number }>();
    let subtotal = 0;
    let tax = 0;

    for (const line of lines) {
      const bp = line.product.tax_bp ?? fallbackBp;
      const base = line.quantity * line.product.price_cents;
      const lineTax = lineTaxCents(line.quantity, line.product.price_cents, bp);
      subtotal += base;
      tax += lineTax;

      const entry = byRate.get(bp) ?? { base: 0, tax: 0 };
      entry.base += base;
      entry.tax += lineTax;
      byRate.set(bp, entry);
    }

    return {
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: subtotal + tax,
      byRate: Array.from(byRate.entries())
        .map(([bp, v]) => ({ bp, ...v }))
        .sort((a, b) => a.bp - b.bp),
    };
  }, [lines, settings?.default_tax_bp, existingOrder?.tax_bp]);

  const commit = useCallback(async () => {
    if (!table) {
      toast.error(t("pos.noTable", { n: tableNumber || "—" }));
      return;
    }
    if (lines.length === 0) return;

    setSaving(true);
    try {
      // La lectura va antes de la transacción: comprobar si la mesa ya tiene
      // cuenta abierta no modifica nada, y así lo que se escribe entra de una
      // sola vez y sin ir y volver a Rust a mitad.
      const placeholders = LIVE_ORDER_STATUSES.map((_, i) => `$${i + 2}`).join(",");
      const live = await queryOne<OrderRow>(
        `SELECT * FROM orders
          WHERE table_id = $1 AND status IN (${placeholders})
            AND merged_into IS NULL`,
        [table.id, ...LIVE_ORDER_STATUSES],
      );

      // Una cuenta por cobrar ya tiene su ticket entregado al cliente:
      // añadirle líneas la desincronizaría del papel impreso.
      if (live?.status === "billed") {
        throw new Error(t("pos.billedBlock", { n: table.number }));
      }

      const orderBp = live?.tax_bp ?? settings?.default_tax_bp ?? 1000;
      const orderId = live?.id ?? newId();

      const statements: Statement[] = [];
      if (!live) {
        statements.push({
          sql: `INSERT INTO orders (id, table_id, tax_bp, opened_by)
                VALUES ($1, $2, $3, $4)`,
          values: [orderId, table.id, orderBp, staff?.id ?? null],
        });
      }

      // El precio y la tasa se CONGELAN aquí. Si se leyeran del producto al
      // mostrar, editar la carta reescribiría los tickets ya emitidos.
      for (const line of lines) {
        statements.push({
          sql: `INSERT INTO order_items
                  (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
                VALUES ($1, $2, $3, $4, $5, $6)`,
          values: [
            newId(),
            orderId,
            line.product.id,
            line.quantity,
            line.product.price_cents,
            line.product.tax_bp ?? orderBp,
          ],
        });
      }

      await transaction(statements);

      const count = lines.reduce((n, l) => n + l.quantity, 0);
      toast.success(t("pos.savedTitle", { n: table.number }), {
        description:
          count === 1 ? t("pos.savedOne") : t("pos.savedMany", { n: count }),
      });
      clear();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [table, tableNumber, lines, settings?.default_tax_bp, staff?.id, clear, reload, t]);

  return {
    tableNumber,
    setTableNumber,
    table,
    existingOrder,
    lines,
    preview,
    saving,
    addProduct,
    setQuantity,
    clear,
    commit,
  };
}
