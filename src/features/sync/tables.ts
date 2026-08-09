import type { Statement } from "@/lib/db";

/**
 * Qué tablas y columnas se aceptan de fuera.
 *
 * Esto no es documentación: es la frontera de seguridad del lado que recibe.
 * Los nombres de tabla y de columna no se pueden pasar como parámetros de una
 * consulta, así que acaban concatenados en el SQL. Si se tomaran tal cual del
 * mensaje que llega por la red, cualquiera que hablase con el servidor podría
 * escribir la sentencia que quisiera en la base de este equipo.
 *
 * Por eso todo lo que no esté escrito aquí abajo se descarta. Los valores sí
 * viajan como parámetros y no hace falta comprobarlos.
 *
 * Las columnas calculadas —totales, estado de mesa, existencias— NO están, a
 * propósito: las deduce cada terminal de las filas de origen. Recibirlas
 * además de calcularlas las contaría dos veces. Ver docs/SYNC.md.
 */
interface SyncedTable {
  /** Clave primaria, para el ON CONFLICT. */
  pk: string[];
  columns: string[];
}

export const SYNCED_TABLES: Record<string, SyncedTable> = {
  settings: {
    pk: ["id"],
    columns: [
      "restaurant_name",
      "address",
      "phone",
      "currency",
      "default_tax_bp",
      "ticket_header",
      "ticket_footer",
      "show_tax_breakdown",
      "ticket_format",
      "language",
    ],
  },
  staff: {
    pk: ["id"],
    columns: ["id", "full_name", "role", "pin_hash", "active", "created_at"],
  },
  tables: {
    pk: ["id"],
    columns: ["id", "number", "capacity", "zone_id"],
  },
  products: {
    pk: ["id"],
    columns: [
      "id",
      "name",
      "price_cents",
      "category",
      "available",
      "tax_bp",
      "print_group",
      "created_at",
    ],
  },
  orders: {
    pk: ["id"],
    columns: [
      "id",
      "table_id",
      "status",
      "tax_bp",
      "opened_by",
      "payment_method",
      "payment_ref",
      "tip_cents",
      "tendered_cents",
      // `discount_cents` NO está: lo calcula el trigger sumando las líneas. Si
      // llegara de fuera habría dos verdades y ganaría la equivocada.
      "discount_reason",
      "discount_by",
      "created_at",
      "closed_at",
    ],
  },
  order_items: {
    pk: ["id"],
    columns: [
      "id",
      "order_id",
      "product_id",
      "quantity",
      "unit_price_cents",
      "tax_bp",
      "notes",
      "discount_cents",
      "voided_at",
      "void_reason",
      "voided_by",
      "printed_at",
      "created_at",
    ],
  },
  expenses: {
    pk: ["id"],
    columns: [
      "id",
      "amount_cents",
      "category",
      "note",
      "spent_on",
      "created_by",
      "created_at",
    ],
  },
  inventory_items: {
    pk: ["id"],
    columns: [
      "id",
      "name",
      "unit",
      "min_stock_milli",
      "unit_cost_cents",
      "active",
      "created_at",
    ],
  },
  inventory_movements: {
    pk: ["id"],
    columns: [
      "id",
      "item_id",
      "quantity_milli",
      "kind",
      "note",
      "created_by",
      "created_at",
    ],
  },
  product_recipe: {
    pk: ["product_id", "item_id"],
    columns: ["product_id", "item_id", "quantity_milli"],
  },
  zones: {
    pk: ["id"],
    columns: ["id", "name", "created_at"],
  },
  printers: {
    pk: ["id"],
    columns: [
      "id",
      "name",
      "connection",
      "address",
      "port",
      "width_chars",
      "opens_drawer",
      "active",
      "codepage",
      "cut_mode",
      "created_at",
    ],
  },
  printer_routing: {
    pk: ["id"],
    columns: ["id", "zone_id", "print_group", "printer_id"],
  },
  cash_registers: {
    pk: ["id"],
    // Sin `expected_cents` ni `difference_cents`: los deduce cada equipo de los
    // movimientos, igual que los totales de una cuenta.
    columns: [
      "id",
      "device_id",
      "opened_by",
      "opened_at",
      "opening_float_cents",
      "closed_by",
      "closed_at",
      "counted_cents",
      "status",
      "note",
    ],
  },
  cash_movements: {
    pk: ["id"],
    columns: [
      "id",
      "register_id",
      "kind",
      "amount_cents",
      "order_id",
      "note",
      "created_by",
      "created_at",
    ],
  },
};

export interface RemoteChange {
  seq: number;
  table_name: string;
  row_id: string;
  op: "upsert" | "delete";
  payload: Record<string, unknown> | null;
}

