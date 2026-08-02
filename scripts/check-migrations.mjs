/**
 * Impide modificar una migración ya publicada.
 *
 * El motor guarda un resumen SHA-384 de cada migración que ejecuta y se niega a
 * arrancar si el fichero cambia después — es lo que evita que dos equipos con
 * el mismo número de versión acaben con esquemas distintos. Pero ese aviso solo
 * aparece en la máquina que ya la aplicó, y para entonces la aplicación no abre.
 *
 * Esto lo detecta antes: los resúmenes viven en `checksums.txt`, y tocar una
 * migración de la lista rompe la comprobación aquí, no en el restaurante.
 *
 *   node scripts/check-migrations.mjs            comprueba
 *   node scripts/check-migrations.mjs --update   acepta las nuevas
 *
 * Una migración aplicada es historia. Se corrige añadiendo otra, no
 * reescribiéndola.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "migrations",
);
const lockFile = join(base, "checksums.txt");
const update = process.argv.includes("--update");

const files = readdirSync(base)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const current = new Map(
  files.map((f) => [
    f,
    createHash("sha384").update(readFileSync(join(base, f))).digest("hex"),
  ]),
);

// CRLF cambiaría el resumen sin que se vea nada en el editor.
const crlf = files.filter((f) => readFileSync(join(base, f)).includes("\r\n"));

if (update) {
  const body = [...current].map(([f, h]) => `${f}  ${h}`).join("\n");
  writeFileSync(lockFile, `${body}\n`, "utf8");
  console.log(`ok  ${current.size} migraciones registradas`);
  process.exit(0);
}

if (!existsSync(lockFile)) {
  console.error("Falta checksums.txt — ejecuta: npm run lock:migrations");
  process.exit(1);
}

const locked = new Map(
  readFileSync(lockFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, hash] = line.trim().split(/\s+/);
      return [name, hash];
    }),
);

let problems = 0;
for (const [name, hash] of locked) {
  if (!current.has(name)) {
    console.error(`migración desaparecida: ${name}`);
    problems++;
  } else if (current.get(name) !== hash) {
    console.error(
      `MIGRACIÓN MODIFICADA: ${name}\n` +
        "  Ya se aplicó en algún equipo y ahí la aplicación dejará de abrir.\n" +
        "  Deshaz el cambio y añade una migración nueva que lo corrija.",
    );
    problems++;
  }
}

const added = files.filter((f) => !locked.has(f));
for (const f of crlf) {
  console.error(`finales de línea CRLF en ${f} — cambian el resumen`);
  problems++;
}

if (problems > 0) {
  console.error(`\n${problems} problema(s) en las migraciones`);
  process.exit(1);
}

if (added.length > 0) {
  console.log(`ok  ${locked.size} intactas · ${added.length} nueva(s): ${added.join(", ")}`);
  console.log("    registra las nuevas con: npm run lock:migrations");
} else {
  console.log(`ok  ${locked.size} migraciones intactas`);
}
