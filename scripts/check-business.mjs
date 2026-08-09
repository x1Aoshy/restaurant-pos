/**
 * Comprueba la lógica de negocio de la 008: propinas, descuentos, anulaciones,
 * turnos de caja y enrutado de impresoras.
 *
 * Todo esto lo calculan triggers, y un trigger que suma mal no da error: solo
 * hace que la caja no cuadre al cierre. Por eso se ejecuta contra un SQLite de
 * verdad y no se da por bueno leyendo el SQL.
 *
 *   node --experimental-sqlite scripts/check-business.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "migrations",
);
const FILES = readdirSync(base).filter((f) => f.endsWith(".sql")).sort();

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`,
  );
}

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of FILES) db.exec(readFileSync(join(base, f), "utf8"));
  db.exec(`
    INSERT INTO staff (id, full_name, role, pin_hash) VALUES ('s1','Ana','manager','x');
    INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4);
    INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Cerveza',150,'Bebidas');
    INSERT INTO inventory_items (id, name, unit) VALUES ('i1','Cerveza','unidad');
    INSERT INTO inventory_movements (id, item_id, quantity_milli, kind) VALUES ('m0','i1',24000,'initial');
    INSERT INTO product_recipe (product_id, item_id, quantity_milli) VALUES ('p1','i1',1000);
    INSERT INTO orders (id, table_id, tax_bp) VALUES ('o1','t1',1500);
  `);
  db.order = () => db.prepare("SELECT * FROM orders WHERE id='o1'").get();
  db.stock = () =>
    db.prepare("SELECT stock_milli s FROM inventory_items WHERE id='i1'").get().s / 1000;
  return db;
}

const line = (db, id, qty, discount = 0) =>
  db.exec(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp, discount_cents)
     VALUES ('${id}','o1','p1',${qty},150,1500,${discount})`,
  );

// --- 1. Sin novedades, los números son los de siempre ----------------------
{
  const db = fresh();
  line(db, "l1", 3);
  const o = db.order();
  check("subtotal 3 x 1.50", o.subtotal_cents, 450);
  check("impuesto 15%", o.tax_cents, 68); // round(450 * 0.15) = 67.5 -> 68
  check("total sin descuento", o.total_cents, 518);
  check("descuento en cero", o.discount_cents, 0);
  check("propina en cero", o.tip_cents, 0);
}

// --- 2. La propina no toca el total ----------------------------------------
{
  const db = fresh();
  line(db, "l1", 3);
  db.exec("UPDATE orders SET tip_cents = 100 WHERE id='o1'");
  const o = db.order();
  check("el total NO incluye propina", o.total_cents, 518);
  check("la propina se guarda aparte", o.tip_cents, 100);
  check("lo cobrado es total + propina", o.total_cents + o.tip_cents, 618);
}

// --- 3. El descuento baja la base imponible --------------------------------
{
  const db = fresh();
  line(db, "l1", 3, 50); // base 450 - 50 = 400
  const o = db.order();
  check("subtotal sigue siendo bruto", o.subtotal_cents, 450);
  check("descuento sumado en la cuenta", o.discount_cents, 50);
  check("impuesto sobre la base rebajada", o.tax_cents, 60); // round(400 * 0.15)
  check("total = bruto - descuento + impuesto", o.total_cents, 460);
}

// --- 4. Varias líneas, descuento solo en una -------------------------------
{
  const db = fresh();
  line(db, "l1", 2, 0); // 300, imp 45
  line(db, "l2", 2, 100); // 300 - 100 = 200, imp 30
  const o = db.order();
  check("subtotal de las dos", o.subtotal_cents, 600);
  check("descuento total", o.discount_cents, 100);
  check("impuesto por línea, no global", o.tax_cents, 75);
  check("total", o.total_cents, 575);
}

// --- 5. Anular saca la línea de los totales y devuelve las existencias -----
{
  const db = fresh();
  line(db, "l1", 2);
  line(db, "l2", 3);
  check("stock tras vender 5", db.stock(), 19);
  check("total con las dos", db.order().total_cents, 863);

  db.exec(
    `UPDATE order_items SET voided_at = datetime('now'), void_reason = 'se cayó',
            voided_by = 's1' WHERE id = 'l2'`,
  );
  const o = db.order();
  check("la anulada no cuenta en el subtotal", o.subtotal_cents, 300);
  check("la anulada no cuenta en el impuesto", o.tax_cents, 45);
  check("total tras anular", o.total_cents, 345);
  check("las existencias vuelven", db.stock(), 22);
  check(
    "queda el rastro de quién y por qué",
    db.prepare("SELECT void_reason FROM order_items WHERE id='l2'").get().void_reason,
    "se cayó",
  );

  // Volver a marcarla no devuelve dos veces.
  db.exec("UPDATE order_items SET void_reason = 'otra nota' WHERE id='l2'");
  check("re-tocar una anulada no duplica la devolución", db.stock(), 22);
}

// --- 6. Turno de caja: apertura, venta, retirada y arqueo ------------------
{
  const db = fresh();
  const device = db.prepare("SELECT device_id d FROM sync_context WHERE id=1").get().d;

  db.exec(
    `INSERT INTO cash_registers (id, device_id, opened_by, opening_float_cents)
     VALUES ('r1','${device}','s1', 50000)`,
  );

  line(db, "l1", 3);
  db.exec("UPDATE orders SET tip_cents = 82 WHERE id='o1'");
  db.exec("UPDATE orders SET status='billed' WHERE id='o1'");
  db.exec("UPDATE orders SET status='paid', payment_method='cash' WHERE id='o1'");

  const movs = db.prepare("SELECT kind, amount_cents FROM cash_movements").all();
  check("cobrar en efectivo apunta solo", movs.length, 1);
  check("entra el total más la propina", movs[0]?.amount_cents, 600); // 518 + 82

  db.exec(
    `INSERT INTO cash_movements (id, register_id, kind, amount_cents, note, created_by)
     VALUES ('cm2','r1','drop',-20000,'a la caja fuerte','s1')`,
  );

  let r = db.prepare("SELECT * FROM cash_registers WHERE id='r1'").get();
  check("esperado = fondo + ventas - retiradas", r.expected_cents, 30600);

  // Se cuenta a mano y falta un billete de 100.
  db.exec("UPDATE cash_registers SET counted_cents = 30500 WHERE id='r1'");
  r = db.prepare("SELECT * FROM cash_registers WHERE id='r1'").get();
  check("el descuadre sale solo", r.difference_cents, -100);

  db.exec(
    `UPDATE cash_registers SET status='closed', closed_at=datetime('now'), closed_by='s1'
      WHERE id='r1'`,
  );
  check(
    "cerrado",
    db.prepare("SELECT status FROM cash_registers WHERE id='r1'").get().status,
    "closed",
  );

  // Y ahora sí se puede abrir otro turno en el mismo equipo.
  db.exec(
    `INSERT INTO cash_registers (id, device_id, opened_by, opening_float_cents)
     VALUES ('r2','${device}','s1', 50000)`,
  );
  check("un turno nuevo tras cerrar", true, true);
}

// --- 7. Un solo turno abierto por equipo -----------------------------------
{
  const db = fresh();
  const device = db.prepare("SELECT device_id d FROM sync_context WHERE id=1").get().d;
  db.exec(`INSERT INTO cash_registers (id, device_id) VALUES ('r1','${device}')`);
  let blocked = false;
  try {
    db.exec(`INSERT INTO cash_registers (id, device_id) VALUES ('r2','${device}')`);
  } catch {
    blocked = true;
  }
  check("dos cajas abiertas a la vez: rechazado", blocked, true);
  // Otro equipo sí puede tener la suya.
  db.exec(`INSERT INTO cash_registers (id, device_id) VALUES ('r3','otro-equipo')`);
  check("cada equipo tiene su cajón", true, true);
}

// --- 8. Una venta que llega de otro terminal NO toca este cajón ------------
{
  const db = fresh();
  const device = db.prepare("SELECT device_id d FROM sync_context WHERE id=1").get().d;
  db.exec(`INSERT INTO cash_registers (id, device_id) VALUES ('r1','${device}')`);
  line(db, "l1", 3);

  db.exec("UPDATE sync_context SET applying = 1 WHERE id=1");
  db.exec("UPDATE orders SET status='paid', payment_method='cash' WHERE id='o1'");
  db.exec("UPDATE sync_context SET applying = 0 WHERE id=1");

  check(
    "el dinero de otro puesto no entra aquí",
    db.prepare("SELECT COUNT(*) n FROM cash_movements").get().n,
    0,
  );
}

// --- 9. Cobrar sin caja abierta no falla -----------------------------------
{
  const db = fresh();
  line(db, "l1", 3);
  db.exec("UPDATE orders SET status='paid', payment_method='cash' WHERE id='o1'");
  check(
    "sin turno abierto se cobra igual",
    db.prepare("SELECT status FROM orders WHERE id='o1'").get().status,
    "paid",
  );
  check(
    "y no se apunta nada",
    db.prepare("SELECT COUNT(*) n FROM cash_movements").get().n,
    0,
  );
}

// --- 10. Enrutado de impresoras --------------------------------------------
{
  const db = fresh();
  db.exec(`
    INSERT INTO zones (id, name) VALUES ('z1','Planta 1'), ('z2','Planta 2');
    INSERT INTO printers (id, name, address) VALUES
      ('pr_bar1','Barra 1','192.168.1.50'),
      ('pr_bar2','Barra 2','192.168.1.51'),
      ('pr_coc','Cocina','192.168.1.60');
    INSERT INTO printer_routing (id, zone_id, print_group, printer_id) VALUES
      ('rt1','z1','drinks','pr_bar1'),
      ('rt2','z2','drinks','pr_bar2'),
      ('rt3', NULL,'hot_food','pr_coc');
    UPDATE tables SET zone_id = 'z2' WHERE id = 't1';
    UPDATE products SET print_group = 'drinks' WHERE id = 'p1';
  `);

  // La consulta que hará el adaptador: por zona de la mesa, con reserva.
  const route = (zone, group) =>
    db
      .prepare(
        `SELECT p.name FROM printer_routing r
           JOIN printers p ON p.id = r.printer_id
          WHERE r.print_group = ?
            AND (r.zone_id = ? OR r.zone_id IS NULL)
            AND p.active = 1
          ORDER BY r.zone_id IS NULL
          LIMIT 1`,
      )
      .get(group, zone);

  check("bebidas de planta 1", route("z1", "drinks")?.name, "Barra 1");
  check("bebidas de planta 2", route("z2", "drinks")?.name, "Barra 2");
  check("comida cae en la regla de reserva", route("z1", "hot_food")?.name, "Cocina");
  check("sin regla no hay impresora", route("z1", "postres"), undefined);

  let dup = false;
  try {
    db.exec(
      "INSERT INTO printer_routing (id, zone_id, print_group, printer_id) VALUES ('rt4','z1','drinks','pr_bar2')",
    );
  } catch {
    dup = true;
  }
  check("una sola regla por zona y grupo", dup, true);

  let dupNull = false;
  try {
    db.exec(
      "INSERT INTO printer_routing (id, zone_id, print_group, printer_id) VALUES ('rt5',NULL,'hot_food','pr_bar1')",
    );
  } catch {
    dupNull = true;
  }
  check("tampoco dos reglas de reserva iguales", dupNull, true);

  // Borrar una impresora se lleva sus reglas.
  db.exec("DELETE FROM printers WHERE id='pr_bar1'");
  check(
    "las reglas huérfanas se limpian",
    db.prepare("SELECT COUNT(*) n FROM printer_routing WHERE printer_id='pr_bar1'").get().n,
    0,
  );

  // La mesa dice a qué planta va el pedido.
  check(
    "la mesa conoce su zona",
    db.prepare("SELECT zone_id FROM tables WHERE id='t1'").get().zone_id,
    "z2",
  );
}

// --- 11. La sincronización sigue coherente ---------------------------------
{
  const db = fresh();
  db.exec("UPDATE sync_context SET enabled = 1 WHERE id=1");
  const device = db.prepare("SELECT device_id d FROM sync_context WHERE id=1").get().d;
  db.exec(`INSERT INTO cash_registers (id, device_id) VALUES ('r1','${device}')`);
  line(db, "l1", 2, 30);
  db.exec("UPDATE orders SET tip_cents = 50 WHERE id='o1'");

  const rows = db.prepare("SELECT table_name, payload FROM sync_outbox ORDER BY seq").all();
  const names = rows.map((r) => r.table_name);
  check("la caja viaja", names.includes("cash_registers"), true);

  const item = JSON.parse(rows.find((r) => r.table_name === "order_items").payload);
  check("la línea lleva su descuento", item.discount_cents, 30);
  check("y su marca de anulación", "voided_at" in item, true);

  const order = JSON.parse(
    rows.filter((r) => r.table_name === "orders").pop().payload,
  );
  check("la cuenta lleva la propina", order.tip_cents, 50);
  check("la cuenta NO lleva totales", "total_cents" in order, false);
  check("ni el descuento calculado", "discount_cents" in order, false);
}

// --- 12. Anular deja rastro y rehace el descuento --------------------------
{
  const db = fresh();
  line(db, "l1", 2, 40);
  line(db, "l2", 3);
  check("descuento antes de anular", db.order().discount_cents, 40);

  // Se anula justo la línea que llevaba el descuento.
  db.exec(
    `UPDATE order_items SET voided_at = datetime('now'), void_reason = 'devuelto',
            voided_by = 's1' WHERE id = 'l1'`,
  );
  const o = db.order();
  check("el descuento de la anulada desaparece", o.discount_cents, 0);
  check("subtotal solo con la viva", o.subtotal_cents, 450);
  check("total sin la anulada", o.total_cents, 518);

  const dead = db.prepare("SELECT * FROM order_items WHERE id='l1'").get();
  check("la línea sigue existiendo", dead.id, "l1");
  check("con su motivo", dead.void_reason, "devuelto");
  check("y con quién la anuló", dead.voided_by, "s1");
}

// --- 13. Venta de mostrador: se crea y se cobra sin ocupar mesa ------------
//
// El índice de una cuenta viva por mesa es lo que hace esto delicado: si la
// venta quedara abierta un instante, la siguiente chocaría contra ella.
{
  const db = fresh();
  db.exec("INSERT INTO tables (id, number, capacity) VALUES ('mostrador', 0, 1)");

  const sale = (id, qty) => {
    db.exec("BEGIN");
    db.exec(`INSERT INTO orders (id, table_id, tax_bp) VALUES ('${id}','mostrador',0)`);
    db.exec(
      `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
       VALUES ('${id}_l','${id}','p1',${qty},150,0)`,
    );
    db.exec(`UPDATE orders SET status='paid', payment_method='cash' WHERE id='${id}'`);
    db.exec("COMMIT");
  };

  sale("c1", 2);
  sale("c2", 3);
  sale("c3", 1);

  check(
    "tres ventas de mostrador seguidas",
    db.prepare("SELECT COUNT(*) n FROM orders WHERE table_id='mostrador'").get().n,
    3,
  );
  check(
    "ninguna queda viva bloqueando la siguiente",
    db
      .prepare(
        `SELECT COUNT(*) n FROM orders
          WHERE table_id='mostrador' AND status IN ('open','billed')
            AND merged_into IS NULL`,
      )
      .get().n,
    0,
  );
  check(
    "el mostrador queda libre",
    db.prepare("SELECT status FROM tables WHERE id='mostrador'").get().status,
    "available",
  );
  check("y descuentan inventario como cualquier venta", db.stock(), 24 - 6);
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
