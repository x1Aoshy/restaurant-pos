/**
 * Comprueba la siembra del buzón al encender la sincronización.
 *
 * El fallo que esto vigila no daba ningún error: los triggers del buzón solo
 * escriben con `enabled = 1`, así que un local con un año de historia encendía
 * la sincronización y no subía nada. El segundo terminal arrancaba sin carta,
 * sin mesas y sin personal, y en los registros no había una sola línea rara.
 *
 * Por eso la prueba de verdad no es contar filas: es **el viaje completo**. Se
 * monta un terminal con datos y la sincronización apagada, se enciende, y lo
 * que sale del buzón se aplica a una segunda base vacía con `statementFor` —el
 * mismo camino que recorre un cambio real. Al final las dos bases tienen que
 * decir lo mismo.
 *
 *   node --experimental-sqlite scripts/check-seed.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "src-tauri", "migrations");

async function evaluate(source) {
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { statementFor, SYNCED_TABLES } = await evaluate(
  readFileSync(join(root, "src/features/sync/tables.ts"), "utf8").replace(
    /^import type .*?;$/gm,
    "",
  ),
);

// `seed.ts` lee la lista blanca del módulo de al lado. Aquí se le entrega la
// misma que acaba de cargarse, para que la prueba ejercite el código que corre
// de verdad y no una copia que puede quedarse atrás.
globalThis.__SYNCED = SYNCED_TABLES;
const { seedStatements, SEEDED_TABLES } = await evaluate(
  readFileSync(join(root, "src/features/sync/seed.ts"), "utf8")
    .replace(/^import .*?;$/gm, "")
    .replace("const WINDOW_DAYS", "const SYNCED_TABLES = globalThis.__SYNCED;\nconst WINDOW_DAYS"),
);

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`,
  );
}

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, f), "utf8"));
  }
  return db;
}

/** Un local que lleva tiempo funcionando con la sincronización APAGADA. */
function populate(db) {
  db.exec(`
    INSERT INTO staff (id, full_name, role, pin_hash)
      VALUES ('s1', 'Ana', 'admin', 'pbkdf2$210000$sal$hash');
    INSERT INTO zones (id, name) VALUES ('z1', 'Salón');
    INSERT INTO tables (id, number, capacity, zone_id)
      VALUES ('t1', 1, 4, 'z1'), ('t2', 2, 2, 'z1');
    INSERT INTO products (id, name, price_cents, category, tax_bp)
      VALUES ('p1', 'Cerveza', 5000, 'Bebidas', NULL),
             ('p2', 'Gallo pinto', 12000, 'Cocina', 1500);
    INSERT INTO inventory_items (id, name, unit) VALUES ('i1', 'Cerveza botella', 'unidad');
    INSERT INTO product_recipe (product_id, item_id, quantity_milli) VALUES ('p1', 'i1', 1000);
    INSERT INTO inventory_movements (id, item_id, quantity_milli, kind, created_by)
      VALUES ('m1', 'i1', 24000, 'purchase', 's1');
    INSERT INTO expenses (id, amount_cents, category, spent_on, created_by)
      VALUES ('e1', 30000, 'Compras', date('now'), 's1');
    UPDATE settings SET restaurant_name = 'El Buen Sabor', currency = 'NIO' WHERE id = 1;

    INSERT INTO orders (id, table_id, status, tax_bp, opened_by)
      VALUES ('o1', 't1', 'open', 1500, 's1');
    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
      VALUES ('oi1', 'o1', 'p1', 2, 5000, 1500);
  `);
  return db;
}

// ---------------------------------------------------------------------------
// 1. El punto de partida: sin siembra, el buzón está vacío
// ---------------------------------------------------------------------------
const origen = populate(fresh());

check(
  "con el sync apagado el buzón no recoge nada",
  origen.prepare("SELECT COUNT(*) n FROM sync_outbox").get().n,
  0,
);

// ---------------------------------------------------------------------------
// 2. Se enciende: la siembra vuelca lo que ya había
// ---------------------------------------------------------------------------
origen.exec("UPDATE sync_context SET enabled = 1 WHERE id = 1");
for (const st of seedStatements()) origen.exec(st.sql);
origen.exec("UPDATE sync_context SET seeded_at = datetime('now') WHERE id = 1");

const encolado = origen.prepare("SELECT COUNT(*) n FROM sync_outbox").get().n;
check("tras encender el buzón ya no está vacío", encolado > 0, true);

const porTabla = Object.fromEntries(
  origen
    .prepare("SELECT table_name, COUNT(*) n FROM sync_outbox GROUP BY table_name")
    .all()
    .map((r) => [r.table_name, r.n]),
);
check("siembra el personal", porTabla.staff, 1);
check("siembra la carta", porTabla.products, 2);
check("siembra las mesas", porTabla.tables, 2);
check("siembra los ajustes del local", porTabla.settings, 1);
check("siembra las recetas", porTabla.product_recipe, 1);
check("siembra la cuenta abierta", porTabla.orders, 1);
check("siembra sus líneas", porTabla.order_items, 1);

