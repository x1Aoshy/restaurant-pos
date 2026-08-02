/**
 * El dinero se guarda y se opera SIEMPRE en centavos enteros.
 *
 * En coma flotante `0.1 + 0.2` no es `0.3`, y sobre cien líneas de comanda eso
 * se convierte en descuadres de céntimos que aparecen justo al cuadrar la caja
 * y que nadie sabe explicar. Aquí solo se convierte a decimal al mostrar.
 *
 * Las tasas van en puntos básicos: 1000 = 10 %, 2100 = 21 %. Mismo motivo.
 */

/** «12,50» o «12.50» → 1250. Devuelve null si no es un importe válido. */
export function parseCents(input: string): number | null {
  const clean = input.trim().replace(",", ".");
  if (clean === "" || !/^\d*\.?\d*$/.test(clean)) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  // Redondear tras multiplicar: Number("19.99") * 100 da 1998.9999...
  return Math.round(value * 100);
}

/** 1250 → «12.50», para rellenar un campo de edición. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** «21» o «21,5» → 2100 / 2150. Null si no es válido o queda fuera de rango. */
export function parseBp(input: string): number | null {
  const clean = input.trim().replace(",", ".");
  if (clean === "") return null;
  const pct = Number(clean);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
  return Math.round(pct * 100);
}

/** 2100 → «21%» · 2150 → «21.5%» */
export function formatBp(bp: number): string {
  const pct = bp / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "")}%`;
}

/** 2100 → «21» para un campo de edición. */
export function bpToInput(bp: number): string {
  const pct = bp / 100;
  return pct % 1 === 0 ? String(pct) : String(pct);
}

/**
 * Impuesto de una línea, redondeado a centavo.
 * Se redondea POR LÍNEA, igual que en el ticket impreso — si se redondeara al
 * final, el papel y la base dirían cifras distintas.
 */
export function lineTaxCents(
  quantity: number,
  unitPriceCents: number,
  bp: number,
): number {
  return Math.round((quantity * unitPriceCents * bp) / 10000);
}

/** Cantidades de inventario en milésimas: 1500 = 1,5 kg. */
export function parseMilli(input: string): number | null {
  const clean = input.trim().replace(",", ".");
  if (clean === "") return null;
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

/** 1500 → «1.5» · 24000 → «24» */
export function formatMilli(milli: number): string {
  return String(Number((milli / 1000).toFixed(3)));
}
