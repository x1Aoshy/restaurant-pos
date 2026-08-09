/**
 * Comprueba el reparto de descuentos entre líneas.
 *
 * Es aritmética de centavos enteros: si la suma de las líneas no da exactamente
 * lo prometido, el ticket enseña un descuento y cobra otro. Eso lo ve el
 * cliente antes que nadie.
 *
 *   node --experimental-sqlite scripts/check-discount.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const source = readFileSync(join(root, "src/features/orders/discount.ts"), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { prorate, percentOff } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${a} (esperado ${e})`);
}

const sum = (xs) => xs.reduce((n, x) => n + x, 0);

// --- 1. Reparto exacto -----------------------------------------------------
check("reparto sencillo", prorate([1000, 1000], 200), [100, 100]);
check("proporcional al peso", prorate([3000, 1000], 400), [300, 100]);

// --- 2. El centavo que sobra tiene dueño ----------------------------------
{
  // 100 entre tres iguales: 33,33 cada una. Sobra 1.
  const d = prorate([1000, 1000, 1000], 100);
  check("tres iguales suman lo prometido", sum(d), 100);
  check("y se reparte 34/33/33", d, [34, 33, 33]);
}

{
  // Un caso feo a propósito: 7 líneas y un importe primo.
  const bases = [333, 777, 1234, 99, 4500, 61, 2020];
  const d = prorate(bases, 997);
  check("siete lineas raras suman exacto", sum(d), 997);
  check("ninguna supera su base", d.every((v, i) => v <= bases[i]), true);
  check("ninguna es negativa", d.every((v) => v >= 0), true);
}

// --- 3. Casos límite -------------------------------------------------------
check("descuento cero", prorate([1000, 500], 0), [0, 0]);
check("cuenta vacia", prorate([], 500), []);
check("todo a cero no divide entre cero", prorate([0, 0], 100), [0, 0]);
{
  // Invitar la cuenta entera: se regala todo, no se devuelve dinero.
  const bases = [1000, 500];
  check("descuento igual al total", prorate(bases, 1500), [1000, 500]);
  check("descuento mayor que el total no pasa de la base", prorate(bases, 9999), [1000, 500]);
}

// --- 4. Porcentaje ---------------------------------------------------------
check("10% linea a linea", percentOff([1000, 555], 10), [100, 56]); // 55.5 -> 56
check("100% es invitacion", percentOff([1000, 555], 100), [1000, 555]);
check("0% no toca nada", percentOff([1000, 555], 0), [0, 0]);
check("un porcentaje absurdo se recorta", percentOff([1000], 500), [1000]);

// --- 5. Determinismo: dos terminales reparten igual ------------------------
{
  const bases = [1234, 1234, 1234, 1];
  const a = prorate(bases, 500);
  const b = prorate(bases, 500);
  check("el mismo reparto dos veces", a, b);
}

// --- 6. Contra la base: el trigger tiene que dar el mismo total ------------
{
  const base = join(root, "src-tauri", "migrations");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(base).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(base, f), "utf8"));
  }
  db.exec(`
    INSERT INTO tables (id, number, capacity) VALUES ('t1',1,4);
    INSERT INTO products (id, name, price_cents, category) VALUES ('p1','X',100,'C');
    INSERT INTO orders (id, table_id, tax_bp) VALUES ('o1','t1',1500);
  `);

  // Tres líneas de 10.00 y un 10 % de descuento sobre la cuenta.
  const bases = [1000, 1000, 1000];
  bases.forEach((b, i) =>
    db.exec(
      `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
       VALUES ('l${i}','o1','p1',10,100,1500)`,
    ),
  );

  const target = 300;
  const parts = prorate(bases, target);
  parts.forEach((d, i) =>
    db.exec(`UPDATE order_items SET discount_cents = ${d} WHERE id = 'l${i}'`),
  );

  const o = db.prepare("SELECT * FROM orders WHERE id='o1'").get();
  check("la base suma el mismo descuento", o.discount_cents, target);
  check("subtotal sigue siendo bruto", o.subtotal_cents, 3000);
  // Base 2700, 15% = 405. Por línea: 900 y 900 y 900 -> 135 cada una.
  check("impuesto sobre la base rebajada", o.tax_cents, 405);
  check("total", o.total_cents, 3000 - 300 + 405);

  // Y una invitación completa deja la cuenta en cero.
  db.exec("UPDATE order_items SET discount_cents = 1000");
  const comp = db.prepare("SELECT * FROM orders WHERE id='o1'").get();
  check("invitacion total: impuesto cero", comp.tax_cents, 0);
  check("invitacion total: total cero", comp.total_cents, 0);
}

// --- 7. Descuento en una venta de mostrador -------------------------------
//
// Aquí no existe el momento en que la cuenta está abierta y se le aplica algo:
// se crea, se descuenta y se cobra de una vez. Si el descuento se escribiera
// después, la venta ya estaría pagada por el importe entero.
{
  const base = join(root, "src-tauri", "migrations");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(base).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(base, f), "utf8"));
  }
  db.exec(`
    INSERT INTO staff (id, full_name, role, pin_hash) VALUES ('jefe','Jefa','manager','x');
    INSERT INTO tables (id, number, capacity) VALUES ('mostrador', 0, 1);
    INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Cerveza',100,'B');
  `);

  // Dos líneas: 3 x 1.00 y 2 x 1.00. Un 10 % sobre las dos.
  const bases = [300, 200];
  const parts = percentOff(bases, 10);

  db.exec("BEGIN");
  db.exec("INSERT INTO orders (id, table_id, tax_bp) VALUES ('m1','mostrador',1500)");
  [3, 2].forEach((qty, i) =>
    db.exec(
      `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp, discount_cents)
       VALUES ('m1_${i}','m1','p1',${qty},100,1500,${parts[i]})`,
    ),
  );
  db.exec(
    "UPDATE orders SET discount_reason='Promoción', discount_by='jefe' WHERE id='m1'",
  );
  db.exec("UPDATE orders SET status='paid', payment_method='cash' WHERE id='m1'");
  db.exec("COMMIT");

  const o = db.prepare("SELECT * FROM orders WHERE id='m1'").get();
  check("el mostrador guarda el descuento", o.discount_cents, 50);
  check("subtotal bruto", o.subtotal_cents, 500);
  // Base 450, 15 % por línea: 270 -> 41 (40.5) y 180 -> 27. Total 68.
  check("impuesto sobre la base rebajada", o.tax_cents, 68);
  check("total cobrado", o.total_cents, 500 - 50 + 68);
  check("queda el motivo", o.discount_reason, "Promoción");
  check("y quién lo autorizó", o.discount_by, "jefe");
  check("y se cobró de una vez", o.status, "paid");
  check(
    "sin dejar la venta viva",
    db
      .prepare(
        "SELECT COUNT(*) n FROM orders WHERE table_id='mostrador' AND status='open'",
      )
      .get().n,
    0,
  );
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
