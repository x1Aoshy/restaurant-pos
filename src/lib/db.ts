import Database from "@tauri-apps/plugin-sql";
import { invoke, isTauri } from "@tauri-apps/api/core";

const DB_URL = "sqlite:pos.db";

let handle: Database | null = null;
let opening: Promise<Database> | null = null;

/**
 * Conexión única a la base local.
 *
 * `opening` evita la carrera del arranque: varios proveedores piden la base a
 * la vez en el primer render y sin esto se abrirían varias conexiones, cada una
 * ejecutando las migraciones por su cuenta.
 */
export async function getDb(): Promise<Database> {
  if (handle) return handle;
  if (!isTauri()) {
    throw new Error(
      "La base de datos local solo existe dentro de la aplicación de escritorio. Usa `npm run tauri dev`.",
    );
  }
  if (!opening) {
    opening = Database.load(DB_URL).then(async (db) => {
      // WAL: un escritor y varios lectores a la vez, en lugar de bloquear el
      // fichero entero en cada escritura. Es persistente —queda escrito en la
      // cabecera del fichero—, así que basta con pedirlo; repetirlo en cada
      // arranque no cuesta nada y cubre las bases creadas antes de esto.
      await db.execute("PRAGMA journal_mode = WAL");
      handle = db;
      return db;
    });
  }
  return opening;
}

/** Consulta que devuelve filas. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

/** Consulta que devuelve una fila o nada. */
export async function queryOne<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Sentencia que no devuelve filas. */
export async function exec(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.execute(sql, params);
}

export interface Statement {
  sql: string;
  values?: unknown[];
}

/**
 * Varias sentencias como una sola unidad: o entran todas, o no entra ninguna.
 *
 * Va por un comando propio de Rust y no por `BEGIN` / `COMMIT` sueltos. El
 * plugin reparte cada llamada entre las conexiones de su pool, así que aquel
 * `BEGIN` abría la transacción en una conexión, las sentencias corrían en
 * otras —fuera de la transacción— y la primera se quedaba con el candado de
 * escritura tomado. De ahí venían los «database is locked».
 *
 * Se declaran las sentencias en vez de pasar una función porque tienen que
 * cruzar a Rust juntas; no se puede ir y volver a mitad de transacción.
 */
export async function transaction(statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await getDb();
  await invoke("sql_transaction", {
    db: DB_URL,
    statements: statements.map((s) => ({ sql: s.sql, values: s.values ?? [] })),
  });
}

/** Identificador local. No hace falta coordinación: solo escribe este equipo. */
export function newId(): string {
  return crypto.randomUUID();
}

/** SQLite guarda los booleanos como 0/1. */
export const bool = (v: number | boolean): boolean => v === 1 || v === true;
export const toInt = (v: boolean): number => (v ? 1 : 0);
