import { useEffect, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";

/**
 * Un evento del DOM y no un contexto a propósito.
 *
 * Quien abre esta lista está al fondo del árbol —el pie del ticket— y quien la
 * pinta está en la raíz. Un proveedor más para un diálogo que no guarda nada
 * sería más cableado que problema resuelve.
 */
const OPEN_EVENT = "restaurant-os:shortcuts";

export function openShortcuts() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** ⌘ en Mac y Ctrl en el resto: teclear el rótulo equivocado es peor que no ponerlo. */
const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

function Keys({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[0.7rem] font-medium text-foreground shadow-[0_1px_0_0_var(--color-border)]">
      {children}
    </kbd>
  );
}

function Row({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
      <span className="flex shrink-0 items-center gap-1">{keys}</span>
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function ShortcutsDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);

    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd + / funciona esté donde esté el cursor. Hace falta que así sea:
      // en el terminal el foco vive dentro del buscador casi todo el turno.
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // «?» a secas solo fuera de un campo de texto, donde es una tecla más.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const el = document.activeElement as HTMLElement | null;
        const typing =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el?.isContentEditable === true;
        if (typing) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("keys.title")}</DialogTitle>
          <DialogDescription>{t("keys.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Group title={t("keys.groupOrder")}>
            <Row keys={<Keys>↵</Keys>}>{t("keys.addFirst")}</Row>
            <Row
              keys={
                <>
                  <Keys>12</Keys>
                  <span className="text-xs text-muted-foreground">+</span>
                  <Keys>{t("keys.space")}</Keys>
                </>
              }
            >
              {t("keys.quantity")}
            </Row>
            <Row
              keys={
                <>
                  <Keys>{MOD}</Keys>
                  <Keys>↵</Keys>
                </>
              }
            >
              {t("keys.save")}
            </Row>
            <Row keys={<Keys>Esc</Keys>}>{t("keys.clearSearch")}</Row>
          </Group>

          <Group title={t("keys.groupApp")}>
            <Row
              keys={
                <>
                  <Keys>{MOD}</Keys>
                  <Keys>/</Keys>
                </>
              }
            >
              {t("keys.help")}
            </Row>
          </Group>
        </div>

        {/* El ejemplo hace más que la explicación: se lee y ya se sabe teclear. */}
        <div
          className={cn(
            "rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5",
            "text-xs leading-relaxed text-muted-foreground",
          )}
        >
          {t("keys.exampleLead")}{" "}
          <span className="rounded bg-background px-1.5 py-0.5 font-mono text-foreground">
            {t("keys.exampleTyped")}
          </span>{" "}
          {t("keys.exampleTail")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
