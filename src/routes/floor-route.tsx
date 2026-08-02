import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FloorGrid } from "@/features/floor/floor-grid";
import { OrderSheet } from "@/features/orders/order-sheet";
import { useFloor } from "@/providers/floor-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { TableRow, TableStatus } from "@/types/local";

const LEGEND: { status: TableStatus; dot: string; key: string }[] = [
  { status: "available", dot: "bg-status-free", key: "floor.free" },
  { status: "occupied", dot: "bg-status-busy", key: "floor.occupied" },
  { status: "billed", dot: "bg-status-billed", key: "floor.billed" },
];

export function FloorRoute() {
  const { tables } = useFloor();
  const { t } = useI18n();
  const [selected, setSelected] = useState<TableRow | null>(null);

  const counts = useMemo(() => {
    const c: Record<TableStatus, number> = {
      available: 0,
      occupied: 0,
      billed: 0,
    };
    for (const table of tables) c[table.status]++;
    return c;
  }, [tables]);

  return (
    <>
      <PageHeader
        title={t("floor.title")}
        actions={
          <div className="flex items-center gap-4">
            {LEGEND.map((item) => (
              <span
                key={item.status}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className={cn("size-2 rounded-full", item.dot)} />
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {counts[item.status]}
                </span>
                {t(item.key)}
              </span>
            ))}
          </div>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <FloorGrid onSelect={setSelected} />
        </div>
      </ScrollArea>

      <OrderSheet
        table={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
