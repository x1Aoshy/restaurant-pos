/**
 * Comprueba el vuelto y lo que entra en el cajón.
 *
 * El vuelto se cuenta a mano, delante del cliente y con cola detrás. Si el
 * número de la pantalla está mal, nadie lo descubre por un error: se descubre
 * al cerrar la caja, cuando ya no se sabe de qué cuenta salió.
 *
 *   node --experimental-sqlite scripts/check-cash.mjs
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

const source = readFileSync(join(root, "src/features/orders/cash.ts"), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { cashSplit, cashSuggestions, notesFor, parseAmount } = await import(
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

const NIO = notesFor("NIO");
const USD = notesFor("USD");

// --- 1. Vuelto y falta nunca a la vez --------------------------------------
check("paga de más", cashSplit(38000, 50000), { changeCents: 12000, shortCents: 0 });
check("paga justo", cashSplit(38000, 38000), { changeCents: 0, shortCents: 0 });
check("paga de menos", cashSplit(38000, 30000), { changeCents: 0, shortCents: 8000 });
check("no se anotó", cashSplit(38000, null), { changeCents: 0, shortCents: 0 });
// Un vuelto negativo en pantalla haría devolver dinero que no se debe.
check(
  "nunca sale un vuelto negativo",
  [30000, 38000, 50000].every((v) => cashSplit(38000, v).changeCents >= 0),
  true,
);

// --- 1b. El importe se lee como lo teclea una persona ----------------------
// «500» son quinientos. Antes eran cinco, y el cajero veía «Falta C$495».
check("quinientos son quinientos", parseAmount("500"), 50000);
check("con decimales", parseAmount("500.50"), 50050);
check("con coma decimal", parseAmount("500,50"), 50050);
check("miles con punto y coma decimal", parseAmount("1.234,56"), 123456);
check("miles con coma y punto decimal", parseAmount("1,234.56"), 123456);
check("un decimal se completa", parseAmount("12.5"), 1250);
check("mas de dos decimales se descartan", parseAmount("10.999"), 1099);
check("cero es cero, no vacio", parseAmount("0"), 0);
check("vacio no dice nada", parseAmount(""), null);
check("solo espacios", parseAmount("   "), null);
check("basura", parseAmount("abc"), null);
check("solo la coma", parseAmount(","), null);
check("empieza por coma", parseAmount(",50"), 50);
check("espacios de miles", parseAmount("1 234"), 123400);

// --- 2. Sugerencias que alguien entregaría de verdad ------------------------
check("cuenta de C$380", cashSuggestions(38000, NIO), [40000, 50000, 100000]);
check("cuenta de C$125", cashSuggestions(12500, NIO), [15000, 20000, 50000]);
check("cuenta de C$80", cashSuggestions(8000, NIO), [10000, 20000, 50000]);
check("en dólares", cashSuggestions(1250, USD), [1500, 2000, 5000]);
// Sin esto salían 130 y 140, que nadie entrega.
check(
  "nunca por debajo de lo que se debe",
  cashSuggestions(12500, NIO).every((v) => v > 12500),
  true,
);
check("cuenta a cero no sugiere nada", cashSuggestions(0, NIO), []);

// --- 3. El cajón recibe lo que entró, no lo que decía la cuenta -------------
db.exec(`
  INSERT INTO staff (id, full_name, role, pin_hash) VALUES ('ana','Ana','cashier','x');
  INSERT INTO tables (id, number, capacity) VALUES ('t1',1,4);
  INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Plato',10000,'Comida');
  UPDATE sync_context SET device_id = 'este-equipo' WHERE id = 1;
  INSERT INTO cash_registers (id, device_id, opened_by, opening_float_cents)
  VALUES ('r1','este-equipo','ana',50000);
`);

function sale(id, { tip = 0, tendered = null }) {
  db.exec(
    `INSERT INTO orders (id, table_id, tax_bp, opened_by) VALUES ('${id}','t1',0,'ana')`,
  );
  db.exec(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
     VALUES ('${id}_l','${id}','p1',1,10000,0)`,
  );
  db.prepare(
    `UPDATE orders SET status='paid', payment_method='cash', tip_cents=?, tendered_cents=?
      WHERE id=?`,
  ).run(tip, tendered, id);
  return db
    .prepare("SELECT amount_cents FROM cash_movements WHERE order_id = ?")
    .get(id);
}

check("pagando justo entra el total", sale("o1", { tendered: 10000 }).amount_cents, 10000);
// El billete grande entra y el vuelto sale del mismo cajón: en neto, la venta.
check(
  "pagando con billete grande entra la venta, no el billete",
  sale("o2", { tendered: 50000 }).amount_cents,
  10000,
);
check(
  "con propina entra venta más propina",
  sale("o3", { tip: 2000, tendered: 20000 }).amount_cents,
  12000,
);
// Lo que de verdad se guardó. Antes entraba el total y el arqueo esperaba un
// dinero que nunca estuvo en el cajón.
check(
  "cobrando de menos entra solo lo recibido",
  sale("o4", { tendered: 7000 }).amount_cents,
  7000,
);
check(
  "sin anotar la entrega entra el total",
  sale("o5", { tendered: null }).amount_cents,
  10000,
);

const reg = db.prepare("SELECT expected_cents FROM cash_registers WHERE id='r1'").get();
check(
  "el arqueo suma el fondo y lo recibido",
  reg.expected_cents,
  50000 + 10000 + 10000 + 12000 + 7000 + 10000,
);

// --- 4. Una venta de otro terminal no toca este cajón -----------------------
db.exec("UPDATE sync_context SET applying = 1 WHERE id = 1");
sale("o6", { tendered: 50000 });
db.exec("UPDATE sync_context SET applying = 0 WHERE id = 1");
check(
  "lo que llega por sincronización no entra en el cajón de aquí",
  db.prepare("SELECT COUNT(*) AS n FROM cash_movements WHERE order_id='o6'").get().n,
  0,
);

// --- 5. La columna viaja entre terminales ----------------------------------
db.exec("UPDATE sync_context SET enabled = 1 WHERE id = 1");
sale("o7", { tendered: 20000 });
const payload = JSON.parse(
  db
    .prepare(
      "SELECT payload FROM sync_outbox WHERE table_name='orders' ORDER BY seq DESC LIMIT 1",
    )
    .get().payload,
);
check("tendered_cents va en el mensaje", payload.tendered_cents, 20000);

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
