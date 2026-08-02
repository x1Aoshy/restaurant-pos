/**
 * Comprueba los triggers del esquema local contra un SQLite de verdad.
 *
 * El inventario se lleva por triggers, y un trigger que descuenta de menos no
 * da error: solo hace que el recuento del día mienta. Estas comprobaciones
 * existen porque exactamente eso ya pasó una vez.
 *
 *   node --experimental-sqlite scripts/check-schema.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "migrations");

// Todas las migraciones que haya, en orden de número. Listarlas a mano hacía
// que una nueva quedara sin comprobar hasta que alguien se acordara.
const FILES = readdirSync(base)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const read = (f) => readFileSync(join(base, f), "utf8");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${actual} (esperado ${expected})`);
}

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of FILES) db.exec(read(f));
  db.exec(`
    INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4);
    INSERT INTO products (id, name, price_cents, category) VALUES ('p1', 'Coca-Cola', 150, 'Bebidas');
    INSERT INTO products (id, name, price_cents, category) VALUES ('p2', 'Cuba libre', 400, 'Tragos');
    INSERT INTO inventory_items (id, name, unit) VALUES ('i1', 'Coca-Cola', 'unidad');
    INSERT INTO inventory_movements (id, item_id, quantity_milli, kind) VALUES ('m0', 'i1', 24000, 'initial');
    INSERT INTO product_recipe (product_id, item_id, quantity_milli) VALUES ('p1', 'i1', 1000);
    INSERT INTO product_recipe (product_id, item_id, quantity_milli) VALUES ('p2', 'i1', 500);
    INSERT INTO orders (id, table_id) VALUES ('o1', 't1');
  `);
  db.stock = () =>
    db.prepare("SELECT stock_milli s FROM inventory_items WHERE id='i1'").get().s / 1000;
  return db;
}

const line = (db, id, product, qty) =>
  db.exec(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
     VALUES ('${id}', 'o1', '${product}', ${qty}, 150, 0)`,
  );

// --- 1. Venta simple --------------------------------------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 1);
  check("vender 1", db.stock(), 23);
}

// --- 2. Corregir la cantidad hacia arriba (el bug original) -----------------
{
  const db = fresh();
  line(db, "l1", "p1", 1);
  db.exec("UPDATE order_items SET quantity = 3 WHERE id='l1'");
  check("corregir 1 -> 3", db.stock(), 21);
}

// --- 3. Corregir hacia abajo ------------------------------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 5);
  db.exec("UPDATE order_items SET quantity = 2 WHERE id='l1'");
  check("corregir 5 -> 2", db.stock(), 22);
}

// --- 4. Borrar una línea corregida devuelve lo justo ------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 1);
  db.exec("UPDATE order_items SET quantity = 3 WHERE id='l1'");
  db.exec("DELETE FROM order_items WHERE id='l1'");
  check("borrar la línea", db.stock(), 24);
}

// --- 5. Borrar la cuenta entera (CASCADE) ----------------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 1);
  db.exec("UPDATE order_items SET quantity = 3 WHERE id='l1'");
  db.exec("DELETE FROM orders WHERE id='o1'");
  check("borrar la cuenta", db.stock(), 24);
}

// --- 6. Anular la cuenta devuelve las existencias --------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 3);
  db.exec("UPDATE orders SET status='cancelled' WHERE id='o1'");
  check("anular la cuenta", db.stock(), 24);
}

// --- 7. Anular y DESPUÉS borrar no acredita dos veces ----------------------
{
  const db = fresh();
  line(db, "l1", "p1", 3);
  db.exec("UPDATE orders SET status='cancelled' WHERE id='o1'");
  db.exec("DELETE FROM orders WHERE id='o1'");
  check("anular y luego borrar", db.stock(), 24);
}

// --- 8. Dos líneas distintas que gastan el mismo insumo --------------------
{
  const db = fresh();
  line(db, "l1", "p1", 2); // 2 x 1 unidad  = 2
  line(db, "l2", "p2", 4); // 4 x 0,5 unidad = 2
  check("dos líneas, mismo insumo", db.stock(), 20);
  db.exec("DELETE FROM order_items WHERE id='l1'");
  check("borrar solo una de las dos", db.stock(), 22);
}

// --- 9. Producto sin receta no toca el inventario --------------------------
{
  const db = fresh();
  db.exec(
    "INSERT INTO products (id, name, price_cents, category) VALUES ('p3','Ceviche',800,'Cocina')",
  );
  line(db, "l1", "p3", 5);
  check("producto sin receta", db.stock(), 24);
}

// --- 10. Cobrar no debe mover nada -----------------------------------------
{
  const db = fresh();
  line(db, "l1", "p1", 2);
  db.exec("UPDATE orders SET status='billed' WHERE id='o1'");
  db.exec(
    "UPDATE orders SET status='paid', payment_method='cash' WHERE id='o1'",
  );
  check("cobrar la cuenta", db.stock(), 22);
}

// --- 11. El total de la cuenta sigue cuadrando tras corregir cantidad ------
{
  const db = fresh();
  db.exec("UPDATE settings SET default_tax_bp = 1500 WHERE id = 1");
  db.exec(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
     VALUES ('l1','o1','p1',1,150,1500)`,
  );
  db.exec("UPDATE order_items SET quantity = 3 WHERE id='l1'");
  const o = db.prepare("SELECT * FROM orders WHERE id='o1'").get();
  check("subtotal 3 x 1.50", o.subtotal_cents, 450);
  check("impuesto 15%", o.tax_cents, 68); // round(450 * 0.15) = 67.5 -> 68
  check("total", o.total_cents, 518);
}

// --- 12. Una instalación nueva arranca en inglés ---------------------------
{
  const db = fresh();
  const s = db.prepare("SELECT language, currency FROM settings WHERE id=1").get();
  check("idioma de partida", s.language, "en");
  // Córdobas por defecto: el local está en Nicaragua. El idioma y la moneda
  // son decisiones separadas a propósito.
  check("moneda de partida", s.currency, "NIO");
}

// --- 13. El PIN admite de 4 a 8 cifras ------------------------------------
{
  const re = /^\d{4,8}$/;
  check("PIN de 3 cifras", re.test("123"), false);
  check("PIN de 4 cifras", re.test("1234"), true);
  check("PIN de 6 cifras", re.test("123456"), true);
  check("PIN de 8 cifras", re.test("12345678"), true);
  check("PIN de 9 cifras", re.test("123456789"), false);
}

// --- 14. El buzón de sincronización ---------------------------------------
{
  const outbox = (db) =>
    db.prepare("SELECT COUNT(*) n FROM sync_outbox").get().n;

  // Apagado por defecto: quien usa un solo equipo no paga nada por esto.
  {
    const db = fresh();
    line(db, "l1", "p1", 2);
    db.exec("INSERT INTO expenses (id, amount_cents, spent_on) VALUES ('e1', 500, '2026-08-02')");
    check("apagado no encola", outbox(db), 0);
  }

  // Encendido: la línea de comanda y el gasto sí viajan.
  {
    const db = fresh();
    db.exec("UPDATE sync_context SET enabled = 1");
    line(db, "l1", "p1", 2);
    db.exec("INSERT INTO expenses (id, amount_cents, spent_on) VALUES ('e1', 500, '2026-08-02')");
    const rows = db.prepare("SELECT table_name, op FROM sync_outbox ORDER BY seq").all();
    check("encendido encola la línea", rows.some((r) => r.table_name === "order_items"), true);
    check("encendido encola el gasto", rows.some((r) => r.table_name === "expenses"), true);
  }

  // Lo calculado no viaja: el movimiento de inventario de una venta lo genera
  // cada terminal al recibir la línea. Encolarlo descontaría dos veces.
  {
    const db = fresh();
    db.exec("UPDATE sync_context SET enabled = 1");
    line(db, "l1", "p1", 2);
    const kinds = db
      .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name = 'inventory_movements'")
      .get().n;
    check("la venta no encola inventario", kinds, 0);

    // El movimiento manual sí.
    db.exec(
      "INSERT INTO inventory_movements (id, item_id, quantity_milli, kind) VALUES ('mm', 'i1', 6000, 'purchase')",
    );
    const manual = db
      .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name = 'inventory_movements'")
      .get().n;
    check("la compra sí encola", manual, 1);
  }

  // El estado de la mesa tampoco: lo deduce cada equipo de sus cuentas.
  {
    const db = fresh();
    db.exec("UPDATE sync_context SET enabled = 1");
    line(db, "l1", "p1", 1);
    db.exec("UPDATE orders SET status = 'paid' WHERE id = 'o1'");
    const tables = db
      .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name = 'tables'")
      .get().n;
    check("el estado de mesa no encola", tables, 0);
  }

  // Aplicar lo que llega de otro equipo no devuelve el eco.
  {
    const db = fresh();
    db.exec("UPDATE sync_context SET enabled = 1");
    db.exec("UPDATE sync_context SET applying = 1");
    db.exec(
      "INSERT INTO products (id, name, price_cents, category) VALUES ('remoto', 'Ceviche', 800, 'Cocina')",
    );
    db.exec("UPDATE sync_context SET applying = 0");
    check("aplicar no hace eco", outbox(db), 0);

    // Y con la bandera baja vuelve a encolar con normalidad.
    db.exec(
      "INSERT INTO products (id, name, price_cents, category) VALUES ('local', 'Tostones', 300, 'Cocina')",
    );
    check("tras aplicar sigue encolando", outbox(db), 1);
  }

  // El JSON tiene que ser JSON, y sin las columnas calculadas.
  {
    const db = fresh();
    db.exec("UPDATE sync_context SET enabled = 1");
    db.exec(
      "INSERT INTO products (id, name, price_cents, category) VALUES ('px', 'Ron', 250, 'Tragos')",
    );
    const raw = db
      .prepare("SELECT payload FROM sync_outbox WHERE table_name = 'products'")
      .get().payload;
    const parsed = JSON.parse(raw);
    check("el payload es JSON válido", parsed.name, "Ron");

    // `o1` nace en fresh(), antes de encender: se provoca un cambio suyo para
    // que pase por el buzón.
    line(db, "l1", "p1", 1);
    db.exec("UPDATE orders SET status = 'served' WHERE id = 'o1'");
    const order = JSON.parse(
      db
        .prepare("SELECT payload FROM sync_outbox WHERE table_name='orders' ORDER BY seq DESC")
        .get().payload,
    );
    check("la cuenta viaja sin totales", "total_cents" in order, false);
    check("la cuenta viaja con su estado", order.status, "served");
  }

  // Cada equipo se identifica con algo distinto.
  {
    const a = fresh().prepare("SELECT device_id FROM sync_context").get().device_id;
    const b = fresh().prepare("SELECT device_id FROM sync_context").get().device_id;
    check("el identificador de equipo tiene 32 cifras", a.length, 32);
    check("dos equipos no lo comparten", a === b, false);
  }
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
