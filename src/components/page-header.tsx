import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useFloor } from "@/providers/floor-provider";

/**
 * El estado de conexión solo aparece cuando algo va mal. Un indicador «todo
 * correcto» permanente es ruido: nadie lo mira hasta que falla.
 */
/**
 * Con la base local ya no hay conexión que vigilar: el único fallo posible es
 * que no se pueda abrir el archivo, y eso lo comunica la pantalla de arranque.
 */
function ConnectionWarning() {
  const { error } = useFloor();
  if (!error) return null;

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-destructive/40 px-2 py-0.5",
        "text-[10px] text-destructive",
      )}
    >
      <span className="size-1.5 rounded-full bg-destructive" />
      {error}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="shrink-0 text-sm font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
        <ConnectionWarning />
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
