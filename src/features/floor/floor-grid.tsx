import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { elapsedSince, formatCents } from "@/lib/format";
import { useFloor } from "@/providers/floor-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { OrderRow, TableRow, TableStatus } from "@/types/local";

/**
 * El color lleva el estado (verde/ámbar/rosa), pero la etiqueta de texto se
 * queda: el color solo falla para daltónicos, y un salón se lee de un vistazo
 * y con prisa.
 */
const STATUS_META: Record<TableStatus, { key: string; dot: string; card: string }> = {
  available: {
    key: "floor.free",
    dot: "bg-status-free",
    card: "border-border bg-card hover:border-status-free/60",
  },
  occupied: {
    key: "floor.occupied",
    dot: "bg-status-busy",
    card: "border-status-busy/40 bg-status-busy-soft/60 hover:border-status-busy/70",
  },
  billed: {
    key: "floor.billed",
    dot: "bg-status-billed",
    card: "border-status-billed/50 bg-status-billed-soft/60 hover:border-status-billed/80",
  },
};

function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** SQLite guarda las fechas como «YYYY-MM-DD HH:MM:SS» en UTC. */
function sqliteToIso(value: string) {
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}

function TableCard({
  table,
  order,
  now,
  onSelect,
}: {
  table: TableRow;
  order?: OrderRow;
  now: number;
  onSelect: (table: TableRow) => void;
}) {
  const { t } = useI18n();
  const meta = STATUS_META[table.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      className={cn(
        "flex min-h-[6.5rem] flex-col justify-between rounded-xl border p-3 text-left",
        "transition-all duration-150 ease-out",
        "hover:shadow-sm active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        meta.card,
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight">
          {String(table.number).padStart(2, "0")}
        </span>
        <span className="mt-1 flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {t(meta.key)}
        </span>
      </div>

      <div className="flex w-full items-baseline justify-between gap-2">
        {order ? (
          <>
            <span className="font-mono text-sm font-semibold tabular-nums tracking-tight">
              {formatCents(order.total_cents)}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {elapsedSince(sqliteToIso(order.created_at), now)}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3" />
            <span className="tabular-nums">{table.capacity}</span>
          </span>
        )}
      </div>
    </button>
  );
}

export function FloorGrid({ onSelect }: { onSelect: (table: TableRow) => void }) {
  const { tables, liveOrders, loading, error } = useFloor();
  const { t } = useI18n();
  const now = useMinuteTick();

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div data-tour="floor-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[6.5rem] rounded-xl" />
        ))}
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <p className="text-sm font-semibold">{t("floor.empty")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {tables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          order={liveOrders[table.id]}
          now={now}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
