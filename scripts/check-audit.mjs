/**
 * Comprueba las consultas de la pantalla de Revisión.
 *
 * Aquí lo que falla no da error: da un número. Si una suma se queda corta,
 * alguien reparte menos propina de la que hay o no ve un descuento que sí se
 * concedió, y nada en pantalla avisa de que la cifra está mal.
 *
 *   node --experimental-sqlite scripts/check-audit.mjs
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

// `queries.ts` habla con la base por `query`/`queryOne`. Se le dan versiones
// que apuntan al SQLite de prueba para ejercitar el SQL de verdad, no una copia.
const offset = -new Date().getTimezoneOffset();
const shift = `'${offset >= 0 ? "+" : ""}${offset} minutes'`;
const source = readFileSync(join(root, "src/features/audit/queries.ts"), "utf8")
  .replace(/^import .*?;$/gm, "")
  .replace(
    "export interface AuditTotals",
    `const SHIFT_SQL = ${JSON.stringify(shift)};
     const pad = (n) => String(n).padStart(2, "0");
     const daysAgoLocal = (d) => {
       const x = new Date(); x.setDate(x.getDate() - d);
       return \`\${x.getFullYear()}-\${pad(x.getMonth() + 1)}-\${pad(x.getDate())}\`;
     };
     const positional = (sql) => sql.replace(/\\$\\d+/g, "?");
     const query = async (sql, params = []) =>
       globalThis.__db.prepare(positional(sql)).all(...params);
     const queryOne = async (sql, params = []) =>
       (await query(sql, params))[0] ?? null;
     export interface AuditTotals`,
  );
const { code } = await transform(source, { loader: "ts", format: "esm" });
globalThis.__db = db;
const q = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
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

// --- Datos ------------------------------------------------------------------
db.exec(`
  INSERT INTO staff (id, full_name, role, pin_hash) VALUES
    ('ana','Ana','waiter','x'), ('luis','Luis','waiter','x'), ('jefe','Jefa','manager','x');
  INSERT INTO tables (id, number, capacity) VALUES ('t1',1,4), ('t2',2,4), ('t3',3,4);
  INSERT INTO products (id, name, price_cents, category) VALUES ('p1','Cerveza',100,'Bebidas');
`);

/** Una cuenta cobrada hoy, con sus líneas. */
function paidOrder(id, table, staffId, lines, { tip = 0, discountBy = null, reason = null } = {}) {
  db.exec(
    `INSERT INTO orders (id, table_id, tax_bp, opened_by) VALUES ('${id}','${table}',0,'${staffId}')`,
  );
  lines.forEach((l, i) =>
    db.exec(
      `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp, discount_cents)
       VALUES ('${id}_${i}','${id}','p1',${l.qty},100,0,${l.disc ?? 0})`,
    ),
  );
  if (reason) {
    db.exec(
      `UPDATE orders SET discount_reason='${reason}', discount_by='${discountBy}' WHERE id='${id}'`,
    );
  }
  db.exec(
    `UPDATE orders SET status='paid', payment_method='cash', tip_cents=${tip},
            closed_at=datetime('now') WHERE id='${id}'`,
  );
}

paidOrder("o1", "t1", "ana", [{ qty: 5 }], { tip: 200 });
paidOrder("o2", "t2", "ana", [{ qty: 3 }], { tip: 150 });
paidOrder("o3", "t3", "luis", [{ qty: 10, disc: 300 }], {
  tip: 100,
  discountBy: "jefe",
  reason: "Cliente habitual",
});

// Una línea anulada por Luis y otra por la jefa.
db.exec(`
  INSERT INTO orders (id, table_id, tax_bp, opened_by) VALUES ('o4','t1',0,'luis');
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
  VALUES ('v1','o4','p1',2,100,0), ('v2','o4','p1',4,100,0);
  UPDATE order_items SET voided_at=datetime('now','-2 minutes'), void_reason='Devuelto', voided_by='luis' WHERE id='v1';
  UPDATE order_items SET voided_at=datetime('now'), void_reason='Error al apuntar', voided_by='jefe' WHERE id='v2';
`);

