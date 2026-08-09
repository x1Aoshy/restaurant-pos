import { jsPDF } from "jspdf";

import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { cashSplit } from "@/features/orders/cash";
import type { SettingsRow } from "@/types/local";

export interface TicketLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  bp: number;
  /** Descuento de esta línea. Ya viene restado de `subtotalCents`. */
  discountCents: number;
  /** Lo que se cobra por la línea: cantidad × precio − descuento. */
  subtotalCents: number;
}

/**
 * Los rótulos llegan traducidos desde fuera en vez de leerse aquí.
 *
 * Así este módulo sigue siendo una función pura —entra un ticket, sale un PDF—
 * y no depende del proveedor de idioma. Antes estaban escritos en español
 * dentro del código, de modo que una instalación en inglés imprimía un ticket
 * a medias en castellano.
 */
export interface TicketLabels {
  /** Etiqueta de la fecha y de los importes: «en-US», «es-NI»… */
  locale: string;
  venueFallback: string;
  ticket: string;
  table: string;
  /** La mesa 0 es el mostrador; se imprime con su nombre, no como «00». */
  counter: string;
  subtotal: string;
  taxes: string;
  taxShort: string;
  discount: string;
  tip: string;
  totalPaid: string;
  tendered: string;
  change: string;
  /** Lo que quedó sin cobrar. Distinto del vuelto y con otra palabra. */
  short: string;
  /** Une tasa y base: «Impuesto 15% sobre 100,00». */
  taxOn: string;
  total: string;
  quantity: string;
  description: string;
  unitPrice: string;
  amount: string;
}

export interface TicketData {
  settings: SettingsRow;
  labels: TicketLabels;
  tableNumber: number;
  reference: string;
  openedAt: string;
  closedAt: string | null;
  subtotalCents: number;
  /** Suma de los descuentos de línea. Se enseña solo si hay alguno. */
  discountCents: number;
  taxCents: number;
  /** La venta: subtotal − descuento + impuesto. NO incluye la propina. */
  totalCents: number;
  tipCents: number;
  /**
   * Efectivo entregado. Nulo si no se anotó, y entonces no se imprime ni el
   * vuelto ni lo pendiente: un ticket que dice «vuelto 0,00» hace dudar de si
   * se devolvió algo.
   */
  tenderedCents: number | null;
  lines: TicketLine[];
  taxBreakdown: { bp: number; base: number; tax: number }[];
  /** Ej.: «Pagado con tarjeta · 004521». Se omite si no se registró. */
  paymentLabel?: string;
}

// Blanco y negro estricto. La jerarquía la dan el peso tipográfico y el grosor
// de las reglas, que es además lo único que sobrevive a una impresora térmica.
const INK: [number, number, number] = [17, 17, 17];
const GRAY: [number, number, number] = [115, 115, 115];
const LINE: [number, number, number] = [214, 214, 214];
const FILL: [number, number, number] = [244, 244, 244];

function localeOf(code: string) {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.locale ?? "en-US";
}

/** «Mesa 04», o «Barra» cuando no hay mesa de por medio. */
function tableText(n: number, labels: TicketLabels) {
  return n === 0 ? labels.counter : `${labels.table} ${String(n).padStart(2, "0")}`;
}

function money(cents: number, currency: string) {
  const code = isSupportedCurrency(currency) ? currency : "USD";
  return new Intl.NumberFormat(localeOf(code), {
    style: "currency",
    currency: code,
  }).format(cents / 100);
}

/**
 * Rollo térmico de 80 mm. Ancho de papel 80, imprimible ~72: los 4 mm de cada
 * lado son la zona muerta del cabezal y el texto que entre ahí se recorta.
 *
 * El alto se calcula, no se fija: una térmica corta donde termina el contenido,
 * así que una página de alto fijo dejaría un palmo de papel en blanco por
 * ticket.
 */
