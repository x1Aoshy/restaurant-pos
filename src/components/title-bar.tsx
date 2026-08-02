import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Minus, Square, Copy, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSession } from "@/providers/session-provider";

type WindowApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (cb: () => void) => Promise<() => void>;
};

/** Importado en caliente: en el navegador de desarrollo la API no existe. */
async function getWindow(): Promise<WindowApi | null> {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow() as unknown as WindowApi;
}

function ControlButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 w-11 items-center justify-center text-muted-foreground",
        "transition-colors duration-100",
        danger
          ? "hover:bg-destructive hover:text-white"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Barra de título propia. La ventana va sin decoración del sistema
 * (`decorations: false`), así que el arrastre, el doble clic para maximizar y
 * los tres botones los pone la app.
 *
 * En el navegador de desarrollo no se renderiza nada: ahí la ventana la sigue
 * gestionando el navegador y una barra falsa solo estorbaría.
 */
export function TitleBar() {
  const { settings } = useSession();
  const [inTauri, setInTauri] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;

    void (async () => {
      const win = await getWindow();
      if (!win || !alive) return;
      setInTauri(true);
      setMaximized(await win.isMaximized());
      // El estado también cambia al arrastrar a un borde (Snap), no solo al
      // pulsar el botón: hay que escuchar el redimensionado.
      unlisten = await win.onResized(async () => {
        if (alive) setMaximized(await win.isMaximized());
      });
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const act = useCallback(async (fn: (w: WindowApi) => Promise<void>) => {
    const win = await getWindow();
    if (win) await fn(win);
  }, []);

  if (!inTauri) return null;

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border bg-sidebar"
    >
      {/* El texto también lleva el atributo: si no, arrastrar desde el título
          —que es justo donde la gente agarra— no movería la ventana. */}
      <span
        data-tauri-drag-region
        className="pointer-events-none px-3 text-[11px] font-medium tracking-tight text-muted-foreground"
      >
        {settings?.restaurant_name || "x1Aoshy POS"}
      </span>

      <div className="flex items-center">
        <ControlButton
          label="Minimizar"
          onClick={() => void act((w) => w.minimize())}
        >
          <Minus className="size-3.5" />
        </ControlButton>
        <ControlButton
          label={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => void act((w) => w.toggleMaximize())}
        >
          {maximized ? (
            <Copy className="size-3" />
          ) : (
            <Square className="size-3" />
          )}
        </ControlButton>
        <ControlButton
          label="Cerrar"
          danger
          onClick={() => void act((w) => w.close())}
        >
          <X className="size-3.5" />
        </ControlButton>
      </div>
    </div>
  );
}
