/**
 * Aritmética del efectivo en mano.
 *
 * Todo en centavos enteros, como el resto del dinero de la aplicación. Aquí
 * importa más que en ningún otro sitio: el vuelto se cuenta delante del cliente
 * y un centavo de diferencia se ve.
 */

/**
 * Billetes en circulación, en centavos.
 *
 * Solo billetes: sugerir «entrega 383,50» no ayuda a nadie porque nadie paga
 * así. Las monedas se usan para completar, no para elegir con qué pagar.
 */
const NOTES: Record<string, number[]> = {
  // Córdoba nicaragüense: 10, 20, 50, 100, 200, 500 y 1000.
  NIO: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
  // Dólar: 1, 5, 10, 20, 50 y 100.
  USD: [100, 500, 1000, 2000, 5000, 10000],
};

export function notesFor(currency: string): number[] {
  return NOTES[currency] ?? NOTES.NIO;
}

/**
 * Con cuánto es probable que paguen.
 *
 * Devuelve como mucho tres importes por encima de lo que se debe, ordenados.
 * Sirven para cobrar de un toque en vez de teclear, que es donde se pierde
 * tiempo con el cliente delante.
 *
 * Se descartan los billetes de menos de la quinta parte de la cuenta: redondear
 * una cuenta de 125 al siguiente múltiplo de 10 da 130, y nadie paga 130. Con
 * ese filtro salen 150, 200 y 500, que es lo que de verdad se entrega.
 */
export function cashSuggestions(dueCents: number, notes: number[]): number[] {
  if (dueCents <= 0) return [];

  const useful = notes.filter((n) => n * 5 >= dueCents);
  const out = new Set<number>();

  for (const note of useful) {
    // Cuántos billetes de este valor hacen falta, redondeando hacia arriba.
    const up = Math.ceil(dueCents / note) * note;
    if (up > dueCents) out.add(up);
  }

  return [...out].sort((a, b) => a - b).slice(0, 3);
}

/**
 * Lee un importe tal y como lo teclea una persona.
 *
 * `500` son quinientos, no cinco. Antes estos campos se llenaban por la
 * derecha —teclear 5-0-0 dejaba 5,00— que es la costumbre de las cajas
 * registradoras físicas, y en un teclado de ordenador es una trampa: para
 * cobrar quinientos había que escribir `50000`. Quien se equivoca ve «Falta
 * C$495» y no entiende por qué.
 *
 * Acepta coma o punto como decimal y separadores de miles. Cuando aparecen los
 * dos signos, manda el ÚLTIMO: en `1.234,56` decide la coma y en `1,234.56` el
 * punto, que es como se escribe a cada lado del charco.
 *
 * Devuelve `null` si no hay un número — el campo vacío y la basura son lo
 * mismo aquí: no se ha dicho nada.
 */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/\s/g, "");
  if (clean === "") return null;

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);

  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  const whole = decimalAt === -1 ? digitsOnly(clean) : digitsOnly(clean.slice(0, decimalAt));
  const frac = decimalAt === -1 ? "" : digitsOnly(clean.slice(decimalAt + 1));

  if (whole === "" && frac === "") return null;
  // Dos decimales: lo que sobra se descarta, no se redondea. Nadie entrega
  // fracciones de centavo y redondear hacia arriba cobraría de más.
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return Number.isFinite(cents) ? cents : null;
}

export interface CashSplit {
  /** Lo que hay que devolver. Cero si pagó justo o de menos. */
  changeCents: number;
  /** Lo que queda sin cobrar. Cero si pagó justo o de más. */
  shortCents: number;
}

/**
 * Reparte lo entregado entre vuelto y lo que falta.
 *
 * Nunca los dos a la vez: o sobra o falta. Se calcula así, y no restando a
 * secas, para que ningún sitio de la interfaz enseñe un vuelto negativo — que
 * es la forma más rápida de que alguien devuelva dinero que no debía.
 */
export function cashSplit(dueCents: number, tenderedCents: number | null): CashSplit {
  if (tenderedCents === null) return { changeCents: 0, shortCents: 0 };
  const diff = tenderedCents - dueCents;
  return {
    changeCents: Math.max(0, diff),
    shortCents: Math.max(0, -diff),
  };
}
