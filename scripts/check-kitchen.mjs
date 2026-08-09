/**
 * Comprueba qué sale por cocina y qué no.
 *
 * Los dos fallos posibles aquí cuestan dinero y ninguno da error en pantalla:
 * si una línea no se marca, la cocina hace el plato dos veces; si se marca sin
 * imprimirse, el plato no se hace nunca y el cliente lo espera sentado.
 *
 * El SQL no se copia: se saca del propio `use-printing.ts`, así que cambiar la
 * consulta allí sin querer rompe esta comprobación en vez de romper el servicio.
 *
 *   node --experimental-sqlite scripts/check-kitchen.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "src-tauri", "migrations");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
for (const f of readdirSync(base).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(join(base, f), "utf8"));
}

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`,
  );
}

// --- El SQL de verdad -------------------------------------------------------
const hook = readFileSync(join(root, "src/features/printing/use-printing.ts"), "utf8");

/** Saca una plantilla literal del fuente por cómo empieza. */
function sqlFrom(start) {
  const at = hook.indexOf("`" + start);
  if (at === -1) throw new Error(`no encuentro el SQL que empieza por «${start}»`);
  const end = hook.indexOf("`", at + 1);
  return hook.slice(at + 1, end);
}

const PENDING = sqlFrom("SELECT oi.id, p.name");
const MARK = sqlFrom("UPDATE order_items SET printed_at");

/** SQLite de node usa `?`; la aplicación usa `$1`. Mismo orden. */
const positional = (sql) => sql.replace(/\$\{holes\}/g, "?").replace(/\$\d+/g, "?");
const pending = (orderId) => db.prepare(positional(PENDING)).all(orderId);

/** El UPDATE lleva la lista de huecos interpolada; se reconstruye igual. */
function mark(ids) {
  const holes = ids.map(() => "?").join(", ");
  db.prepare(positional(MARK).replace("(?)", `(${holes})`)).run(...ids);
}

// --- Datos ------------------------------------------------------------------
db.exec(`
  INSERT INTO staff (id, full_name, role, pin_hash) VALUES ('ana','Ana','waiter','x');
  INSERT INTO tables (id, number, capacity) VALUES ('t1',1,4);
  INSERT INTO products (id, name, price_cents, category, print_group) VALUES
    ('plato','Gallo pinto',15000,'Comida','hot_food'),
    ('trago','Cerveza',6000,'Bebidas','drinks');
  INSERT INTO orders (id, table_id, tax_bp, opened_by) VALUES ('o1','t1',1500,'ana');
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp) VALUES
    ('l1','o1','plato',2,15000,1500),
    ('l2','o1','trago',3,6000,1500);
`);

// --- 1. Lo recién apuntado está pendiente -----------------------------------
check("todo pendiente al abrir", pending("o1").map((r) => r.id), ["l2", "l1"]);
check(
  "cada línea trae su grupo",
  pending("o1").map((r) => r.print_group),
  ["drinks", "hot_food"],
);

// --- 2. Marcar solo lo que se imprimió --------------------------------------
// Cocina tiene impresora, la barra no: el trago sigue esperando a que la haya.
mark(["l1"]);
check("lo impreso desaparece de la cola", pending("o1").map((r) => r.id), ["l2"]);

const total = () => db.prepare("SELECT total_cents FROM orders WHERE id='o1'").get();
const before = total().total_cents;
mark(["l2"]);
check("imprimir no toca el total", total().total_cents, before);
check("cola vacía", pending("o1").length, 0);

// --- 3. Añadir después no reimprime lo de antes -----------------------------
db.exec(`
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
  VALUES ('l3','o1','plato',1,15000,1500)
`);
check("solo sale lo nuevo", pending("o1").map((r) => r.id), ["l3"]);

// --- 4. Lo anulado no se cocina ---------------------------------------------
db.exec("UPDATE order_items SET voided_at = datetime('now') WHERE id='l3'");
check("la línea anulada no sale", pending("o1").length, 0);

// --- 5. La marca viaja entre terminales -------------------------------------
// Sin esto, el terminal de arriba volvería a mandar a cocina lo que ya mandó el
// de abajo, y saldrían dos platos.
db.exec("UPDATE sync_context SET enabled = 1, device_id = 'd1' WHERE id = 1");
db.exec(`
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
  VALUES ('l4','o1','trago',1,6000,1500)
`);
mark(["l4"]);
const payloads = db
  .prepare("SELECT payload FROM sync_outbox WHERE table_name='order_items'")
  .all()
  .map((r) => JSON.parse(r.payload));
check("el buzón recogió el cambio", payloads.length > 0, true);
check(
  "printed_at va en el mensaje",
  payloads.every((p) => "printed_at" in p),
  true,
);
check(
  "y con la fecha puesta al marcar",
  payloads.at(-1).printed_at !== null,
  true,
);

// --- 6. La columna se acepta al recibir -------------------------------------
const tablesSrc = readFileSync(join(root, "src/features/sync/tables.ts"), "utf8");
const { code } = await transform(tablesSrc.replace(/^import .*?;$/gm, ""), {
  loader: "ts",
  format: "esm",
});
const { SYNCED_TABLES } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
check(
  "printed_at está en la lista blanca",
  SYNCED_TABLES.order_items.columns.includes("printed_at"),
  true,
);

// --- 7. El índice que sostiene la consulta ----------------------------------
const plan = db
  .prepare(`EXPLAIN QUERY PLAN ${positional(PENDING)}`)
  .all("o1")
  .map((r) => r.detail)
  .join(" | ");
check("la cola usa el índice parcial", plan.includes("order_items_pending_print_idx"), true);

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
