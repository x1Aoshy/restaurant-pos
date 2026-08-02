import { query, type Statement } from "@/lib/db";
import { LIVE_ORDER_STATUSES } from "@/types/local";
import type { RemoteChange } from "@/features/sync/tables";

/**
 * Dos terminales abren la misma mesa a la vez.
 *
 * Es el único choque que pasa a diario, y el que no admite «gana el último»:
 * descartar una de las dos cuentas borraría lo que un cliente ya se comió. Se
 * quedan las dos y una absorbe a la otra.
 *
 * ## Por qué se resuelve aquí y no en el servidor
 *
 * El servidor es un registro de cambios, no una réplica del POS: no sabe qué
 * cuentas están vivas en qué mesa, y darle ese conocimiento obligaría a
 * migrarlo cada vez que cambie el esquema — justo lo que el diseño evita.
 *
 * En su lugar la regla es **determinista**: gana la cuenta con `(created_at, id)`
 * menor. Los dos terminales tienen las dos filas, aplican la misma comparación
 * y llegan al mismo resultado sin hablarse. Por eso la fusión tampoco se apunta
 * en el buzón: cada equipo la deduce.
 */

interface LiveOrder {
  id: string;
  table_id: string;
  created_at: string;
}

/** Menor `(created_at, id)` gana. El id desempata para que no haya azar. */
function olderOf(a: LiveOrder, b: LiveOrder): LiveOrder {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;
  return a.id < b.id ? a : b;
}

function isLive(status: unknown): boolean {
  return LIVE_ORDER_STATUSES.includes(status as never);
}

/**
 * La fusión se parte en dos momentos y no es un capricho de orden:
 *
 * - `before`: dejar de estar viva la cuenta absorbida. Tiene que ir ANTES de
 *   que llegue la que gana, porque el índice de una cuenta viva por mesa no
 *   admite las dos ni un instante.
 * - `after`: mover las líneas. Tiene que ir DESPUÉS, porque si la que gana es
 *   la que acaba de llegar, todavía no existe aquí y la clave foránea de
 *   `order_items` la rechazaría.
 */
export interface MergePlan {
  before: Statement[];
  after: Statement[];
  merged: number;
}

export async function mergeStatements(changes: RemoteChange[]): Promise<MergePlan> {
  const incoming = changes.filter(
    (c) =>
      c.table_name === "orders" &&
      c.op === "upsert" &&
      c.payload &&
      isLive((c.payload as { status?: unknown }).status),
  );
  if (incoming.length === 0) return { before: [], after: [], merged: 0 };

  const tableIds = Array.from(
    new Set(incoming.map((c) => String((c.payload as { table_id: string }).table_id))),
  );

  const holes = tableIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<LiveOrder>(
    `SELECT id, table_id, created_at
       FROM orders
      WHERE table_id IN (${holes})
        AND merged_into IS NULL
        AND status IN ('open','sent_to_kitchen','served','billed')`,
    tableIds,
  );

  // Quién manda ahora mismo en cada mesa. Se va actualizando sobre la marcha
  // porque un lote puede traer las DOS cuentas —le pasa a un terminal nuevo que
  // se pone al día de cero—, y entonces la primera todavía no está en la base.
  const holder = new Map<string, LiveOrder>();
  for (const row of rows) holder.set(row.table_id, row);
  const known = new Set(rows.map((r) => r.id));

  const before: Statement[] = [];
  const after: Statement[] = [];
  let merged = 0;

  for (const change of incoming) {
    const payload = change.payload as {
      id: string;
      table_id: string;
      created_at: string;
    };
    const candidate: LiveOrder = {
      id: payload.id,
      table_id: payload.table_id,
      created_at: payload.created_at,
    };

    const current = holder.get(candidate.table_id);
    if (!current) {
      holder.set(candidate.table_id, candidate);
      continue;
    }
    // Ya la conocemos: es una actualización de la misma cuenta, no un choque.
    if (current.id === candidate.id) continue;

    const winner = olderOf(current, candidate);
    const loser = winner.id === current.id ? candidate : current;
    merged++;

    if (!known.has(loser.id)) {
      // La absorbida es la que ACABA de llegar y todavía no existe aquí. No
      // vale marcarla después: su alta chocaría contra el índice de una cuenta
      // viva por mesa antes de llegar a marcarla. Se crea ya absorbida, con lo
      // mínimo, y el cambio normal que viene detrás le rellena el resto sin
      // tocar `merged_into` — esa columna no está en la lista blanca.
      before.push({
        sql: `INSERT INTO orders (id, table_id, created_at, merged_into)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (id) DO UPDATE SET merged_into = excluded.merged_into`,
        values: [loser.id, loser.table_id, loser.created_at, winner.id],
      });
    } else {
      before.push({
        sql: `UPDATE orders SET merged_into = $1 WHERE id = $2 AND merged_into IS NULL`,
        values: [winner.id, loser.id],
      });
    }

    // Aplanar cadenas. Puede pasar de verdad: si un terminal estuvo días
    // apagado y trae una cuenta aún más antigua, la que ganaba pasa a perder y
    // lo que apuntaba a ella se quedaría apuntando a una absorbida.
    before.push({
      sql: `UPDATE orders SET merged_into = $1 WHERE merged_into = $2`,
      values: [winner.id, loser.id],
    });

    // Las líneas de la absorbida pasan a la que se queda. Mover no cambia
    // cantidades, así que el inventario no se toca: la comida se sirvió una vez.
    after.push({
      sql: `UPDATE order_items SET order_id = $1 WHERE order_id = $2`,
      values: [winner.id, loser.id],
    });

    holder.set(candidate.table_id, winner);
    known.add(candidate.id);
  }

  return { before, after, merged };
}