// Y algo viejo, fuera de rango: no debe contarse.
db.exec(`
  INSERT INTO orders (id, table_id, tax_bp, opened_by) VALUES ('viejo','t2',0,'ana');
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
  VALUES ('viejo_0','viejo','p1',1,100,0);
  UPDATE orders SET status='paid', tip_cents=99999,
         closed_at=datetime('now','-60 days') WHERE id='viejo';
`);

// --- 1. Totales -------------------------------------------------------------
{
  const t = await q.fetchTotals(7);
  check("propinas de la semana", t.tipCents, 450);
  check("cuentas con propina", t.tipTickets, 3);
  check("descuentos", t.discountCents, 300);
  check("cuentas con descuento", t.discountCount, 1);
  // 2 x 1.00 mas 4 x 1.00
  check("importe anulado", t.voidCents, 600);
  check("lineas anuladas", t.voidCount, 2);
}

// --- 2. Lo viejo queda fuera, lo de 90 días dentro -------------------------
{
  const semana = await q.fetchTotals(7);
  const trimestre = await q.fetchTotals(90);
  check("la propina de hace 60 días no cuenta esta semana", semana.tipCents, 450);
  check("pero sí en el trimestre", trimestre.tipCents, 450 + 99999);
}

// --- 3. Propinas por persona -----------------------------------------------
{
  const rows = await q.fetchTipsByStaff(7);
  check("dos personas con propina", rows.length, 2);
  check("la primera es la que más lleva", rows[0].name, "Ana");
  check("y suma sus dos cuentas", rows[0].tips, 350);
  check("con el número de cuentas", rows[0].tickets, 2);
  check("la segunda", [rows[1].name, rows[1].tips], ["Luis", 100]);
  check("el reparto suma el total", rows.reduce((n, r) => n + r.tips, 0), 450);
}

// --- 4. Descuentos: con quién y por qué ------------------------------------
{
  const rows = await q.fetchDiscounts(7);
  check("un descuento", rows.length, 1);
  check("en su mesa", rows[0].table_number, 3);
  check("con el importe", rows[0].discount_cents, 300);
  check("con el motivo", rows[0].discount_reason, "Cliente habitual");
  // Lo que hace que esto sea una auditoría y no una lista.
  check("y con quién lo autorizó", rows[0].by_name, "Jefa");
}

// --- 5. Anulaciones ---------------------------------------------------------
{
  const rows = await q.fetchVoids(7);
  check("dos anulaciones", rows.length, 2);
  check("la más reciente primero", rows[0].id, "v2");
  check("con producto", rows[0].product_name, "Cerveza");
  check("con motivo", rows[0].void_reason, "Error al apuntar");
  check("con quién", rows[0].by_name, "Jefa");
  check("y el importe de lo que se quitó", rows[0].amount_cents, 400);

  const byStaff = await q.fetchVoidsByStaff(7);
  check("dos personas anulando", byStaff.length, 2);
  check("primero quien más importe quita", byStaff[0].name, "Jefa");
  check("con su cuenta", [byStaff[0].n, byStaff[0].cents], [1, 400]);
  check(
    "el desglose suma el total",
    byStaff.reduce((n, r) => n + r.cents, 0),
    600,
  );
}

// --- 6. Sin rastro de quién, no se inventa ---------------------------------
{
  db.exec(`
    INSERT INTO orders (id, table_id, tax_bp) VALUES ('anon','t2',0);
    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_bp)
    VALUES ('anon_0','anon','p1',1,100,0);
    UPDATE order_items SET voided_at=datetime('now') WHERE id='anon_0';
  `);
  const rows = await q.fetchVoids(7);
  const anon = rows.find((r) => r.id === "anon_0");
  check("sin firma, el nombre es nulo", anon.by_name, null);
  check("sin motivo, el motivo es nulo", anon.void_reason, null);
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
