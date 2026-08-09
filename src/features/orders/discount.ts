/**
 * Reparto de un descuento entre las líneas de una cuenta.
 *
 * El descuento se guarda POR LÍNEA porque es lo que rebaja la base imponible, y
 * el impuesto se calcula línea a línea. Pero quien cobra piensa en la cuenta
 * entera: «hazle un 10 %», «quítale 200 córdobas». Traducir lo segundo a lo
 * primero es lo que hace este módulo.
 *
 * Y es justo donde aparecen los descuadres de un centavo. Repartir 100 entre
 * tres líneas iguales da 33,33 cada una: alguien tiene que llevarse el centavo
 * que sobra, y si nadie se lo lleva, la suma de las líneas no cuadra con lo que
 * se le prometió al cliente.
 */

/**
 * Reparte `target` centavos entre líneas de base `bases`, proporcionalmente.
 *
 * Usa el método del resto mayor: se reparte la parte entera y los centavos que
 * sobran van a las líneas cuya fracción quedó más alta. Es determinista —dos
 * terminales con los mismos datos reparten igual— y siempre suma exactamente
 * `target`, que es lo único que el cliente puede comprobar.
 */
export function prorate(bases: number[], target: number): number[] {
  const total = bases.reduce((n, b) => n + b, 0);
  if (total <= 0 || target <= 0) return bases.map(() => 0);

  // Un descuento mayor que la cuenta es una invitación: se regala todo y no se
  // devuelve dinero. Sin este tope, la línea quedaría con base negativa y el
  // impuesto también.
  if (target >= total) return bases.slice();

  const exact = bases.map((b) => (target * b) / total);
  const out = exact.map((v) => Math.floor(v));
  let left = target - out.reduce((n, v) => n + v, 0);

  // Índices ordenados por fracción descendente; a igualdad, el de más base,
  // para que el desempate tampoco dependa del orden de llegada.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), base: bases[i] }))
    .sort((a, b) => b.frac - a.frac || b.base - a.base || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    if (out[i] < bases[i]) {
      out[i] += 1;
      left -= 1;
    }
  }

  return out;
}

/**
 * Descuento porcentual, calculado línea a línea.
 *
 * No se calcula sobre el total y luego se reparte: se aplica a cada línea, igual
 * que el impuesto. Así el ticket cuadra leyéndolo de arriba abajo, que es como
 * lo comprueba un cliente que desconfía.
 */
export function percentOff(bases: number[], percent: number): number[] {
  const pct = Math.min(100, Math.max(0, percent));
  return bases.map((b) => Math.min(b, Math.round((b * pct) / 100)));
}
