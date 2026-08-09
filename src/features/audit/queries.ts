import { query, queryOne } from "@/lib/db";
import { daysAgoLocal } from "@/lib/format";
import { SHIFT_SQL } from "@/lib/sql-time";

/**
 * Lo que hay que poder revisar: propinas, descuentos y anulaciones.
 *
 * El sistema lleva desde hace tiempo apuntando quién invitó una cuenta y quién
 * quitó un plato, pero nadie podía leerlo. Un rastro que no se lee no es una
 * auditoría: es peso muerto.
 *
 * Los totales van en consultas aparte de las listas, y no sumando las filas
 * que se pintan. Las listas están recortadas —doscientas caben en pantalla, mil
 * no— y sumar solo lo visible daría una cifra menor que la real justo cuando
 * hay mucho que revisar, que es cuando importa.
 */

export interface AuditTotals {
  tipCents: number;
  tipTickets: number;
  discountCents: number;
  discountCount: number;
  voidCents: number;
  voidCount: number;
}

export interface TipsByStaff {
  staff_id: string | null;
  name: string | null;
  tips: number;
  tickets: number;
}

export interface DiscountRow {
  id: string;
  at: string;
  table_number: number;
  discount_cents: number;
  discount_reason: string | null;
  by_name: string | null;
  status: string;
}

export interface VoidRow {
  id: string;
  voided_at: string;
  void_reason: string | null;
  quantity: number;
  amount_cents: number;
  product_name: string;
  table_number: number;
  by_name: string | null;
}

/** Cuántas filas se traen. Más de esto ya no se revisa mirando, se exporta. */
const LIMIT = 200;

export async function fetchTotals(days: number): Promise<AuditTotals> {
  const from = daysAgoLocal(days - 1);

  const [tips, discounts, voids] = await Promise.all([
    queryOne<{ cents: number | null; n: number }>(
      `SELECT COALESCE(SUM(tip_cents), 0) AS cents, COUNT(*) AS n
         FROM orders
        WHERE status = 'paid' AND closed_at IS NOT NULL AND tip_cents > 0
          AND date(closed_at, ${SHIFT_SQL}) >= $1`,
      [from],
    ),
    queryOne<{ cents: number | null; n: number }>(
      `SELECT COALESCE(SUM(discount_cents), 0) AS cents, COUNT(*) AS n
         FROM orders
        WHERE discount_cents > 0
          AND date(COALESCE(closed_at, created_at), ${SHIFT_SQL}) >= $1`,
      [from],
    ),
    queryOne<{ cents: number | null; n: number }>(
      // El importe de lo anulado es lo que se habría cobrado por esa línea.
      `SELECT COALESCE(SUM(quantity * unit_price_cents - discount_cents), 0) AS cents,
              COUNT(*) AS n
         FROM order_items
        WHERE voided_at IS NOT NULL
          AND date(voided_at, ${SHIFT_SQL}) >= $1`,
      [from],
    ),
  ]);

  return {
    tipCents: tips?.cents ?? 0,
    tipTickets: tips?.n ?? 0,
    discountCents: discounts?.cents ?? 0,
    discountCount: discounts?.n ?? 0,
    voidCents: voids?.cents ?? 0,
    voidCount: voids?.n ?? 0,
  };
}

/**
 * Propinas por persona.
 *
 * Se atribuyen a quien abrió la cuenta. No es perfecto —puede cobrarla otro—
 * pero es lo único que la base sabe, y es el reparto que se hace de hecho al
 * cerrar el turno. Conviene saber que es una aproximación antes de discutirla
 * con alguien.
 */
export async function fetchTipsByStaff(days: number): Promise<TipsByStaff[]> {
  return query<TipsByStaff>(
    `SELECT o.opened_by AS staff_id, s.full_name AS name,
            SUM(o.tip_cents) AS tips, COUNT(*) AS tickets
       FROM orders o
       LEFT JOIN staff s ON s.id = o.opened_by
      WHERE o.status = 'paid' AND o.closed_at IS NOT NULL AND o.tip_cents > 0
        AND date(o.closed_at, ${SHIFT_SQL}) >= $1
      GROUP BY o.opened_by
      ORDER BY tips DESC`,
    [daysAgoLocal(days - 1)],
  );
}

export async function fetchDiscounts(days: number): Promise<DiscountRow[]> {
  return query<DiscountRow>(
    `SELECT o.id,
            COALESCE(o.closed_at, o.created_at) AS at,
            tb.number AS table_number,
            o.discount_cents, o.discount_reason,
            s.full_name AS by_name,
            o.status
       FROM orders o
       JOIN tables tb ON tb.id = o.table_id
       LEFT JOIN staff s ON s.id = o.discount_by
      WHERE o.discount_cents > 0
        AND date(COALESCE(o.closed_at, o.created_at), ${SHIFT_SQL}) >= $1
      -- El rowid desempata: dos descuentos del mismo segundo saldrían en un
      -- orden cualquiera, y una lista que se reordena sola al recargar hace
      -- dudar de todo lo demás.
      ORDER BY at DESC, o.rowid DESC
      LIMIT ${LIMIT}`,
    [daysAgoLocal(days - 1)],
  );
}

export async function fetchVoids(days: number): Promise<VoidRow[]> {
  return query<VoidRow>(
    `SELECT oi.id, oi.voided_at, oi.void_reason, oi.quantity,
            (oi.quantity * oi.unit_price_cents - oi.discount_cents) AS amount_cents,
            p.name AS product_name,
            tb.number AS table_number,
            s.full_name AS by_name
       FROM order_items oi
       JOIN orders   o  ON o.id = oi.order_id
       JOIN tables   tb ON tb.id = o.table_id
       JOIN products p  ON p.id = oi.product_id
       LEFT JOIN staff s ON s.id = oi.voided_by
      WHERE oi.voided_at IS NOT NULL
        AND date(oi.voided_at, ${SHIFT_SQL}) >= $1
      ORDER BY oi.voided_at DESC, oi.rowid DESC
      LIMIT ${LIMIT}`,
    [daysAgoLocal(days - 1)],
  );
}

/**
 * Quién anula más. Es la señal que se busca al abrir esta pantalla: una
 * anulación suelta no dice nada, veinte de la misma persona sí.
 */
export async function fetchVoidsByStaff(days: number) {
  return query<{ name: string | null; n: number; cents: number }>(
    `SELECT s.full_name AS name, COUNT(*) AS n,
            SUM(oi.quantity * oi.unit_price_cents - oi.discount_cents) AS cents
       FROM order_items oi
       LEFT JOIN staff s ON s.id = oi.voided_by
      WHERE oi.voided_at IS NOT NULL
        AND date(oi.voided_at, ${SHIFT_SQL}) >= $1
      GROUP BY oi.voided_by
      ORDER BY cents DESC`,
    [daysAgoLocal(days - 1)],
  );
}
