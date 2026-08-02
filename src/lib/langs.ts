/**
 * Fuera del provider a propósito: exportar un array desde un módulo con
 * componentes rompe el Fast Refresh de Vite («"LANGS" export is incompatible»)
 * y cada cambio en i18n forzaba una recarga completa.
 */
export type Lang = "es" | "en";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];