function buildPosTicket(data: TicketData): jsPDF {
  const { settings, labels } = data;
  const currency = settings.currency || "USD";

  const W = 80;
  const M = 4;
  const IN = W - M;
  const CENTER = W / 2;

  const taxLines = settings.show_tax_breakdown === 1 ? data.taxBreakdown.length : 1;
  const extraRows =
    (data.discountCents > 0 ? 1 : 0) +
    (data.tipCents > 0 ? 1 : 0) +
    // Entregado, y una más para el vuelto o lo pendiente.
    (data.tenderedCents !== null ? 2 : 0);
  const height =
    38 +
    data.lines.length * 8 +
    taxLines * 4 +
    extraRows * 4 +
    (settings.ticket_header ? 8 : 0) +
    (settings.ticket_footer ? 12 : 0) +
    26;

  const doc = new jsPDF({ unit: "mm", format: [W, height] });
  let y = 7;

  const rule = (dashed = false) => {
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.2);
    if (dashed) doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(M, y, IN, y);
    doc.setLineDashPattern([], 0);
  };

  const wrap = (text: string, size: number, maxW: number) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(text, maxW) as string[];
  };

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  for (const chunk of wrap(
    settings.restaurant_name || labels.venueFallback,
    11,
    IN - M,
  )) {
    doc.text(chunk, CENTER, y, { align: "center" });
    y += 5;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  for (const info of [settings.address, settings.phone].filter(Boolean)) {
    for (const chunk of wrap(info, 7, IN - M)) {
      doc.text(chunk, CENTER, y, { align: "center" });
      y += 3.2;
    }
  }

  y += 1.5;
  doc.setFontSize(7);
  doc.text(
    `${data.reference}  ·  ${tableText(data.tableNumber, labels)}`,
    CENTER,
    y,
    { align: "center" },
  );
  y += 3.2;
  doc.text(
    new Date(data.closedAt ?? data.openedAt).toLocaleString(labels.locale),
    CENTER,
    y,
    { align: "center" },
  );
  y += 3;

  if (settings.ticket_header) {
    y += 1.5;
    for (const chunk of wrap(settings.ticket_header, 7, IN - M)) {
      doc.text(chunk, CENTER, y, { align: "center" });
      y += 3.2;
    }
  }

  y += 2;
  rule(true);
  y += 4;

  // Nombre arriba, cantidad × precio abajo. En 72 mm útiles no caben cinco
  // columnas, y apilar es lo que hace cualquier ticket de barra.
  doc.setTextColor(...INK);
  for (const item of data.lines) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const chunk of wrap(item.name, 8, IN - M - 20)) {
      doc.text(chunk, M, y);
      y += 3.4;
    }
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(`${item.quantity} x ${money(item.unitPriceCents, currency)}`, M + 2, y);
    doc.setTextColor(...INK);
    doc.setFontSize(8);
    doc.text(money(item.subtotalCents, currency), IN, y, { align: "right" });
    y += 4.5;
  }

  y -= 1;
  rule(true);
  y += 4;

  const row = (label: string, value: string, bold = false, size = 8) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(bold ? INK : GRAY));
    doc.text(label, M, y);
    doc.setTextColor(...INK);
    doc.text(value, IN, y, { align: "right" });
    y += bold ? 6 : 4;
  };

  // Orden del desglose: bruto, lo que se descuenta, lo que se añade. Cualquier
  // otro orden obliga a rehacer la cuenta mentalmente para comprobarla.
  row(labels.subtotal, money(data.subtotalCents, currency));
  if (data.discountCents > 0) {
    row(labels.discount, `-${money(data.discountCents, currency)}`);
  }
  if (settings.show_tax_breakdown === 1) {
    for (const b of data.taxBreakdown) {
      row(`${labels.taxShort} ${formatBp(b.bp)}`, money(b.tax, currency), false, 7);
    }
  } else {
    row(labels.taxes, money(data.taxCents, currency));
  }
  if (data.tipCents > 0) {
    row(labels.tip, money(data.tipCents, currency));
  }

  y += 1;
  rule();
  y += 5;
  // Con propina, lo grande es lo que se pagó de verdad; sin ella, el total de
  // siempre. Enseñar dos cifras casi iguales solo genera dudas al cliente.
  row(
    data.tipCents > 0 ? labels.totalPaid.toUpperCase() : labels.total.toUpperCase(),
    money(data.totalCents + data.tipCents, currency),
    true,
    11,
  );

  // Entregado y vuelto, debajo del total. Es lo que se mira cuando alguien
  // vuelve a decir «te di quinientos»: sin estas dos líneas, el ticket no
  // guarda ni rastro de cuánto pasó por el mostrador.
  const cash = cashSplit(data.totalCents + data.tipCents, data.tenderedCents);
  if (data.tenderedCents !== null) {
    y += 2;
    row(labels.tendered, money(data.tenderedCents, currency), false, 8);
    if (cash.changeCents > 0) {
      row(labels.change, money(cash.changeCents, currency), true, 9);
    }
    if (cash.shortCents > 0) {
      row(labels.short, money(cash.shortCents, currency), true, 9);
    }
  }

  if (data.paymentLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(data.paymentLabel, M, y);
    y += 4;
  }

  if (settings.ticket_footer) {
    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    for (const chunk of wrap(settings.ticket_footer, 7, IN - M)) {
      doc.text(chunk, CENTER, y, { align: "center" });
      y += 3.2;
    }
  }

  return doc;
}

