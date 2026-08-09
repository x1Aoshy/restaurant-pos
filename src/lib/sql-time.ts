/**
 * Fechas locales dentro de SQLite.
 *
 * SQLite guarda las marcas de tiempo en UTC. Agrupar por esa fecha sin más
 * parte el día por la mitad: en Nicaragua (UTC−6) todo lo cobrado a partir de
 * las 18:00 —las horas de más venta— caería en el día siguiente.
 *
 * El desplazamiento se interpola en el SQL en vez de ir como parámetro porque
 * aparece dos veces en casi cada consulta, y repetir un marcador depende de
 * cómo reparta los índices cada controlador. El valor no viene de ninguna
 * entrada del usuario: lo produce el reloj del sistema y esta expresión lo deja
 * en «±NNN minutes» sin margen para otra cosa.
 */
const OFFSET_MINUTES = -new Date().getTimezoneOffset();

/** Listo para pegar en una llamada a `date()` o `strftime()`. */
export const SHIFT_SQL = `'${OFFSET_MINUTES >= 0 ? "+" : ""}${OFFSET_MINUTES} minutes'`;
