import { invoke } from "@tauri-apps/api/core";

import { exec, query, queryOne, transaction, type Statement } from "@/lib/db";
import { statementFor, type RemoteChange } from "@/features/sync/tables";
import { seedStatements } from "@/features/sync/seed";
import { mergeStatements } from "@/features/sync/merge-orders";

const DB_URL = "sqlite:pos.db";

/** Tanda de subida. Suficiente para un turno entero sin ser una llamada enorme. */
const PUSH_BATCH = 200;
const PULL_BATCH = 500;

export interface SyncConfig {
  url: string;
  anonKey: string;
  token: string;
}

export interface SyncContextRow {
  device_id: string;
  enabled: number;
  applying: number;
  last_seq: number;
}

interface OutboxRow {
  seq: number;
  table_name: string;
  row_id: string;
  op: "upsert" | "delete";
  payload: string | null;
}

export async function readContext(): Promise<SyncContextRow | null> {
  return queryOne<SyncContextRow>(
    "SELECT device_id, enabled, applying, last_seq FROM sync_context WHERE id = 1",
  );
}

/**
 * Enciende o apaga la sincronización.
 *
 * Encender por primera vez **siembra el buzón** con lo que ya hay en la base.
 * Sin eso el interruptor solo levantaba una bandera: los triggers empezaban a
 * recoger los cambios siguientes y todo lo anterior —la carta, el personal, las
 * mesas— se quedaba sin salir nunca, así que el terminal nuevo arrancaba vacío.
 *
 * Las dos cosas van en la misma transacción a propósito. Si la siembra fallara
 * a mitad con el interruptor ya encendido, quedaría un equipo sincronizando sin
 * haber subido su catálogo, y eso no se nota hasta que alguien mira el segundo
 * terminal y no encuentra los productos.
 *
 * Devuelve cuántas filas se encolaron, para poder decirlo en pantalla en vez de
 * dejar al operador mirando una barra que no sabe si avanza.
 */
export async function setEnabled(on: boolean): Promise<number> {
  if (!on) {
    await exec("UPDATE sync_context SET enabled = 0 WHERE id = 1");
    return 0;
  }

  const row = await queryOne<{ seeded_at: string | null }>(
    "SELECT seeded_at FROM sync_context WHERE id = 1",
  );

  const statements: Statement[] = [
    { sql: "UPDATE sync_context SET enabled = 1 WHERE id = 1", values: [] },
  ];

  if (!row?.seeded_at) {
    statements.push(...seedStatements());
    statements.push({
      sql: "UPDATE sync_context SET seeded_at = datetime('now') WHERE id = 1",
      values: [],
    });
  }

  const before = await pendingCount();
  await transaction(statements);
  return (await pendingCount()) - before;
}

export async function pendingCount(): Promise<number> {
  const row = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM sync_outbox");
  return row?.n ?? 0;
}

/** Llama a una función del servidor. Devuelve el cuerpo ya interpretado. */
async function rpc<T>(config: SyncConfig, fn: string, body: unknown): Promise<T> {
  const base = config.url.replace(/\/+$/, "");
  const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // El servidor devuelve 28000 cuando la clave del local no vale. Merece un
    // mensaje propio: es el error que de verdad va a pasarle a alguien.
    if (text.includes("28000") || response.status === 401 || response.status === 403) {
      throw new Error("badToken");
    }
    throw new Error(`${response.status} ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

/**
 * Sube lo pendiente y borra del buzón solo lo que el servidor confirmó.
 *
 * El borrado va DESPUÉS de la respuesta, nunca antes: si se cortara la conexión
 * a mitad, los cambios seguirían en el buzón y volverían a salir. Duplicar un
 * cambio es inocuo —todos son «pon esta fila así»—; perderlo, no.
 */
export async function pushPending(config: SyncConfig, deviceId: string): Promise<number> {
  const rows = await query<OutboxRow>(
    "SELECT seq, table_name, row_id, op, payload FROM sync_outbox ORDER BY seq LIMIT $1",
    [PUSH_BATCH],
  );
  if (rows.length === 0) return 0;

  await rpc<number>(config, "sync_push", {
    p_token: config.token,
    p_device: deviceId,
    p_changes: rows.map((r) => ({
      table_name: r.table_name,
      row_id: r.row_id,
      op: r.op,
      payload: r.payload ? JSON.parse(r.payload) : null,
    })),
  });

  await exec("DELETE FROM sync_outbox WHERE seq <= $1", [rows[rows.length - 1].seq]);
  return rows.length;
}

/**
 * Baja lo nuevo y lo aplica en orden estricto de llegada.
 *
 * El orden importa: es lo que sustituye a comparar relojes entre equipos. Y por
 * eso también se aplica de una vez y no cambio a cambio — una línea de comanda
 * necesita que su cuenta ya esté, y ese orden lo garantiza el servidor.
 */
export async function pullChanges(
  config: SyncConfig,
  deviceId: string,
  after: number,
): Promise<{ applied: number; skipped: number; merged: number; lastSeq: number }> {
  const body = await rpc<RemoteChange[]>(config, "sync_pull", {
    p_token: config.token,
    p_device: deviceId,
    p_after: after,
    p_limit: PULL_BATCH,
  });

  // Se comprueba que sea una lista antes de recorrerla. Un servidor que
  // responda 200 con otra cosa —un proxy de por medio, un portal de wifi que
  // devuelve su propia página— haría fallar el `.filter` de la fusión con un
  // error que no se parece en nada a la causa.
  const changes = Array.isArray(body) ? body : [];
  if (changes.length === 0) return { applied: 0, skipped: 0, merged: 0, lastSeq: after };

  // La fusión va PRIMERO: si dos terminales abrieron la misma mesa, el índice
  // de una cuenta viva por mesa rechaza la segunda y tumba la transacción
  // entera. Y como no avanzaría `last_seq`, el equipo reintentaría el mismo
  // lote cada treinta segundos para siempre.
  const plan = await mergeStatements(changes);
  const statements: Statement[] = [...plan.before];

  let skipped = 0;
  for (const change of changes) {
    const statement = statementFor(change);
    if (statement) statements.push(statement);
    else skipped++;
  }

  statements.push(...plan.after);

  // El mayor `seq` del lote, y no el del último elemento: el orden lo pone el
  // servidor, pero de ese número depende no volver a pedir lo mismo, así que se
  // deduce de lo que llegó en vez de darlo por hecho. Un lote entero sin `seq`
  // utilizable deja el contador donde estaba, que es lo único seguro.
  const lastSeq = changes.reduce(
    (max, c) => (typeof c?.seq === "number" && Number.isFinite(c.seq) && c.seq > max ? c.seq : max),
    after,
  );

  // Aun sin nada que aplicar hay que avanzar el contador, o se pediría lo mismo
  // una y otra vez para siempre.
  await invoke("sql_apply_remote", { db: DB_URL, statements, lastSeq });

  return { applied: statements.length, skipped, merged: plan.merged, lastSeq };
}