/** Hoja A4, para quien no tiene impresora de barra. */
function buildA4Ticket(data: TicketData): jsPDF {
  const { settings, labels } = data;
  const currency = settings.currency || "USD";
  const PAGE_W = 210;
  const M = 18;
  const RIGHT = PAGE_W - M;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = M + 4;

  const hairline = (x1: number, x2: number, at: number, color = LINE, w = 0.15) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
    doc.line(x1, at, x2, at);
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(settings.restaurant_name || labels.venueFallback, M, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  let headY = y + 5.5;
  for (const line of [settings.address, settings.phone].filter(Boolean)) {
    doc.text(line, M, headY);
    headY += 4.2;
  }

  const boxW = 56;
  const boxX = RIGHT - boxW;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, M, boxW, 21, 1.5, 1.5);
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(labels.ticket.toUpperCase(), boxX + 4, M + 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(data.reference, boxX + 4, M + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(
    `${tableText(data.tableNumber, labels)}  ·  ${new Date(
      data.closedAt ?? data.openedAt,
    ).toLocaleString(labels.locale)}`,
    boxX + 4,
    M + 16.5,
  );

  y = Math.max(headY, M + 21) + 5;

  if (settings.ticket_header) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    for (const chunk of doc.splitTextToSize(settings.ticket_header, RIGHT - M) as string[]) {
      doc.text(chunk, M, y);
      y += 4.2;
    }
    doc.setFont("helvetica", "normal");
    y += 1;
  }

  hairline(M, RIGHT, y, INK, 0.6);
  y += 7;

  doc.setFillColor(...FILL);
  doc.rect(M, y - 4.5, RIGHT - M, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(labels.quantity.toUpperCase(), M + 8, y, { align: "right" });
  doc.text(labels.description.toUpperCase(), M + 14, y);
  doc.text(labels.unitPrice.toUpperCase(), RIGHT - 52, y, { align: "right" });
  doc.text(labels.taxShort.toUpperCase(), RIGHT - 32, y, { align: "right" });
  doc.text(labels.amount.toUpperCase(), RIGHT - 2, y, { align: "right" });
  y += 7;

  doc.setFont("helvetica", "normal");
  for (const item of data.lines) {
    if (y > 265) {
      doc.addPage();
      y = M + 4;
    }
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(String(item.quantity), M + 8, y, { align: "right" });
    doc.text((doc.splitTextToSize(item.name, 72) as string[])[0], M + 14, y);
    doc.text(money(item.unitPriceCents, currency), RIGHT - 52, y, { align: "right" });
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(formatBp(item.bp), RIGHT - 32, y, { align: "right" });
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(money(item.subtotalCents, currency), RIGHT - 2, y, { align: "right" });
    y += 2.2;
    hairline(M, RIGHT, y);
    y += 4.6;
  }

  y += 2;
  const blockX = RIGHT - 74;
  const totalRow = (label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text(label, blockX, y);
    doc.setTextColor(...INK);
    doc.text(value, RIGHT - 2, y, { align: "right" });
    y += 5;
  };

  totalRow(labels.subtotal, money(data.subtotalCents, currency));
  if (data.discountCents > 0) {
    totalRow(labels.discount, `-${money(data.discountCents, currency)}`);
  }
  if (settings.show_tax_breakdown === 1) {
    for (const b of data.taxBreakdown) {
      totalRow(
        `${labels.taxShort} ${formatBp(b.bp)} ${labels.taxOn} ${money(b.base, currency)}`,
        money(b.tax, currency),
      );
    }
  } else {
    totalRow(labels.taxes, money(data.taxCents, currency));
  }
  if (data.tipCents > 0) {
    totalRow(labels.tip, money(data.tipCents, currency));
  }

  y += 1;
  hairline(blockX, RIGHT, y, INK, 0.4);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(
    data.tipCents > 0 ? labels.totalPaid.toUpperCase() : labels.total.toUpperCase(),
    blockX,
    y,
  );
  doc.setFontSize(13);
  doc.text(money(data.totalCents + data.tipCents, currency), RIGHT - 2, y, {
    align: "right",
  });

  const a4Cash = cashSplit(data.totalCents + data.tipCents, data.tenderedCents);
  if (data.tenderedCents !== null) {
    y += 6;
    totalRow(labels.tendered, money(data.tenderedCents, currency));
    if (a4Cash.changeCents > 0) {
      totalRow(labels.change, money(a4Cash.changeCents, currency));
    }
    if (a4Cash.shortCents > 0) {
      totalRow(labels.short, money(a4Cash.shortCents, currency));
    }
    y -= 5;
  }

  if (data.paymentLabel) {
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(data.paymentLabel, blockX, y);
  }

  if (settings.ticket_footer) {
    y += 14;
    hairline(M + 40, RIGHT - 40, y - 5);
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    for (const chunk of doc.splitTextToSize(settings.ticket_footer, RIGHT - M - 40) as string[]) {
      doc.text(chunk, PAGE_W / 2, y, { align: "center" });
      y += 4.2;
    }
  }

  return doc;
}

export function buildTicketPdf(data: TicketData): jsPDF {
  return data.settings.ticket_format === "a4"
    ? buildA4Ticket(data)
    : buildPosTicket(data);
}

export function ticketFileName(data: TicketData) {
  const stamp = new Date(data.closedAt ?? data.openedAt).toISOString().slice(0, 10);
  return `ticket-${stamp}-mesa${data.tableNumber}-${data.reference}.pdf`;
}
