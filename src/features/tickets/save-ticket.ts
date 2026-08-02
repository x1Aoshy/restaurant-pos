import type { jsPDF } from "jspdf";
import { isTauri } from "@tauri-apps/api/core";

export type SaveResult =
  | { status: "saved"; path: string }
  | { status: "downloaded" }
  | { status: "cancelled" }
  | { status: "out_of_scope" };

/**
 * Saves the ticket, using the native Windows dialog when running inside Tauri
 * and falling back to a browser download in the dev server.
 *
 * The fallback is not dead code: the app is developed and verified against the
 * Vite server, where the Tauri APIs do not exist.
 */
export async function saveTicketPdf(
  doc: jsPDF,
  filename: string,
): Promise<SaveResult> {
  if (!isTauri()) {
    const url = URL.createObjectURL(doc.output("blob"));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Revocar en el mismo tick puede cancelar la descarga en Chromium: el
    // navegador aún no ha leído el blob cuando la URL desaparece.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return { status: "downloaded" };
  }

  // Imported lazily so the browser build never pulls in the desktop plugins.
  const [{ save }, { writeFile }, pathApi] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);

  const [docs, downloads, desktop] = await Promise.all([
    pathApi.documentDir(),
    pathApi.downloadDir(),
    pathApi.desktopDir(),
  ]);

  const defaultPath = await pathApi.join(docs, filename);

  const path = await save({
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return { status: "cancelled" };

  // El diálogo deja elegir CUALQUIER carpeta, pero el scope de fs concedido en
  // capabilities/default.json solo cubre Documentos, Descargas y Escritorio.
  // Validar aquí convierte el error críptico de Tauri («path not allowed») en
  // un mensaje que el usuario puede entender y corregir.
  const normalize = (p: string) =>
    p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const chosen = normalize(path);
  const inScope = [docs, downloads, desktop].some((dir) =>
    chosen.startsWith(normalize(dir) + "\\"),
  );
  if (!inScope) return { status: "out_of_scope" };

  await writeFile(path, new Uint8Array(doc.output("arraybuffer")));
  return { status: "saved", path };
}

export async function revealTicket(path: string) {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}
