import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { exec, newId, query, queryOne } from "@/lib/db";
import { hashPin, verifyPin } from "@/lib/pin";
import { configureCurrency } from "@/lib/format";
import type { SettingsRow, StaffPublic, StaffRole, StaffRow } from "@/types/local";

/** Fases del arranque, para no pintar la caja antes de saber qué hay. */
type Phase = "loading" | "setup" | "locked" | "ready" | "error";

interface SessionState {
  phase: Phase;
  error: string | null;
  staff: StaffPublic | null;
  settings: SettingsRow | null;
  /** Personal activo, para elegir quién entra sin teclear el nombre. */
  roster: StaffPublic[];
  signIn: (staffId: string, pin: string) => Promise<string | null>;
  signOut: () => void;
  createFirstAdmin: (name: string, pin: string) => Promise<string | null>;
  refreshSettings: () => Promise<void>;
  refreshRoster: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

const PUBLIC_COLUMNS =
  "id, full_name, role, active, created_at";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffPublic | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [roster, setRoster] = useState<StaffPublic[]>([]);

  const refreshSettings = useCallback(async () => {
    const row = await queryOne<SettingsRow>("SELECT * FROM settings WHERE id = 1");
    setSettings(row);
    if (row) configureCurrency(row.currency);
  }, []);

  const refreshRoster = useCallback(async () => {
    const rows = await query<StaffPublic>(
      `SELECT ${PUBLIC_COLUMNS} FROM staff WHERE active = 1 ORDER BY full_name`,
    );
    setRoster(rows);
  }, []);

  // Arranque: la base se crea sola con las migraciones del plugin. Solo hay que
  // averiguar si ya hay alguien dado de alta o es la primera vez.
  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        await refreshSettings();
        const rows = await query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM staff WHERE active = 1",
        );
        if (!alive) return;

        if ((rows[0]?.n ?? 0) === 0) {
          setPhase("setup");
          return;
        }
        await refreshRoster();
        if (alive) setPhase("locked");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshSettings, refreshRoster]);

  /**
   * El PIN se pide en cada arranque. La sesión no se guarda en disco a
   * propósito: en un mostrador compartido, dejarla abierta significa que el
   * primero que toque el equipo hereda el rol del último turno.
   */
  const signIn = useCallback(async (staffId: string, pin: string) => {
    const row = await queryOne<StaffRow>(
      "SELECT * FROM staff WHERE id = $1 AND active = 1",
      [staffId],
    );
    if (!row) return "notFound";

    const ok = await verifyPin(pin, row.pin_hash);
    if (!ok) return "wrongPin";

    const { pin_hash: _drop, ...pub } = row;
    void _drop;
    setStaff(pub);
    setPhase("ready");
    return null;
  }, []);

  const signOut = useCallback(() => {
    setStaff(null);
    setPhase("locked");
  }, []);

  /** Alta inicial: la primera cuenta del equipo es siempre administradora. */
  const createFirstAdmin = useCallback(
    async (name: string, pin: string) => {
      try {
        const existing = await query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM staff",
        );
        if ((existing[0]?.n ?? 0) > 0) return "alreadySetUp";

        const id = newId();
        const hash = await hashPin(pin);
        await exec(
          `INSERT INTO staff (id, full_name, role, pin_hash, active)
           VALUES ($1, $2, 'admin', $3, 1)`,
          [id, name.trim(), hash],
        );

        await refreshRoster();
        const created = await queryOne<StaffPublic>(
          `SELECT ${PUBLIC_COLUMNS} FROM staff WHERE id = $1`,
          [id],
        );
        setStaff(created);
        setPhase("ready");
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [refreshRoster],
  );

  const value = useMemo<SessionState>(
    () => ({
      phase,
      error,
      staff,
      settings,
      roster,
      signIn,
      signOut,
      createFirstAdmin,
      refreshSettings,
      refreshRoster,
    }),
    [
      phase,
      error,
      staff,
      settings,
      roster,
      signIn,
      signOut,
      createFirstAdmin,
      refreshSettings,
      refreshRoster,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Atajo de rol, con la misma regla que usaban las políticas de Postgres. */
export function isManagerRole(role: StaffRole | undefined) {
  return role === "admin" || role === "manager";
}
