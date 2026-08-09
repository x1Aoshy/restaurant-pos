import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { exec, newId, queryOne, transaction, type Statement } from "@/lib/db";
import { lineTaxCents } from "@/lib/money";
import { useFloor } from "@/providers/floor-provider";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";
import { LIVE_ORDER_STATUSES, type OrderRow, type ProductRow } from "@/types/local";
import { usePrinting } from "@/features/printing/use-printing";

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
  const { printKitchen } = usePrinting();

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

  /**
   * Venta de mostrador: se apunta y se cobra de una vez, sin ocupar mesa.
   *
   * Es lo que hace falta en la barra para el cliente que pide una cerveza,
   * paga y se va. Antes había que ocupar una mesa durante diez segundos, que
   * en hora punta es exactamente la mesa que hace falta.
   *
   * Va a una mesa reservada, la número 0, que no sale en el salón. No hace
   * falta nada más: la cuenta se crea y se cobra **en la misma transacción**,
   * así que nunca llega a estar viva y el índice de una cuenta por mesa no
   * tiene nada que impedir. Dos ventas seguidas no chocan porque la primera ya
   * está pagada cuando empieza la segunda.
   */
  const counterSale = useCallback(
    async (
      method: string,
      reference: string,
      tipCents: number,
      /** Efectivo entregado. Nulo si no se anotó. */
      tenderedCents: number | null,
      /** Descuento por línea, en el orden del borrador. */
      discount?: { parts: number[]; reason: string } | null,
    ) => {
      if (lines.length === 0) return false;
      setSaving(true);
      try {
        // La mesa del mostrador se crea sola la primera vez. Pedirle a nadie
        // que la dé de alta a mano sería un paso que no aporta.
        let counter = await queryOne<{ id: string }>(
          "SELECT id FROM tables WHERE number = 0",
        );
        if (!counter) {
          const id = newId();
          await exec(
            "INSERT INTO tables (id, number, capacity) VALUES ($1, 0, 1)",
            [id],
          );
          counter = { id };
        }

        const orderId = newId();
        const orderBp = settings?.default_tax_bp ?? 1000;
        const statements: Statement[] = [
          {
            sql: `INSERT INTO orders (id, table_id, tax_bp, opened_by)
                  VALUES ($1, $2, $3, $4)`,
            values: [orderId, counter.id, orderBp, staff?.id ?? null],
          },
        ];
        // El descuento entra con las líneas, no después: en el mostrador no
        // existe el momento intermedio en que la cuenta está abierta y se le
        // puede aplicar algo.
        lines.forEach((line, i) => {
          statements.push({
            sql: `INSERT INTO order_items
                    (id, order_id, product_id, quantity, unit_price_cents, tax_bp,
                     discount_cents)
                  VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            values: [
              newId(),
              orderId,
              line.product.id,
              line.quantity,
              line.product.price_cents,
              line.product.tax_bp ?? orderBp,
              discount?.parts[i] ?? 0,
            ],
          });
        });

        if (discount && discount.parts.some((d) => d > 0)) {
          statements.push({
            sql: `UPDATE orders SET discount_reason = $1, discount_by = $2
                   WHERE id = $3`,
            values: [discount.reason, staff?.id ?? null, orderId],
          });
        }
        // El cobro va en la MISMA transacción. Si quedara fuera, un fallo entre
        // medias dejaría una venta de mostrador abierta y bloqueando la
        // siguiente.
        statements.push({
          sql: `UPDATE orders
                   SET status = 'paid', payment_method = $1, payment_ref = $2,
                       tip_cents = $3, tendered_cents = $4
                 WHERE id = $5`,
          values: [
            method,
            reference || null,
            Math.max(0, Math.round(tipCents)),
            tenderedCents === null ? null : Math.max(0, Math.round(tenderedCents)),
            orderId,
          ],
        });

        await transaction(statements);
        await printKitchen(orderId, 0, null);
        clear();
        await reload();
        return orderId;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [lines, settings?.default_tax_bp, staff?.id, clear, reload, printKitchen],
  );

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

      // La comanda sale a cocina y barra en cuanto está guardada, nunca antes:
      // si la transacción fallara, el papel ya estaría en la plancha y alguien
      // cocinaría algo que no existe en el sistema.
      //
      // Solo lo que se acaba de añadir tendría sentido imprimir, pero por ahora
      // se manda la cuenta entera; con una comanda por ronda es lo que se hace
      // en papel de todas formas.
      await printKitchen(orderId, table.number, table.zone_id);

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
  }, [table, tableNumber, lines, settings?.default_tax_bp, staff?.id, clear, reload, printKitchen, t]);

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
    counterSale,
  };
}
