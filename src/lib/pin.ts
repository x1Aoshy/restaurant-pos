/**
 * PIN de acceso, derivado con PBKDF2 mediante la Web Crypto del sistema.
 *
 * Qué protege y qué no, con franqueza: quien tenga acceso al archivo de la base
 * puede editarlo directamente y saltarse la aplicación entera. Esto no lo evita
 * —nada del lado del cliente puede—. Lo que sí evita es que los PIN del
 * personal queden a la vista de cualquiera que abra el fichero con un visor,
 * que es el escenario realista en un mostrador compartido.
 *
 * 210.000 iteraciones es la recomendación de OWASP para PBKDF2-SHA256. Con un
 * PIN corto no es mucha barrera frente a fuerza bruta offline, pero encarece
 * lo suficiente el ataque casual.
 */

const ITERATIONS = 210_000;
const KEY_BITS = 256;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const fromB64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Formato guardado: `pbkdf2$iteraciones$salBase64$hashBase64` */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  const expected = fromB64(parts[3]);
  const actual = await derive(pin, fromB64(parts[2]), iterations);
  if (actual.length !== expected.length) return false;

  // Comparación en tiempo constante: salir en la primera diferencia filtra,
  // por el tiempo de respuesta, cuántos bytes iniciales eran correctos.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * Solo números: se teclea con prisa, a veces sin mirar y de cara al comedor.
 *
 * Seis cifras y no cuatro porque el registro de cambios lleva estos hashes, y
 * en cuanto se encienda la sincronización acabarán en un servidor ajeno. Cuatro
 * cifras son diez mil combinaciones: se prueban enteras en un rato aunque el
 * hash cueste 210.000 iteraciones. Con seis son cien veces más.
 */
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 8;

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${MIN_PIN_LENGTH},${MAX_PIN_LENGTH}}$`).test(pin);
}
