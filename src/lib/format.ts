export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "Dólar estadounidense", symbol: "$", locale: "en-US" },
  { code: "NIO", label: "Córdoba nicaragüense", symbol: "C$", locale: "es-NI" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code);
}

/** Locale que muestra cada moneda con su símbolo esperado (C$, $, €). */
export function currencyLocale(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.locale ?? "en-US";
}

let currencyCode: CurrencyCode = "USD";
let localeCode = "en-US";

/**
 * Se llama una vez desde `settings` tras el login. Cualquier valor fuera de la
 * lista soportada cae a USD en lugar de dejar que Intl.NumberFormat lance un
 * RangeError — que tumbaría todas las pantallas que pintan un precio.
 */
export function configureCurrency(currency: string) {
  const safe: CurrencyCode = isSupportedCurrency(currency) ? currency : "USD";
  currencyCode = safe;
  localeCode = currencyLocale(safe);
}

export function formatMoney(amount: number) {
  return new Intl.NumberFormat(localeCode, {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

/**
 * Formatea un importe guardado en CENTAVOS enteros — la representación de la
 * base local. Convive con `formatMoney`, que recibe decimales, mientras dura
 * la migración desde Supabase.
 */
export function formatCents(cents: number) {
  return new Intl.NumberFormat(localeCode, {
    style: "currency",
    currency: currencyCode,
  }).format(cents / 100);
}

export function formatRate(rate: number) {
  // Redondear primero: 0.21 * 100 es 21.000000000000004 en coma flotante, y
  // sin esto se mostraría «21,00%» en vez de «21%».
  const pct = Math.round(rate * 10000) / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

/**
 * Fecha de HOY en horario local, «YYYY-MM-DD».
 *
 * No vale `toISOString().slice(0,10)`: convierte a UTC, y en Nicaragua (UTC−6)
 * todo lo registrado después de las 18:00 se guardaría con la fecha del día
 * siguiente. Justo las horas de más venta.
 */
export function todayLocal(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Desplaza `days` días desde hoy y devuelve la fecha local en «YYYY-MM-DD». */
export function daysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayLocal(d);
}

/**
 * La mesa 0 no es una mesa: es el mostrador.
 *
 * Se reservó ese número para poder cobrar en la barra sin ocupar sitio, pero
 * enseñarlo como «00» en el historial no le dice nada a nadie. Cualquier sitio
 * que pinte un número de mesa pasa por aquí.
 */
export const COUNTER_TABLE = 0;

export function tableLabel(number: number, counterName: string): string {
  return number === COUNTER_TABLE ? counterName : String(number).padStart(2, "0");
}

/** Tiempo transcurrido compacto desde un ISO — "8m", "1h 12m". */
export function elapsedSince(iso: string, now: number = Date.now()) {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
