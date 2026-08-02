/**
 * Comprueba que los dos diccionarios tienen exactamente las mismas claves y que
 * ninguna pantalla usa una que no exista.
 *
 * Una clave que falta no rompe la compilación: se pinta el identificador crudo
 * en medio de la interfaz, y en el idioma que no usa quien programa eso pasa
 * desapercibido hasta que lo ve el cliente.
 *
 *   node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const provider = readFileSync(join(src, "providers", "i18n-provider.tsx"), "utf8");

/** Extrae las claves de `const ES: Record<string, string> = { ... }`. */
function keysOf(name) {
  const start = provider.indexOf(`const ${name}: Record<string, string> = {`);
  if (start === -1) throw new Error(`No se encontró el diccionario ${name}`);
  const end = provider.indexOf("\n};", start);
  const body = provider.slice(start, end);
  return new Set([...body.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]));
}

const es = keysOf("ES");
const en = keysOf("EN");

let problems = 0;
const report = (msg) => {
  problems++;
  console.error(msg);
};

for (const k of es) if (!en.has(k)) report(`falta en EN: ${k}`);
for (const k of en) if (!es.has(k)) report(`falta en ES: ${k}`);

// Claves usadas en el código pero que no existen en ningún diccionario.
// Solo se miran las literales: `t(\`kind.${x}\`)` se resuelve en ejecución.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "_pending" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const prefixes = new Set([...es].map((k) => k.split(".")[0]));

for (const file of walk(src)) {
  const code = readFileSync(file, "utf8");
  const where = relative(root, file).replace(/\\/g, "/");

  for (const m of code.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    if (!es.has(m[1])) report(`clave inexistente en ${where}: ${m[1]}`);
  }

  // `t(`method.${x}`)`: no se puede saber el valor, pero sí que la familia
  // exista. Un renombrado de «method.» a «pay.» se detecta aquí.
  for (const m of code.matchAll(/\bt\(\s*`([a-zA-Z]+)\.\$\{/g)) {
    if (!prefixes.has(m[1])) report(`familia de claves inexistente en ${where}: ${m[1]}.*`);
  }
}

// Claves que ya no usa nadie. No rompen nada, pero se acumulan y acaban
// haciendo dudar de si un texto sigue vivo o es un resto de otra época.
const dynamic = new Set(["role", "method", "kind", "status", "dash", "tut"]);
const used = walk(src)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const orphans = [...es].filter(
  (k) => !used.includes(`"${k}"`) && !dynamic.has(k.split(".")[0]),
);
for (const k of orphans) report(`clave sin usar: ${k}`);

if (problems > 0) {
  console.error(`\n${problems} problema(s) de traducción`);
  process.exit(1);
}
console.log(`ok  ${es.size} claves, ES y EN en paridad, sin claves huérfanas`);
