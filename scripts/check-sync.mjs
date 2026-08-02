/**
 * Comprueba el lado que RECIBE cambios de otro terminal.
 *
 * Es la única superficie de la aplicación que ejecuta SQL construido a partir
 * de datos que llegan por la red. Los nombres de tabla y de columna no se
 * pueden pasar como parámetros, así que acaban concatenados; si el filtro
 * fallara, cualquiera que hablase con el servidor podría escribir la sentencia
 * que quisiera en la base de este equipo.
 *
 * Las sentencias generadas se ejecutan además contra un SQLite real: un filtro
 * que deja pasar SQL inválido tampoco sirve de nada.
 *
 *   node --experimental-sqlite scripts/check-sync.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// `tables.ts` se compila en memoria para poder importarlo tal cual.
// Reimplementar aquí su lógica no probaría nada: se comprueba el código que de
// verdad corre en la aplicación. Se usa la API de esbuild y no su binario
// porque el atajo de `node_modules/.bin` no arranca en Windows.
async function load(relative, strip = /^import type .*?;$/gm) {
  const source = readFileSync(join(root, relative), "utf8").replace(strip, "");
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { statementFor, SYNCED_TABLES } = await load("src/features/sync/tables.ts");

// `merge-orders.ts` habla con la base a través de `query`. Aquí se le da una
// versión que apunta al SQLite de prueba, para poder ejercitar la regla de
// verdad en vez de una copia suya.
let probe = null;
const mergeSource = readFileSync(join(root, "src/features/sync/merge-orders.ts"), "utf8")
  .replace(/^import .*?;$/gm, "")
  .replace(
    "export async function mergeStatements",
    `const LIVE_ORDER_STATUSES = ["open","sent_to_kitchen","served","billed"];
     const query = (sql, params) => globalThis.__probe(sql, params);
     export async function mergeStatements`,
  );
const { mergeStatements } = await import(
  `data:text/javascript;base64,${Buffer.from(
    (await transform(mergeSource, { loader: "ts", format: "esm" })).code,
  ).toString("base64")}`
);
globalThis.__probe = (sql, params) => probe(sql, params);

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`);
}

// --- 1. Lo que no está en la lista se descarta ------------------------------
const rejected = [
  { name: "tabla inventada", table_name: "sqlite_master", row_id: "x", op: "upsert", payload: { a: 1 } },
  { name: "tabla del propio buzón", table_name: "sync_context", row_id: "1", op: "upsert", payload: { enabled: 1 } },
  { name: "inyección en el nombre de tabla", table_name: "products; DROP TABLE staff;--", row_id: "x", op: "upsert", payload: { name: "x" } },
  { name: "operación desconocida", table_name: "products", row_id: "x", op: "truncate", payload: {} },
  { name: "sin payload en un alta", table_name: "products", row_id: "x", op: "upsert", payload: null },
];
for (const c of rejected) {
  check(`rechaza: ${c.name}`, statementFor(c), null);
}

// --- 2. Columnas de más se ignoran, no rompen ------------------------------
{
  const st = statementFor({
    seq: 1,
    table_name: "products",
    row_id: "p1",
    op: "upsert",
    // `stock_milli` no es de products, y `total_cents` es calculada: ninguna
    // debe colarse en el SQL.
    payload: { id: "p1", name: "Ron", price_cents: 250, category: "Tragos", total_cents: 999, "evil--": 1 },
  });
  check("ignora columnas ajenas", st.sql.includes("total_cents"), false);
  check("ignora columnas raras", st.sql.includes("evil"), false);
  check("conserva las buenas", st.sql.includes("price_cents"), true);
}

// --- 3. Lo calculado no está ni en la lista --------------------------------
check("orders sin total_cents", SYNCED_TABLES.orders.columns.includes("total_cents"), false);
check("tables sin status", SYNCED_TABLES.tables.columns.includes("status"), false);
check("inventory_items sin stock_milli", SYNCED_TABLES.inventory_items.columns.includes("stock_milli"), false);
check("movimientos sin order_item_id", SYNCED_TABLES.inventory_movements.columns.includes("order_item_id"), false);

// --- 4. Las sentencias funcionan contra el esquema real --------------------
{
  const base = join(root, "src-tauri", "migrations");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(base).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(base, f), "utf8"));
  }

  // sqlx liga `$1`, `$2`… por posición; `node:sqlite` los trata como nombres y
  // no cuadra. Como `statementFor` siempre los emite en orden ascendente y una
  // sola vez cada uno, cambiarlos por `?` conserva exactamente el mismo enlace.
  const positional = (sql) => sql.replace(/\$\d+/g, "?");

  const run = (change) => {
    const st = statementFor(change);
    if (!st) throw new Error("descartado: " + change.table_name);
    db.prepare(positional(st.sql)).run(
      ...st.values.map((v) => (v === undefined ? null : v)),
    );
  };

  run({ table_name: "tables", row_id: "t9", op: "upsert", payload: { id: "t9", number: 99, capacity: 2 } });
  run({ table_name: "products", row_id: "px", op: "upsert", payload: { id: "px", name: "Ron", price_cents: 250, category: "Tragos", available: 1, tax_bp: null, created_at: "2026-08-02 10:00:00" } });
  run({ table_name: "orders", row_id: "ox", op: "upsert", payload: { id: "ox", table_id: "t9", status: "open", tax_bp: 1500, opened_by: null, payment_method: null, payment_ref: null, created_at: "2026-08-02 10:00:00", closed_at: null } });
  run({ table_name: "order_items", row_id: "ix", op: "upsert", payload: { id: "ix", order_id: "ox", product_id: "px", quantity: 2, unit_price_cents: 250, tax_bp: 1500, notes: null, created_at: "2026-08-02 10:01:00" } });

  const order = db.prepare("SELECT * FROM orders WHERE id='ox'").get();
  check("la cuenta remota entra", order.status, "open");
  // El total NO llegó en el mensaje: lo calculó el trigger de este equipo.
  check("el total lo calcula el receptor", order.total_cents, 575);
  check("la mesa remota queda ocupada", db.prepare("SELECT status FROM tables WHERE id='t9'").get().status, "occupied");

  // Reaplicar el mismo cambio no duplica: los mensajes pueden repetirse cuando
  // se corta la conexión a mitad de una subida.
  run({ table_name: "order_items", row_id: "ix", op: "upsert", payload: { id: "ix", order_id: "ox", product_id: "px", quantity: 2, unit_price_cents: 250, tax_bp: 1500, notes: null, created_at: "2026-08-02 10:01:00" } });
  check("reaplicar no duplica", db.prepare("SELECT COUNT(*) n FROM order_items").get().n, 1);

  // Baja con clave compuesta.
  run({ table_name: "inventory_items", row_id: "i9", op: "upsert", payload: { id: "i9", name: "Ron", unit: "botella", min_stock_milli: 0, unit_cost_cents: 0, active: 1, created_at: "2026-08-02 10:00:00" } });
  run({ table_name: "product_recipe", row_id: "px/i9", op: "upsert", payload: { product_id: "px", item_id: "i9", quantity_milli: 500 } });
  check("receta remota entra", db.prepare("SELECT COUNT(*) n FROM product_recipe").get().n, 1);
  run({ table_name: "product_recipe", row_id: "px/i9", op: "delete", payload: null });
  check("baja con clave compuesta", db.prepare("SELECT COUNT(*) n FROM product_recipe").get().n, 0);

  // `settings` es fila única: nunca se borra ni se inserta, solo se actualiza.
  check("settings no se borra", statementFor({ table_name: "settings", row_id: "1", op: "delete", payload: null }), null);
  run({ table_name: "settings", row_id: "1", op: "upsert", payload: { restaurant_name: "Remoto", currency: "USD" } });
  const st = db.prepare("SELECT restaurant_name, COUNT(*) OVER () n FROM settings").get();
  check("settings se actualiza", st.restaurant_name, "Remoto");
  check("settings sigue teniendo una fila", st.n, 1);
}

// --- 5. Fusión de comandas: dos terminales abren la misma mesa -------------
//
// Lo que se comprueba de verdad no es que «funcione», sino que los DOS
// terminales lleguen al mismo sitio aplicando la regla por su cuenta. Si no
// convergieran, cada caja diría un total distinto al cierre.
{
  const base = join(root, "src-tauri", "migrations");
  const files = readdirSync(base).filter((f) => f.endsWith(".sql")).sort();

  /** Un terminal: su propia base, con la cuenta que abrió él. */
  function terminal(ownOrder) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    for (const f of files) db.exec(readFileSync(join(base, f), "utf8"));
    db.exec(`
      INSERT INTO tables (id, number, capacity) VALUES ('t5', 5, 4);
      INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Cerveza',100,'Bebidas');
      INSERT INTO orders (id, table_id, created_at) VALUES ('${ownOrder.id}','t5','${ownOrder.at}');
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
      VALUES ('li_${ownOrder.id}', '${ownOrder.id}', 'p1', ${ownOrder.qty}, 100, 0);
    `);
    return db;
  }

  const positional = (sql) => sql.replace(/\$\d+/g, "?");

  /** Aplica un lote como lo haría `sql_apply_remote`: fusión y luego cambios. */
  async function apply(db, changes) {
    probe = (sql, params) => db.prepare(positional(sql)).all(...params);
    const plan = await mergeStatements(changes);
    const statements = [...plan.before];
    for (const c of changes) {
      const st = statementFor(c);
      if (st) statements.push(st);
    }
    statements.push(...plan.after);
    db.exec("UPDATE sync_context SET applying = 1 WHERE id = 1");
    for (const st of statements) {
      db.prepare(positional(st.sql)).run(...st.values.map((v) => v ?? null));
    }
    db.exec("UPDATE sync_context SET applying = 0 WHERE id = 1");
  }

  const A = { id: "AAA", at: "2026-08-02 19:00:00", qty: 2 };
  const B = { id: "BBB", at: "2026-08-02 19:02:00", qty: 3 };

  const changeFor = (o) => [
    {
      table_name: "orders", row_id: o.id, op: "upsert",
      payload: { id: o.id, table_id: "t5", status: "open", tax_bp: 0, opened_by: null,
                 payment_method: null, payment_ref: null, created_at: o.at, closed_at: null },
    },
    {
      table_name: "order_items", row_id: `li_${o.id}`, op: "upsert",
      payload: { id: `li_${o.id}`, order_id: o.id, product_id: "p1", quantity: o.qty,
                 unit_price_cents: 100, tax_bp: 0, notes: null, created_at: o.at },
    },
  ];

  // Terminal A abrió la suya y recibe la de B. Terminal B, al revés.
  const dbA = terminal(A);
  const dbB = terminal(B);
  await apply(dbA, changeFor(B));
  await apply(dbB, changeFor(A));

  const state = (db) => {
    const live = db.prepare(
      `SELECT id, total_cents FROM orders
        WHERE merged_into IS NULL AND status IN ('open','sent_to_kitchen','served','billed')`,
    ).all();
    return {
      vivas: live.length,
      ganadora: live[0]?.id,
      total: live[0]?.total_cents,
      lineas: db.prepare("SELECT COUNT(*) n FROM order_items WHERE order_id = ?").get(live[0]?.id).n,
      mesa: db.prepare("SELECT status FROM tables WHERE id='t5'").get().status,
    };
  };

  const sa = state(dbA);
  const sb = state(dbB);

  check("A: queda una sola cuenta viva", sa.vivas, 1);
  check("B: queda una sola cuenta viva", sb.vivas, 1);
  check("A y B eligen la misma ganadora", sa.ganadora === sb.ganadora, true);
  check("gana la más antigua", sa.ganadora, "AAA");
  // 2 + 3 cervezas a 1,00: ninguna comanda se pierde.
  check("A: las dos líneas juntas", sa.lineas, 2);
  check("B: las dos líneas juntas", sb.lineas, 2);
  check("A: total sumado", sa.total, 500);
  check("B: total sumado", sb.total, 500);
  check("A y B cuadran", sa.total === sb.total, true);
  check("la mesa sigue ocupada", sa.mesa, "occupied");

  // La absorbida se queda a cero: si conservara su importe, el informe del día
  // contaría las mismas cervezas dos veces.
  const loser = dbA.prepare("SELECT total_cents, merged_into FROM orders WHERE id='BBB'").get();
  check("la absorbida queda a cero", loser.total_cents, 0);
  check("la absorbida apunta a la ganadora", loser.merged_into, "AAA");

  // Una línea que llega tarde, de un terminal que estuvo apagado, aterriza en
  // la cuenta que se quedó y no en la absorbida.
  await apply(dbA, [{
    table_name: "order_items", row_id: "tarde", op: "upsert",
    payload: { id: "tarde", order_id: "BBB", product_id: "p1", quantity: 1,
               unit_price_cents: 100, tax_bp: 0, notes: null, created_at: "2026-08-02 19:05:00" },
  }]);
  check("la línea tardía va a la ganadora",
    dbA.prepare("SELECT order_id FROM order_items WHERE id='tarde'").get().order_id,
    "AAA");
  check("y suma al total", dbA.prepare("SELECT total_cents FROM orders WHERE id='AAA'").get().total_cents, 600);

  // Un tercer terminal que se pone al día de cero recibe las DOS de golpe.
  const dbC = new DatabaseSync(":memory:");
  dbC.exec("PRAGMA foreign_keys = ON;");
  for (const f of files) dbC.exec(readFileSync(join(base, f), "utf8"));
  dbC.exec(`
    INSERT INTO tables (id, number, capacity) VALUES ('t5', 5, 4);
    INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Cerveza',100,'Bebidas');
  `);
  await apply(dbC, [...changeFor(A), ...changeFor(B)]);
  const sc = state(dbC);
  check("C: una sola cuenta viva", sc.vivas, 1);
  check("C: la misma ganadora", sc.ganadora, "AAA");
  check("C: el mismo total", sc.total, 500);

  // Y si aparece una cuenta AÚN más antigua, la cadena se aplana.
  const Z = { id: "ZZZ", at: "2026-08-02 18:55:00", qty: 1 };
  await apply(dbC, changeFor(Z));
  const sz = state(dbC);
  check("gana la aún más antigua", sz.ganadora, "ZZZ");
  check("todas las líneas acaban en ella", sz.lineas, 3);
  check("sin cadenas colgando",
    dbC.prepare("SELECT COUNT(*) n FROM orders WHERE merged_into IS NOT NULL AND merged_into <> 'ZZZ'").get().n,
    0);
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
