import type { Statement } from "@/lib/db";
import { SYNCED_TABLES } from "@/features/sync/tables";

/**
 * Volcado inicial del buzón al encender la sincronización.
 *
 * Los triggers del buzón solo escriben con `enabled = 1`. Lo que ya existía
 * antes de encender no pasó nunca por ellos, así que sin esto el terminal que
 * se une arranca vacío: sin carta, sin mesas y sin personal. Ver `013`.
 *
 * ## La lista de columnas sale de `SYNCED_TABLES`, no de una copia
 *
 * Es deliberado. Si la siembra tuviera su propia lista, el día que alguien
 * añada una columna a la lista blanca la sembrada se quedaría corta y el fallo
 * aparecería solo en el terminal nuevo, meses después, como un campo vacío que
 * nadie sabe explicar. Con una sola fuente eso no puede pasar.
 *
 * Los nombres de tabla y columna se concatenan en el SQL, pero aquí —al revés
 * que en `tables.ts`— no vienen de la red: son constantes del propio programa.
 */

/**
 * Hasta dónde atrás se siembra la historia.
 *
 * Noventa días porque es exactamente lo que conserva el servidor: `sync_prune`
 * borra el registro de cambios más viejo que eso. Sembrar más sería subir filas
 * para que las borren, y en un local con un año de ventas eso son decenas de
 * miles de peticiones que no le sirven a nadie.
 *
 * Lo que sí viaja entero es el catálogo —carta, personal, mesas, impresoras,
 * recetas—, que es pequeño y sin él el terminal nuevo no puede ni abrir una
 * cuenta.
 */
const WINDOW_DAYS = 90;

const CUTOFF = `datetime('now', '-${WINDOW_DAYS} days')`;

/** Las cuentas vivas viajan siempre, tengan la edad que tengan. */
const LIVE = `status IN ('open','sent_to_kitchen','served','billed')`;

interface SeedSpec {
  table: string;
  /** Expresión SQL que produce el `row_id`, igual que en los triggers. */
  rowId: string;
  /** Filtro opcional. Sin él se siembra la tabla entera. */
  where?: string;
}

/**
 * El orden importa: el terminal que recibe aplica en el orden en que salieron,
 * y sus claves foráneas exigen que el padre llegue antes que el hijo. Una línea
 * de comanda antes que su cuenta se rechaza, y el rechazo tumba el lote entero.
 */
const SEED_ORDER: SeedSpec[] = [
  // --- Catálogo y configuración: entero, siempre ---
  { table: "settings", rowId: "'1'" },
  { table: "staff", rowId: "id" },
  { table: "zones", rowId: "id" },
  { table: "tables", rowId: "id" },
  { table: "products", rowId: "id" },
  { table: "inventory_items", rowId: "id" },
  { table: "printers", rowId: "id" },
  { table: "printer_routing", rowId: "id" },
  { table: "product_recipe", rowId: "product_id || '/' || item_id" },

  // --- Historia: la ventana, más lo que siga vivo ---
  {
    table: "orders",
    rowId: "id",
    where: `(created_at >= ${CUTOFF} OR ${LIVE})`,
  },
  {
    // Por la cuenta y no por su propia fecha: filtrar la línea aparte dejaría
    // cuentas sembradas a las que les faltan renglones, que es peor que no
    // sembrarlas.
    table: "order_items",
    rowId: "id",
    where: `order_id IN (SELECT id FROM orders WHERE created_at >= ${CUTOFF} OR ${LIVE})`,
  },
  { table: "cash_registers", rowId: "id", where: `opened_at >= ${CUTOFF}` },
  {
    table: "cash_movements",
    rowId: "id",
    where: `register_id IN (SELECT id FROM cash_registers WHERE opened_at >= ${CUTOFF})`,
  },
  { table: "expenses", rowId: "id", where: `created_at >= ${CUTOFF}` },
  {
    // Mismo criterio que el trigger `outbox_inventory_movements_insert`: los
    // apuntes que nacen de una venta NO viajan, los recalcula cada terminal al
    // recibir la línea de comanda. Si viajaran se contarían dos veces.
    table: "inventory_movements",
    rowId: "id",
    where: `order_item_id IS NULL AND order_id IS NULL AND created_at >= ${CUTOFF}`,
  },
];

/**
 * Las sentencias que llenan el buzón. No se ejecutan aquí: van a la misma
 * transacción que enciende el interruptor, para que no pueda quedar encendido
 * sin sembrar ni sembrado sin encender.
 */
export function seedStatements(): Statement[] {
  return SEED_ORDER.map(({ table, rowId, where }) => {
    const spec = SYNCED_TABLES[table];
    if (!spec) throw new Error(`siembra: «${table}» no está en la lista blanca`);

    const pairs = spec.columns.map((c) => `'${c}', ${c}`).join(", ");

    return {
      sql:
        `INSERT INTO sync_outbox (table_name, row_id, op, payload)\n` +
        `SELECT '${table}', ${rowId}, 'upsert', json_object(${pairs})\n` +
        `  FROM ${table}` +
        (where ? `\n WHERE ${where}` : ""),
      values: [],
    };
  });
}

/** Las tablas que siembra, en orden. Para las comprobaciones. */
export const SEEDED_TABLES = SEED_ORDER.map((s) => s.table);
