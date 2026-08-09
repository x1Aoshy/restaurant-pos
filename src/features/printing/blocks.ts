import { formatBp } from "@/lib/money";
import { cashSplit } from "@/features/orders/cash";
import type { TicketData } from "@/features/tickets/ticket-pdf";

/**
 * Bloques de impresión. Reflejan el enum `Block` de `src-tauri/src/printer.rs`.
 *
 * El diseño del ticket se decide aquí, en el mismo sitio donde ya vive el del
 * PDF, y Rust solo convierte a bytes. Si el reparto fuera al revés habría dos
 * maquetaciones que mantener en paralelo y acabarían diciendo cosas distintas.
 */
export type Align = "left" | "center" | "right";

export type Block =
  | { kind: "text"; text: string; align?: Align; bold?: boolean; size?: 0 | 1 | 2 }
  | { kind: "row"; left: string; right: string; bold?: boolean }
  | { kind: "rule"; dashed?: boolean }
  | { kind: "feed"; lines?: number }
  | { kind: "drawer" };

/** Grupo reservado para el ticket del cliente. El resto los define la carta. */
export const RECEIPT_GROUP = "receipt";

function money(cents: number, locale: string, currency: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    cents / 100,
  );
}

/**
 * Ticket del cliente, con el mismo desglose que el PDF: bruto, lo que se
 * descuenta, lo que se añade.
 *
 * `openDrawer` solo en efectivo. En tarjeta el cajón no se toca, y abrirlo por
 * costumbre es la forma más rápida de que desaparezca dinero sin que nadie
 * sepa cuándo.
 */
export function receiptBlocks(
  data: TicketData,
  options: { openDrawer: boolean },
): Block[] {
  const { settings, labels } = data;
  const currency = settings.currency || "USD";
  const m = (c: number) => money(c, labels.locale, currency);

  const blocks: Block[] = [
    {
      kind: "text",
      text: settings.restaurant_name || labels.venueFallback,
      align: "center",
      bold: true,
      size: 1,
    },
  ];

  for (const info of [settings.address, settings.phone].filter(Boolean)) {
    blocks.push({ kind: "text", text: info, align: "center" });
  }

  blocks.push({
    kind: "text",
    text:
      data.tableNumber === 0
        ? `${data.reference} · ${labels.counter}`
        : `${data.reference} · ${labels.table} ${String(data.tableNumber).padStart(2, "0")}`,
    align: "center",
  });
  blocks.push({
    kind: "text",
    text: new Date(data.closedAt ?? data.openedAt).toLocaleString(labels.locale),
    align: "center",
  });

  if (settings.ticket_header) {
    blocks.push({ kind: "text", text: settings.ticket_header, align: "center" });
  }

  blocks.push({ kind: "rule", dashed: true });

  for (const line of data.lines) {
    blocks.push({ kind: "text", text: line.name });
    blocks.push({
      kind: "row",
      left: `  ${line.quantity} x ${m(line.unitPriceCents)}`,
      right: m(line.subtotalCents),
    });
  }

  blocks.push({ kind: "rule", dashed: true });
  blocks.push({ kind: "row", left: labels.subtotal, right: m(data.subtotalCents) });

  if (data.discountCents > 0) {
    blocks.push({
      kind: "row",
      left: labels.discount,
      right: `-${m(data.discountCents)}`,
    });
  }

  if (settings.show_tax_breakdown === 1) {
    for (const b of data.taxBreakdown) {
      blocks.push({
        kind: "row",
        left: `${labels.taxShort} ${formatBp(b.bp)}`,
        right: m(b.tax),
      });
    }
  } else {
    blocks.push({ kind: "row", left: labels.taxes, right: m(data.taxCents) });
  }

  if (data.tipCents > 0) {
    blocks.push({ kind: "row", left: labels.tip, right: m(data.tipCents) });
  }

  blocks.push({ kind: "rule" });
  blocks.push({
    kind: "row",
    left: (data.tipCents > 0 ? labels.totalPaid : labels.total).toUpperCase(),
    right: m(data.totalCents + data.tipCents),
    bold: true,
  });

  // Entregado y vuelto, debajo del total: la parte del papel que se mira
  // cuando alguien vuelve a decir «te di quinientos».
  if (data.tenderedCents !== null) {
    const cash = cashSplit(data.totalCents + data.tipCents, data.tenderedCents);
    blocks.push({ kind: "row", left: labels.tendered, right: m(data.tenderedCents) });
    if (cash.changeCents > 0) {
      blocks.push({
        kind: "row",
        left: labels.change,
        right: m(cash.changeCents),
        bold: true,
      });
    }
    if (cash.shortCents > 0) {
      blocks.push({
        kind: "row",
        left: labels.short,
        right: m(cash.shortCents),
        bold: true,
      });
    }
  }

  if (data.paymentLabel) {
    blocks.push({ kind: "text", text: data.paymentLabel });
  }

  if (settings.ticket_footer) {
    blocks.push({ kind: "feed", lines: 1 });
    blocks.push({ kind: "text", text: settings.ticket_footer, align: "center" });
  }

  if (options.openDrawer) blocks.push({ kind: "drawer" });

  return blocks;
}

