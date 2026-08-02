import { useEffect } from "react";

import { PosCatalog } from "@/features/pos/pos-catalog";
import { PosTicket } from "@/features/pos/pos-ticket";
import { useDraft } from "@/features/pos/use-draft";

export function PosRoute() {
  const draft = useDraft();
  const { commit, lines, table, saving } = draft;

  // Ctrl/Cmd+Enter guarda desde cualquier punto de la pantalla, para no soltar
  // el teclado al cerrar una comanda.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (table && lines.length > 0 && !saving) void commit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, lines.length, table, saving]);

  return (
    <div className="flex min-h-0 flex-1">
      <PosCatalog onAdd={draft.addProduct} />
      <PosTicket draft={draft} />
    </div>
  );
}