/**
 * Busca la tabla por propiedad PROPIA, no por la cadena de prototipos.
 *
 * `SYNCED_TABLES[nombre]` a secas también encuentra lo que hereda de
 * `Object.prototype`. Con `table_name` puesto a `"constructor"`, `"toString"`,
 * `"valueOf"` o `"__proto__"` la búsqueda devuelve algo que NO es nulo —una
 * función, o el prototipo— y por tanto pasa el `if (!table)`. Lo que viene
 * detrás lee `table.pk` y `table.columns`, que ahí no existen, y lanza un
 * `TypeError`.
 *
 * Que lance es exactamente lo que este filtro promete no hacer, y el precio no
 * es un mensaje perdido: la excepción sube hasta `pullChanges` antes de que se
 * aplique nada, así que `last_seq` no avanza y el terminal vuelve a pedir el
 * mismo lote —con el mismo mensaje envenenado dentro— cada treinta segundos.
 * La sincronización de entrada queda muerta para siempre en todos los equipos
 * del local, y en pantalla solo se lee «error de red», que apunta a otro sitio.
 * Un mensaje así se cuela con solo tener la clave del local, y se queda en el
 * servidor los noventa días que tarda `sync_prune` en barrerlo.
 */
export function specFor(name: unknown): SyncedTable | null {
  if (typeof name !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(SYNCED_TABLES, name)) return null;
  return SYNCED_TABLES[name];
}

/**
 * Convierte un cambio remoto en una sentencia, o en `null` si no pasa el
 * filtro. Nunca lanza: un mensaje raro no debe parar la sincronización entera,
 * porque bastaría uno para dejar el terminal atascado para siempre.
 */
export function statementFor(change: RemoteChange): Statement | null {
  if (!change || typeof change !== "object") return null;
  const table = specFor(change.table_name);
  if (!table) return null;

  if (change.op === "delete") {
    // `settings` no se borra nunca: es una fila fija.
    if (change.table_name === "settings") return null;
    // El servidor declara `row_id` como texto, pero eso lo garantiza el
    // servidor, no este lado. Comprobarlo cuesta una línea y evita que un
    // `split` sobre un número lance donde se prometió no lanzar.
    if (typeof change.row_id !== "string") return null;
    const keys = change.row_id.split("/");
    if (keys.length !== table.pk.length) return null;
    const where = table.pk.map((c, i) => `${c} = $${i + 1}`).join(" AND ");
    return { sql: `DELETE FROM ${change.table_name} WHERE ${where}`, values: keys };
  }

  if (!change.payload || typeof change.payload !== "object") return null;

  // Solo las columnas de la lista, y solo las que vengan en el mensaje: así una
  // versión más nueva que mande columnas de más no rompe a una más vieja.
  const cols = table.columns.filter((c) =>
    Object.prototype.hasOwnProperty.call(change.payload, c),
  );
  if (cols.length === 0) return null;

  const values: unknown[] = [];
  const holes: string[] = [];

  for (const col of cols) {
    const value = change.payload[col] ?? null;

    // Una línea cuya cuenta fue absorbida por otra va a la que se quedó. Se
    // resuelve dentro del SQL y no antes porque las líneas de una comanda
    // fusionada pueden seguir llegando días después —desde un terminal que
    // estuvo apagado—, y para entonces ya nadie recuerda la fusión.
    //
    // El valor se manda DOS veces en vez de repetir el marcador: repetir «$2»
    // deja el enlace a merced de cómo numere los parámetros cada controlador,
    // y no merece la pena apostar en la única consulta construida a partir de
    // datos de red.
    if (change.table_name === "order_items" && col === "order_id") {
      values.push(value, value);
      holes.push(
        `COALESCE((SELECT merged_into FROM orders WHERE id = $${values.length - 1}), $${values.length})`,
      );
      continue;
    }

    values.push(value);
    holes.push(`$${values.length}`);
  }

  // `settings` es una fila única con id fijo; el resto trae su clave dentro.
  if (change.table_name === "settings") {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    return { sql: `UPDATE settings SET ${sets} WHERE id = 1`, values };
  }

  const updatable = cols.filter((c) => !table.pk.includes(c));
  if (updatable.length === 0) {
    return {
      sql: `INSERT INTO ${change.table_name} (${cols.join(", ")})
            VALUES (${holes.join(", ")})
            ON CONFLICT (${table.pk.join(", ")}) DO NOTHING`,
      values,
    };
  }

  const sets = updatable.map((c) => `${c} = excluded.${c}`).join(", ");
  return {
    sql: `INSERT INTO ${change.table_name} (${cols.join(", ")})
          VALUES (${holes.join(", ")})
          ON CONFLICT (${table.pk.join(", ")}) DO UPDATE SET ${sets}`,
    values,
  };
}