export interface KitchenLine {
  name: string;
  quantity: number;
  notes: string | null;
}

/**
 * Comanda para cocina o barra.
 *
 * Sin precios: a quien cocina no le sirven y solo estorban. Lo que manda es la
 * mesa y la cantidad, así que van a doble tamaño — esto se lee de pie, con
 * prisa y a un metro de distancia.
 */
export function kitchenBlocks(input: {
  groupLabel: string;
  tableNumber: number;
  reference: string;
  waiter: string | null;
  at: string;
  locale: string;
  counterName: string;
  lines: KitchenLine[];
}): Block[] {
  const blocks: Block[] = [
    { kind: "text", text: input.groupLabel.toUpperCase(), align: "center", bold: true },
    {
      // La mesa a doble tamaño: es lo que se lee de pie y a un metro. En el
      // mostrador no hay número, así que va el nombre.
      kind: "text",
      text: input.tableNumber === 0
        ? input.counterName
        : `${input.tableNumber}`.padStart(2, "0"),
      align: "center",
      bold: true,
      size: 2,
    },
    {
      kind: "text",
      text: `${new Date(input.at).toLocaleTimeString(input.locale)}${
        input.waiter ? ` · ${input.waiter}` : ""
      }`,
      align: "center",
    },
    { kind: "rule", dashed: true },
  ];

  for (const line of input.lines) {
    blocks.push({
      kind: "text",
      text: `${line.quantity}  ${line.name}`,
      bold: true,
      size: 1,
    });
    if (line.notes) {
      blocks.push({ kind: "text", text: `   ${line.notes}` });
    }
  }

  blocks.push({ kind: "rule", dashed: true });
  blocks.push({ kind: "text", text: input.reference, align: "center" });

  return blocks;
}

/**
 * Aviso de que algo que YA salió por cocina se anula.
 *
 * Sin esto, el papel de la comanda sigue clavado en el pase y el plato se hace
 * igual: la anulación quedaría perfecta en la base de datos y perdida en la
 * cocina. Por eso solo se manda cuando la línea tenía `printed_at`; anular algo
 * que nunca se imprimió no le interesa a nadie de allí.
 *
 * El banner va a doble tamaño y arriba del todo, antes que la mesa: quien lo
 * coge tiene que saber en el primer vistazo que esto NO es una comanda nueva.
 */
export function voidBlocks(input: {
  banner: string;
  tableNumber: number;
  reference: string;
  waiter: string | null;
  at: string;
  locale: string;
  counterName: string;
  line: KitchenLine;
  reason: string | null;
}): Block[] {
  return [
    {
      kind: "text",
      text: input.banner.toUpperCase(),
      align: "center",
      bold: true,
      size: 2,
    },
    { kind: "rule" },
    {
      kind: "text",
      text:
        input.tableNumber === 0
          ? input.counterName
          : `${input.tableNumber}`.padStart(2, "0"),
      align: "center",
      bold: true,
      size: 1,
    },
    {
      kind: "text",
      text: `${new Date(input.at).toLocaleTimeString(input.locale)}${
        input.waiter ? ` · ${input.waiter}` : ""
      }`,
      align: "center",
    },
    { kind: "rule", dashed: true },
    {
      kind: "text",
      text: `${input.line.quantity}  ${input.line.name}`,
      bold: true,
      size: 1,
    },
    ...(input.reason
      ? [{ kind: "text" as const, text: `   ${input.reason}` }]
      : []),
    { kind: "rule", dashed: true },
    { kind: "text", text: input.reference, align: "center" },
  ];
}