// ---------------------------------------------------------------------------
// 3. Lo que NO debe viajar
// ---------------------------------------------------------------------------
// El movimiento de la venta lo genera el trigger de la línea de comanda en cada
// terminal. Si además viajara, la cerveza se descontaría dos veces.
check(
  "el movimiento nacido de una venta no se siembra",
  origen
    .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name = 'inventory_movements'")
    .get().n,
  1, // solo la compra manual, no el consumo de 'oi1'
);
check(
  "y el que se siembra es el manual",
  JSON.parse(
    origen
      .prepare("SELECT payload FROM sync_outbox WHERE table_name = 'inventory_movements'")
      .get().payload,
  ).kind,
  "purchase",
);

const payloadDe = (t) =>
  JSON.parse(origen.prepare("SELECT payload FROM sync_outbox WHERE table_name = ? LIMIT 1").get(t).payload);

check("la cuenta viaja sin total_cents", "total_cents" in payloadDe("orders"), false);
check("la mesa viaja sin status", "status" in payloadDe("tables"), false);
check("el insumo viaja sin stock_milli", "stock_milli" in payloadDe("inventory_items"), false);

// La lista de columnas tiene que ser exactamente la lista blanca: de menos deja
// campos vacíos en el terminal nuevo, de más lo rechaza el filtro al recibir.
for (const t of ["staff", "products", "orders", "order_items"]) {
  check(
    `${t}: las columnas sembradas son las de la lista blanca`,
    Object.keys(payloadDe(t)).sort(),
    [...SYNCED_TABLES[t].columns].sort(),
  );
}

// ---------------------------------------------------------------------------
// 4. El viaje completo: lo sembrado se aplica en un terminal nuevo
// ---------------------------------------------------------------------------
const destino = fresh();
const positional = (sql) => sql.replace(/\$\d+/g, "?");

let aplicados = 0;
let descartados = 0;
for (const row of origen.prepare("SELECT * FROM sync_outbox ORDER BY seq").all()) {
  const st = statementFor({
    seq: row.seq,
    table_name: row.table_name,
    row_id: row.row_id,
    op: row.op,
    payload: row.payload ? JSON.parse(row.payload) : null,
  });
  if (!st) {
    descartados++;
    continue;
  }
  // Si el orden de siembra estuviera mal, una clave foránea reventaría aquí —
  // que es exactamente lo que le pasaría al terminal de verdad.
  destino.prepare(positional(st.sql)).run(...st.values.map((v) => (v === undefined ? null : v)));
  aplicados++;
}

check("el filtro no descarta nada de lo sembrado", descartados, 0);
check("se aplicó todo", aplicados, encolado);

// ---------------------------------------------------------------------------
// 5. Las dos bases dicen lo mismo
// ---------------------------------------------------------------------------
const cuenta = (db, t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
for (const t of ["staff", "zones", "tables", "products", "inventory_items", "product_recipe", "orders", "order_items", "expenses"]) {
  check(`el terminal nuevo tiene los mismos ${t}`, cuenta(destino, t), cuenta(origen, t));
}

check(
  "el nombre del local llegó",
  destino.prepare("SELECT restaurant_name FROM settings WHERE id = 1").get().restaurant_name,
  "El Buen Sabor",
);

// Lo calculado no viajó, pero el terminal nuevo llega al mismo número por su
// cuenta. Es la prueba de que la lista blanca está bien recortada.
const total = (db) => db.prepare("SELECT total_cents FROM orders WHERE id = 'o1'").get().total_cents;
check("y el total de la cuenta coincide sin haberlo recibido", total(destino), total(origen));

const stock = (db) => db.prepare("SELECT stock_milli FROM inventory_items WHERE id = 'i1'").get().stock_milli;
check("y las existencias también", stock(destino), stock(origen));

check(
  "la mesa quedó ocupada por sus propios triggers",
  destino.prepare("SELECT status FROM tables WHERE id = 't1'").get().status,
  "occupied",
);

// ---------------------------------------------------------------------------
// 6. No se siembra dos veces
// ---------------------------------------------------------------------------
check(
  "queda marcado que ya se sembró",
  origen.prepare("SELECT seeded_at IS NOT NULL AS x FROM sync_context WHERE id = 1").get().x,
  1,
);
check(
  "cada tabla se siembra una sola vez",
  SEEDED_TABLES.length,
  new Set(SEEDED_TABLES).size,
);

// ---------------------------------------------------------------------------
// 7. La siembra cubre toda la lista blanca
// ---------------------------------------------------------------------------
check(
  "no queda ninguna tabla sincronizada sin sembrar",
  Object.keys(SYNCED_TABLES).filter((t) => !SEEDED_TABLES.includes(t)),
  [],
);

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
