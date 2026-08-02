import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Delete, LoaderCircle, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_PIN_LENGTH, MIN_PIN_LENGTH } from "@/lib/pin";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { StaffPublic } from "@/types/local";

/** A partir de aquí la lista deja de leerse de un vistazo y aparece el buscador. */
const SEARCH_THRESHOLD = 8;

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/**
 * Pantalla de turno: se elige quién entra y se teclea el PIN.
 *
 * Dos decisiones que vienen de que esto se usa de pie y con prisa:
 *
 * - **El PIN se confirma a mano.** Antes se probaba solo al llegar al cuarto
 *   dígito, y al fallar borraba el campo: con un PIN de seis cifras era
 *   imposible entrar, porque el intento fallido limpiaba lo tecleado mientras
 *   la persona seguía escribiendo.
 * - **La lista se adapta al tamaño de la plantilla.** Con cuatro meseros, unas
 *   fichas grandes son lo más rápido; con veinte son un muro. A partir de ocho
 *   se cambia a lista compacta con buscador.
 */
export function LockScreen() {
  const { roster, signIn } = useSession();
  const { t } = useI18n();

  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Un solo empleado: no tiene sentido hacerle elegir cada vez.
  useEffect(() => {
    if (roster.length === 1) setStaffId(roster[0].id);
  }, [roster]);

  const crowded = roster.length > SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return roster;
    return roster.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [roster, search]);

  const submit = useCallback(async () => {
    if (!staffId || pin.length < MIN_PIN_LENGTH || busy) return;
    setBusy(true);
    const message = await signIn(staffId, pin);
    setBusy(false);
    if (!message) return;
    setError(message === "wrongPin" ? t("lock.wrongPin") : t("lock.notFound"));
    setPin("");
  }, [staffId, pin, busy, signIn, t]);

  const press = useCallback((key: string) => {
    setError(null);
    if (key === "back") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length >= MAX_PIN_LENGTH ? p : p + key));
  }, []);

  // Teclado físico: la caja suele tener uno y es más rápido que la pantalla.
  // Solo escucha con alguien ya elegido; si no, teclear el nombre en el
  // buscador iría llenando además un PIN invisible.
  useEffect(() => {
    if (!staffId) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [staffId, press, submit]);

  const person = roster.find((r) => r.id === staffId);
  const ready = pin.length >= MIN_PIN_LENGTH;

  const keyClass = cn(
    "raised flex h-14 items-center justify-center rounded-xl border border-border bg-card",
    "font-mono text-xl transition-colors duration-100",
    "hover:bg-accent/40 active:scale-[0.97] disabled:opacity-40",
  );

  const pick = (r: StaffPublic) => {
    setStaffId(r.id);
    setPin("");
    setError(null);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-background px-6 py-8">
      <div className={cn("w-full", staffId || !crowded ? "max-w-[19rem]" : "max-w-sm")}>
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {t("login.brand")}
        </p>

        {!staffId ? (
          <>
            <h1 className="mt-3 text-center text-lg font-semibold tracking-tight">
              {t("lock.who")}
            </h1>

            {crowded ? (
              <>
                <div className="relative mt-5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    placeholder={t("lock.search")}
                    className="h-10 pl-9 pr-9"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label={t("lock.clearSearch")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* Filas de 44 px: el mínimo cómodo para el dedo, y entran diez
                    sin desplazar. Las fichas grandes de antes obligaban a
                    recorrer media pantalla por persona. */}
                <div className="raised mt-3 max-h-[26rem] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
                  {visible.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {t("lock.noMatch")}
                    </p>
                  ) : (
                    visible.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => pick(r)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-accent/40"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                          {initialsOf(r.full_name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
                          {r.full_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {t(`role.${r.role}`)}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t("lock.count", { n: roster.length })}
                </p>
              </>
            ) : (
              <div className="mt-6 flex flex-col gap-2">
                {roster.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pick(r)}
                    className="raised rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors duration-150 hover:bg-accent/40"
                  >
                    <div className="text-sm font-medium tracking-tight">
                      {r.full_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(`role.${r.role}`)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className="mt-3 text-center text-lg font-semibold tracking-tight">
              {person?.full_name}
            </h1>
            <p className="text-center text-xs text-muted-foreground">
              {t("lock.enterPin")}
            </p>

            {/* Un punto por dígito tecleado, con cuatro huecos de referencia:
                marcar los ocho posibles hacía pensar que el PIN debía ser de
                ocho cifras. */}
            <div className="mt-6 flex min-h-6 items-center justify-center gap-2.5">
              {Array.from({ length: Math.max(MIN_PIN_LENGTH, pin.length) }).map(
                (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded-full transition-all duration-150",
                      i < pin.length
                        ? "size-2.5 bg-primary"
                        : "size-2 bg-muted-foreground/25",
                    )}
                  />
                ),
              )}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  disabled={busy}
                  className={keyClass}
                >
                  {k}
                </button>
              ))}

              <button
                type="button"
                onClick={() => press("back")}
                disabled={busy || pin.length === 0}
                aria-label={t("lock.erase")}
                className={keyClass}
              >
                <Delete className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => press("0")}
                disabled={busy}
                className={keyClass}
              >
                0
              </button>
              {/* Confirmar tiene su tecla, en la posición del pulgar. */}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !ready}
                aria-label={t("lock.enter")}
                className={cn(
                  keyClass,
                  ready && !busy
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "",
                )}
              >
                {busy ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <ArrowRight className="size-5" />
                )}
              </button>
            </div>

            <div className="mt-4 flex min-h-8 items-start justify-center">
              {error ? (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <CircleAlert className="size-3.5" />
                  {error}
                </span>
              ) : null}
            </div>

            {roster.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setStaffId(null);
                  setPin("");
                  setError(null);
                  setSearch("");
                }}
              >
                {t("lock.changeUser")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
