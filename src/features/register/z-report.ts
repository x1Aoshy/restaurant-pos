import { query, queryOne } from "@/lib/db";
import type { Block } from "@/features/printing/blocks";
import type { CashRegisterRow, SettingsRow } from "@/types/local";

/**
 * Cierre de caja en papel.
 *
 * Un arqueo que solo existe en pantalla no sirve para lo que sirve un arqueo:
 * firmarlo. El papel es lo que se mete en el sobre con el dinero y lo que
 * queda si mañana el recuento no cuadra con lo que dijo el sistema.
 *
 * Lleva también las ventas por método de pago, y no solo el efectivo. El cajón
 * únicamente conoce lo que entró en metálico, pero quien cierra necesita
 * cuadrar el total del turno contra el estado del banco al día siguiente.
 */

export interface ZReportData {
  register: CashRegisterRow;
  openedBy: string | null;
  closedBy: string | null;
  byMethod: { method: string; tickets: number; cents: number }[];
  tipCents: number;
  drops: number;
  payouts: number;
}

export async function fetchZReport(registerId: string): Promise<ZReportData | null> {
  const register = await queryOne<CashRegisterRow>(
    "SELECT * FROM cash_registers WHERE id = $1",
    [registerId],
  );
  if (!register) return null;

  const names = await query<{ id: string; full_name: string }>(
    "SELECT id, full_name FROM staff WHERE id IN ($1, $2)",
    [register.opened_by ?? "", register.closed_by ?? ""],
  );
  const nameOf = (id: string | null) =>
    names.find((n) => n.id === id)?.full_name ?? null;

  // La ventana del turno. Sin cerrar todavía, hasta ahora mismo.
  const until = register.closed_at ?? "9999-12-31";

  const byMethod = await query<{ method: string; tickets: number; cents: number }>(
    `SELECT COALESCE(payment_method, 'other') AS method,
            COUNT(*) AS tickets,
            SUM(total_cents + tip_cents) AS cents
       FROM orders
      WHERE status = 'paid'
        AND closed_at IS NOT NULL
        AND closed_at >= $1 AND closed_at <= $2
      GROUP BY method
      ORDER BY cents DESC`,
    [register.opened_at, until],
  );

  const tips = await queryOne<{ cents: number | null }>(
    `SELECT COALESCE(SUM(tip_cents), 0) AS cents
       FROM orders
      WHERE status = 'paid' AND closed_at IS NOT NULL
        AND closed_at >= $1 AND closed_at <= $2`,
    [register.opened_at, until],
  );

  const moves = await query<{ kind: string; cents: number }>(
    `SELECT kind, SUM(amount_cents) AS cents
       FROM cash_movements WHERE register_id = $1 GROUP BY kind`,
    [registerId],
  );
  const sum = (kind: string) =>
    moves.find((m) => m.kind === kind)?.cents ?? 0;

  return {
    register,
    openedBy: nameOf(register.opened_by),
    closedBy: nameOf(register.closed_by),
    byMethod,
    tipCents: tips?.cents ?? 0,
    drops: sum("drop"),
    payouts: sum("payout"),
  };
}

export interface ZLabels {
  locale: string;
  title: string;
  opened: string;
  closed: string;
  float: string;
  cashSales: string;
  drops: string;
  payouts: string;
  expected: string;
  counted: string;
  difference: string;
  salesByMethod: string;
  tips: string;
  signature: string;
  methodName: (m: string) => string;
}

export function zReportBlocks(
  data: ZReportData,
  settings: SettingsRow,
  labels: ZLabels,
): Block[] {
  const currency = settings.currency || "USD";
  const m = (cents: number) =>
    new Intl.NumberFormat(labels.locale, { style: "currency", currency }).format(
      cents / 100,
    );
  const when = (v: string | null) =>
    v ? new Date(`${v.replace(" ", "T")}Z`).toLocaleString(labels.locale) : "—";

  const r = data.register;
  const cashSales = r.expected_cents - r.opening_float_cents - data.drops - data.payouts;

  const blocks: Block[] = [
    {
      kind: "text",
      text: settings.restaurant_name || "",
      align: "center",
      bold: true,
    },
    { kind: "text", text: labels.title.toUpperCase(), align: "center", bold: true, size: 1 },
    { kind: "rule" },
    { kind: "row", left: labels.opened, right: when(r.opened_at) },
    ...(data.openedBy ? [{ kind: "text", text: `  ${data.openedBy}` } as Block] : []),
    { kind: "row", left: labels.closed, right: when(r.closed_at) },
    ...(data.closedBy ? [{ kind: "text", text: `  ${data.closedBy}` } as Block] : []),
    { kind: "rule", dashed: true },

    // El cajón: lo que entró y salió en metálico.
    { kind: "row", left: labels.float, right: m(r.opening_float_cents) },
    { kind: "row", left: labels.cashSales, right: m(cashSales) },
  ];

  if (data.drops !== 0) {
    blocks.push({ kind: "row", left: labels.drops, right: m(data.drops) });
  }
  if (data.payouts !== 0) {
    blocks.push({ kind: "row", left: labels.payouts, right: m(data.payouts) });
  }

  blocks.push({ kind: "rule", dashed: true });
  blocks.push({ kind: "row", left: labels.expected, right: m(r.expected_cents), bold: true });

  if (r.counted_cents !== null) {
    blocks.push({ kind: "row", left: labels.counted, right: m(r.counted_cents) });
    // El descuadre a doble altura: es la única cifra por la que alguien va a
    // buscar este papel dentro de un mes.
    blocks.push({ kind: "rule" });
    blocks.push({
      kind: "row",
      left: labels.difference.toUpperCase(),
      right: `${r.difference_cents > 0 ? "+" : ""}${m(r.difference_cents)}`,
      bold: true,
    });
  }

  // Y el turno completo, más allá del cajón: sirve para cuadrar con el banco.
  if (data.byMethod.length > 0) {
    blocks.push({ kind: "feed", lines: 1 });
    blocks.push({ kind: "text", text: labels.salesByMethod, bold: true });
    blocks.push({ kind: "rule", dashed: true });
    for (const row of data.byMethod) {
      blocks.push({
        kind: "row",
        left: `${labels.methodName(row.method)} (${row.tickets})`,
        right: m(row.cents),
      });
    }
    if (data.tipCents > 0) {
      blocks.push({ kind: "row", left: labels.tips, right: m(data.tipCents) });
    }
  }

  if (r.note) {
    blocks.push({ kind: "feed", lines: 1 });
    blocks.push({ kind: "text", text: r.note });
  }

  // Espacio para la firma: este papel va en el sobre con el dinero.
  blocks.push({ kind: "feed", lines: 2 });
  blocks.push({ kind: "text", text: labels.signature, align: "center" });
  blocks.push({ kind: "feed", lines: 2 });
  blocks.push({ kind: "rule", dashed: true });

  return blocks;
}
