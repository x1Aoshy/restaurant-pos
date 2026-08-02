import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { query } from "@/lib/db";
import { LIVE_ORDER_STATUSES, type OrderRow, type TableRow } from "@/types/local";

interface FloorState {
  tables: TableRow[];
  /** Cuenta viva por mesa, indexada por `table_id`. */
  liveOrders: Record<string, OrderRow>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const FloorContext = createContext<FloorState | null>(null);

/**
 * Estado del salón leído de la base local.
 *
 * Ya no hay suscripción en tiempo real ni reconciliación de eventos: con un
 * solo equipo, la única fuente de cambios es esta misma aplicación, así que
 * recargar tras cada mutación es exacto y mucho más simple. Toda la maquinaria
 * de canales, reconexión y resincronizado desaparece.
 */
export function FloorProvider({ children }: { children: ReactNode }) {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [liveOrders, setLiveOrders] = useState<Record<string, OrderRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const placeholders = LIVE_ORDER_STATUSES.map((_, i) => `$${i + 1}`).join(",");
      const [tableRows, orderRows] = await Promise.all([
        query<TableRow>("SELECT * FROM tables ORDER BY number"),
        query<OrderRow>(
          // `merged_into IS NULL`: una cuenta absorbida por otra al
          // sincronizar sigue en el historial, pero ya no ocupa la mesa.
          `SELECT * FROM orders
            WHERE status IN (${placeholders}) AND merged_into IS NULL`,
          LIVE_ORDER_STATUSES,
        ),
      ]);

      setTables(tableRows);
      setLiveOrders(Object.fromEntries(orderRows.map((o) => [o.table_id, o])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<FloorState>(
    () => ({ tables, liveOrders, loading, error, reload }),
    [tables, liveOrders, loading, error, reload],
  );

  return <FloorContext.Provider value={value}>{children}</FloorContext.Provider>;
}

export function useFloor() {
  const ctx = useContext(FloorContext);
  if (!ctx) throw new Error("useFloor must be used inside <FloorProvider>");
  return ctx;
}
