import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { exec, queryOne } from "@/lib/db";
import {
  pendingCount,
  pullChanges,
  pushPending,
  type SyncConfig,
} from "@/features/sync/sync-client";

/** Cada cuánto se mira el servidor. Un POS no necesita más que esto. */
const INTERVAL_MS = 30_000;

export type SyncStatus = "off" | "idle" | "syncing" | "error" | "unconfigured";

interface SyncRow extends SyncConfig {
  device_id: string;
  enabled: number;
  last_seq: number;
  last_sync_at: string | null;
}

interface SyncState {
  status: SyncStatus;
  /** Cambios de este equipo esperando a salir. */
  pending: number;
  lastSyncAt: string | null;
  /** Clave de traducción del último fallo, no el texto ya traducido. */
  errorKey: string | null;
  deviceId: string | null;
  config: SyncConfig | null;
  enabled: boolean;
  syncNow: () => Promise<void>;
  reload: () => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

async function readRow(): Promise<SyncRow | null> {
  return queryOne<SyncRow>(
    `SELECT device_id, enabled, last_seq, last_sync_at,
            server_url AS url, server_key AS anonKey, venue_token AS token
       FROM sync_context WHERE id = 1`,
  );
}

/**
 * Sube lo pendiente y baja lo nuevo cada cierto tiempo.
 *
 * No hay aviso periódico de «guardando»: en la base local todo queda escrito en
 * el momento, y un mensaje cada pocos minutos informaría de un trabajo que no
 * está ocurriendo. Lo que sí se enseña es lo que de verdad puede ir mal —que
 * haya cambios sin salir— y eso vive en un indicador permanente, no en un aviso
 * que hay que cazar al vuelo.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [row, setRow] = useState<SyncRow | null>(null);
  const [status, setStatus] = useState<SyncStatus>("off");
  const [pending, setPending] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Evita que dos ciclos se solapen: con el intervalo corto y una conexión
  // lenta, el segundo empezaría antes de acabar el primero y subiría dos veces
  // lo mismo.
  const running = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await readRow();
      setRow(next);
      setPending(await pendingCount());
      if (!next || next.enabled !== 1) setStatus("off");
      else if (!next.url || !next.anonKey || !next.token) setStatus("unconfigured");
      else setStatus((s) => (s === "off" || s === "unconfigured" ? "idle" : s));
    } catch {
      // Sin base todavía no hay nada que informar: la pantalla de arranque ya
      // enseña ese fallo.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const syncNow = useCallback(async () => {
    const current = await readRow();
    if (!current || current.enabled !== 1) return;
    if (!current.url || !current.anonKey || !current.token) {
      setStatus("unconfigured");
      return;
    }
    if (running.current) return;

    running.current = true;
    setStatus("syncing");
    try {
      const config: SyncConfig = {
        url: current.url,
        anonKey: current.anonKey,
        token: current.token,
      };
      // Subir primero: así lo que este equipo acaba de hacer llega antes de
      // que se apliquen encima cambios de otro.
      await pushPending(config, current.device_id);
      await pullChanges(config, current.device_id, current.last_seq);

      await exec(
        "UPDATE sync_context SET last_sync_at = datetime('now') WHERE id = 1",
      );
      setErrorKey(null);
      setStatus("idle");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrorKey(message === "badToken" ? "sync.errBadToken" : "sync.errNetwork");
      setStatus("error");
    } finally {
      running.current = false;
      setPending(await pendingCount().catch(() => 0));
      setRow(await readRow().catch(() => null));
    }
  }, []);

  useEffect(() => {
    if (!row || row.enabled !== 1) return;
    void syncNow();
    const id = setInterval(() => void syncNow(), INTERVAL_MS);
    return () => clearInterval(id);
  }, [row?.enabled, row?.url, row?.token, syncNow]);

  const value = useMemo<SyncState>(
    () => ({
      status,
      pending,
      lastSyncAt: row?.last_sync_at ?? null,
      errorKey,
      deviceId: row?.device_id ?? null,
      enabled: row?.enabled === 1,
      config: row ? { url: row.url, anonKey: row.anonKey, token: row.token } : null,
      syncNow,
      reload,
    }),
    [status, pending, row, errorKey, syncNow, reload],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}
