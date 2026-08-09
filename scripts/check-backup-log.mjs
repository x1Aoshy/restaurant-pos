/**
 * Comprueba el registro de copias y lo que implica copiar al cerrar.
 *
 * La copia del cierre es la que más vale —se lleva el día entero, cuadrado— y
 * también la que más se interrumpe: alguien apaga por el interruptor, o pulsa
 * «cerrar sin copiar». Lo que se vigila aquí es que ninguna de esas dos cosas
 * deje rastro engañoso:
 *
 *   - una copia a medias NO debe parecer una copia buena;
 *   - un intento que no terminó tiene que quedar visible, no desaparecer.
 *
 *   node --experimental-sqlite scripts/check-backup-log.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "src-tauri", "migrations");

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

// ---------------------------------------------------------------------------
// 1. La tabla existe y acepta lo que la aplicación escribe
// ---------------------------------------------------------------------------
const db = fresh();

db.exec(`INSERT INTO backup_log (reason) VALUES ('shutdown')`);
const abierta = db.prepare("SELECT * FROM backup_log ORDER BY id DESC LIMIT 1").get();
check("una entrada nueva nace sin terminar", abierta.outcome, "running");
check("y con hora de inicio", abierta.started_at !== null, true);
check("y sin hora de fin", abierta.finished_at, null);

db.exec(`
  UPDATE backup_log SET finished_at = datetime('now'), outcome = 'ok',
         path = 'D:\\resp\\pos-20260809-230000.db', bytes = 4194304, pruned = 1
   WHERE id = ${abierta.id}`);
const cerrada = db.prepare("SELECT * FROM backup_log WHERE id = ?").get(abierta.id);
check("al terminar queda en 'ok'", cerrada.outcome, "ok");
check("con su tamaño", cerrada.bytes, 4194304);

// ---------------------------------------------------------------------------
// 2. Los estados y motivos están acotados
// ---------------------------------------------------------------------------
for (const bad of ["done", "", "OK"]) {
  let rejected = false;
  try {
    db.exec(`INSERT INTO backup_log (reason, outcome) VALUES ('manual', '${bad}')`);
  } catch {
    rejected = true;
  }
  check(`rechaza el resultado «${bad}»`, rejected, true);
}
let badReason = false;
try {
  db.exec(`INSERT INTO backup_log (reason) VALUES ('cron')`);
} catch {
  badReason = true;
}
check("rechaza un motivo inventado", badReason, true);

for (const r of ["scheduled", "manual", "shutdown"]) {
  db.exec(`INSERT INTO backup_log (reason) VALUES ('${r}')`);
}
check(
  "acepta los tres motivos de la aplicación",
  db.prepare("SELECT COUNT(DISTINCT reason) n FROM backup_log").get().n,
  3,
);

// ---------------------------------------------------------------------------
// 3. Un cierre a mitad deja la fila «sin terminar», no la borra
//
// Es la información que de verdad hace falta: alguien apagó el equipo mientras
// se copiaba. Si la fila desapareciera, el historial diría que esa noche no se
// intentó nada.
// ---------------------------------------------------------------------------
db.exec(`INSERT INTO backup_log (reason) VALUES ('shutdown')`);
const interrumpida = db.prepare("SELECT MAX(id) id FROM backup_log").get().id;
// (aquí moriría el proceso: nadie llama al UPDATE de cierre)
const sobrevive = db.prepare("SELECT outcome FROM backup_log WHERE id = ?").get(interrumpida);
check("la copia interrumpida queda anotada", sobrevive.outcome, "running");

// ---------------------------------------------------------------------------
// 4. El recorte conserva las últimas y no vacía la tabla
// ---------------------------------------------------------------------------
{
  const d = fresh();
  for (let i = 0; i < 250; i++) {
    d.exec(`INSERT INTO backup_log (reason, outcome) VALUES ('scheduled', 'ok')`);
  }
  const KEEP = 200;
  d.exec(`DELETE FROM backup_log WHERE id <= (SELECT MAX(id) - ${KEEP} FROM backup_log)`);
  check("se conservan las últimas 200", d.prepare("SELECT COUNT(*) n FROM backup_log").get().n, KEEP);
  check(
    "y la última sigue siendo la última",
    d.prepare("SELECT MAX(id) n FROM backup_log").get().n,
    250,
  );
  // Con menos filas que el tope no debe borrarse nada: `MAX(id) - 200` es
  // negativo y la comparación no debe llevarse la tabla por delante.
  const e = fresh();
  e.exec(`INSERT INTO backup_log (reason) VALUES ('manual')`);
  e.exec(`DELETE FROM backup_log WHERE id <= (SELECT MAX(id) - ${KEEP} FROM backup_log)`);
  check("con pocas filas no borra nada", e.prepare("SELECT COUNT(*) n FROM backup_log").get().n, 1);
}

// ---------------------------------------------------------------------------
// 5. El registro NO se sincroniza
//
// Es de este equipo: la carpeta de destino y lo que copió esta máquina no le
// sirven de nada a la otra.
// ---------------------------------------------------------------------------
{
  const d = fresh();
  d.exec("UPDATE sync_context SET enabled = 1 WHERE id = 1");
  d.exec(`INSERT INTO backup_log (reason) VALUES ('shutdown')`);
  check(
    "una entrada del registro no encola nada",
    d.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name = 'backup_log'").get().n,
    0,
  );
}

// ---------------------------------------------------------------------------
// 6. La migración siembra el registro con la última copia conocida
//
// Un equipo que llevaba semanas copiando bien no debe estrenar la pantalla
// vacía, como si nunca hubiera copiado.
// ---------------------------------------------------------------------------
{
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON;");
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (f.startsWith("014")) {
      // Justo antes de la 014: el equipo ya venía copiando.
      d.exec(`UPDATE backups SET enabled = 1, folder = 'D:\\resp',
                     last_at = '2026-08-01 06:00:00',
                     last_path = 'D:\\resp\\pos-20260801-060000.db' WHERE id = 1`);
    }
    d.exec(readFileSync(join(migrations, f), "utf8"));
  }
  const seeded = d.prepare("SELECT * FROM backup_log").all();
  check("la migración arrastra la última copia conocida", seeded.length, 1);
  check("y la da por buena", seeded[0]?.outcome, "ok");
  check("con su ruta", seeded[0]?.path, "D:\\resp\\pos-20260801-060000.db");

  // Y en un equipo que nunca copió, el registro nace vacío en vez de inventarse
  // una copia que no existe.
  const limpia = fresh();
  check(
    "sin copias previas no se inventa ninguna",
    limpia.prepare("SELECT COUNT(*) n FROM backup_log").get().n,
    0,
  );
}

// ---------------------------------------------------------------------------
// 7. Un fichero a medias no se cuenta como copia
//
// `backup.rs` escribe en `.part` y renombra al terminar. Se comprueba aquí el
// criterio que usa `is_backup` —prefijo `pos-` y extensión `.db`— porque es lo
// que decide qué se conserva y qué se enseña como copia disponible.
// ---------------------------------------------------------------------------
{
  const isBackup = (name) => name.startsWith("pos-") && name.endsWith(".db");
  check("una copia terminada cuenta", isBackup("pos-20260809-230000.db"), true);
  check("una copia a medias NO cuenta", isBackup("pos-20260809-230000.part"), false);
  check("un fichero ajeno no cuenta", isBackup("notas.db"), false);
  check("ni uno con el prefijo pero otra extensión", isBackup("pos-x.txt"), false);

  // Y que el nombre provisional se derive del definitivo como espera Rust:
  // `with_extension("part")` sustituye `.db`, no añade.
  const staged = "pos-20260809-230000.db".replace(/\.db$/, ".part");
  check("el nombre provisional sustituye la extensión", staged, "pos-20260809-230000.part");
}

console.log(`\n${pass} correctos, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
