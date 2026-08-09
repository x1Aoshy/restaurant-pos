import { useCallback, useEffect, useRef } from "react";

import { PosCatalog } from "@/features/pos/pos-catalog";
import { PosTicket } from "@/features/pos/pos-ticket";
import { useDraft } from "@/features/pos/use-draft";

export function PosRoute() {
  const draft = useDraft();
  const { commit, addProduct, lines, table, saving } = draft;

  /**
   * El buscador es el sitio de reposo del cursor en esta pantalla.
   *
   * Toda la comanda entra por él, así que cada acción que lo abandona —guardar,
   * vaciar, tocar una tarjeta con el ratón— lo devuelve. Antes había que volver
   * a hacer clic en la caja de texto entre línea y línea.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  const save = useCallback(async () => {
    await commit();
    focusSearch();
  }, [commit, focusSearch]);

  // Ctrl/Cmd+Enter guarda desde cualquier punto de la pantalla, para no soltar
  // el teclado al cerrar una comanda.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (table && lines.length > 0 && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, lines.length, table, saving]);

  return (
    <div className="flex min-h-0 flex-1">
      <PosCatalog onAdd={addProduct} searchRef={searchRef} />
      <PosTicket draft={draft} onSave={save} focusSearch={focusSearch} />
    </div>
  );
}
