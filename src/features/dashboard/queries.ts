import { query } from "@/lib/db";
import { daysAgoLocal } from "@/lib/format";
import { SHIFT_SQL } from "@/lib/sql-time";

/**
 * Agregados del resumen.
 *
 * SQLite guarda las marcas de tiempo en UTC. Agrupar por esa fecha sin más
 * partía el día por la mitad: en Nicaragua (UTC−6) todo lo cobrado a partir de
 * las 18:00 —las horas de más venta— contaba como del día siguiente. Por eso
 * cada consulta desplaza la marca a la hora local antes de recortar la fecha.
 */

export interface DayTotals {
  day: string;
  revenueCents: number;
  expenseCents: number;
  tickets: number;
}

export interface HourTotals {
  hour: number;
  revenueCents: number;
  tickets: number;
}

export interface CategoryTotals {
  category: string;
  revenueCents: number;
  units: number;
}

export interface ProductTotals {
  product_id: string;
  name: string;
  units: number;
  revenueCents: number;
  producible: number | null;
  low: boolean;
}

/** Serie diaria completa: los días sin movimiento salen en cero, no ausentes. */
export async function fetchDaily(days: number): Promise<DayTotals[]> {
  const from = daysAgoLocal(days - 1);

  const [sales, expenses] = await Promise.all([
    query<{ day: string; revenue_cents: number; tickets: number }>(
      `SELECT date(closed_at, ${SHIFT_SQL}) AS day,
              SUM(total_cents)              AS revenue_cents,
              COUNT(*)                      AS tickets
         FROM orders
        WHERE status = 'paid'
          AND closed_at IS NOT NULL
          AND date(closed_at, ${SHIFT_SQL}) >= $1
        GROUP BY day`,
      [from],
    ),
    query<{ day: string; expense_cents: number }>(
      `SELECT spent_on AS day, SUM(amount_cents) AS expense_cents
         FROM expenses
        WHERE spent_on >= $1
        GROUP BY day`,
      [from],
    ),
  ]);

  const byDay = new Map<string, DayTotals>();
  for (let i = days - 1; i >= 0; i--) {
    const day = daysAgoLocal(i);
    byDay.set(day, { day, revenueCents: 0, expenseCents: 0, tickets: 0 });
  }
  for (const s of sales) {
    const entry = byDay.get(s.day);
    if (entry) {
      entry.revenueCents = s.revenue_cents;
      entry.tickets = s.tickets;
    }
  }
  for (const e of expenses) {
    const entry = byDay.get(e.day);
    if (entry) entry.expenseCents = e.expense_cents;
  }
  return Array.from(byDay.values());
}

/** Las 24 horas siempre, para que la forma del día se lea de un vistazo. */
export async function fetchHourly(days: number): Promise<HourTotals[]> {
  const rows = await query<{ hour: number; revenue_cents: number; tickets: number }>(
    `SELECT CAST(strftime('%H', closed_at, ${SHIFT_SQL}) AS INTEGER) AS hour,
            SUM(total_cents) AS revenue_cents,
            COUNT(*)         AS tickets
       FROM orders
      WHERE status = 'paid'
        AND closed_at IS NOT NULL
        AND date(closed_at, ${SHIFT_SQL}) >= $1
      GROUP BY hour`,
    [daysAgoLocal(days - 1)],
  );

  const byHour = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => {
    const r = byHour.get(hour);
    return {
      hour,
      revenueCents: r?.revenue_cents ?? 0,
      tickets: r?.tickets ?? 0,
    };
  });
}

export async function fetchCategories(days: number): Promise<CategoryTotals[]> {
  const rows = await query<{ category: string; revenue_cents: number; units: number }>(
    `SELECT p.category,
            SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents,
            SUM(oi.quantity)                       AS units
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders   o ON o.id = oi.order_id
      WHERE o.status = 'paid'
        AND o.closed_at IS NOT NULL
        AND date(o.closed_at, ${SHIFT_SQL}) >= $1
      GROUP BY p.category
      ORDER BY revenue_cents DESC`,
    [daysAgoLocal(days - 1)],
  );
  return rows.map((r) => ({
    category: r.category,
    revenueCents: r.revenue_cents,
    units: r.units,
  }));
}

/**
 * Lo vendido por producto junto a cuántas unidades más se podrían servir.
 *
 * `producible` es el mínimo entre todos los insumos de la receta: la primera
 * cosa que se acabe es la que manda. Sin receta se devuelve null — un cero
 * haría pensar que se agotó algo que en realidad nunca se controló.
 */
export async function fetchProducts(days: number): Promise<ProductTotals[]> {
  const rows = await query<{
    product_id: string;
    name: string;
    units: number;
    revenue_cents: number;
    producible: number | null;
    low: number | null;
  }>(
    `SELECT p.id                        AS product_id,
            p.name,
            COALESCE(s.units, 0)         AS units,
            COALESCE(s.revenue_cents, 0) AS revenue_cents,
            (SELECT MIN(ii.stock_milli / r.quantity_milli)
               FROM product_recipe r
               JOIN inventory_items ii ON ii.id = r.item_id
              WHERE r.product_id = p.id) AS producible,
            (SELECT MAX(CASE WHEN ii.min_stock_milli > 0
                              AND ii.stock_milli <= ii.min_stock_milli
                             THEN 1 ELSE 0 END)
               FROM product_recipe r
               JOIN inventory_items ii ON ii.id = r.item_id
              WHERE r.product_id = p.id) AS low
       FROM products p
       LEFT JOIN (
            SELECT oi.product_id,
                   SUM(oi.quantity)                       AS units,
                   SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE o.status = 'paid'
               AND o.closed_at IS NOT NULL
               AND date(o.closed_at, ${SHIFT_SQL}) >= $1
             GROUP BY oi.product_id
       ) s ON s.product_id = p.id
      ORDER BY units DESC, p.name`,
    [daysAgoLocal(days - 1)],
  );

  return rows.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    units: r.units,
    revenueCents: r.revenue_cents,
    // Un stock negativo (se vendió más de lo que había apuntado) se enseña como
    // cero: «quedan −3» no significa nada para quien mira la barra.
    producible: r.producible === null ? null : Math.max(0, r.producible),
    low: r.low === 1 || (r.producible !== null && r.producible <= 0),
  }));
}
