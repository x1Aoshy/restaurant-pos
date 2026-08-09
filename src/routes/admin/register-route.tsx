import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  LoaderCircle,
  LockKeyhole,
  Printer,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { exec, newId, query, queryOne } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { parseCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { CashMovementRow, CashRegisterRow } from "@/types/local";
import { usePrinting } from "@/features/printing/use-printing";
import { fetchZReport, zReportBlocks } from "@/features/register/z-report";

type MoveKind = "drop" | "payout" | "adjustment";

/**
 * Turno de caja: apertura con fondo, movimientos y arqueo al cierre.
 *
 * El recuento es **a ciegas**: hasta que no se teclea lo contado, la pantalla no
 * enseña lo esperado. Si lo enseñara antes, quien cuenta ya sabe el número que
 * «debería» salir y el arqueo deja de medir nada.
 *
 * Las ventas en efectivo entran solas —lo hace un trigger al cobrar—, así que
 * aquí solo se apuntan a mano las salidas: retiradas a la caja fuerte, pagos a
 * un proveedor y correcciones.
 */
export function RegisterRoute() {
  const { t, lang } = useI18n();
  const { staff, settings } = useSession();
  const { printHere } = usePrinting();

  const [register, setRegister] = useState<CashRegisterRow | null>(null);
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [recent, setRecent] = useState<CashRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [openFloat, setOpenFloat] = useState("");
  const [openDialog, setOpenDialog] = useState(false);

  const [moveKind, setMoveKind] = useState<MoveKind | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveNote, setMoveNote] = useState("");

  const [closeDialog, setCloseDialog] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  /** Hasta que no se confirma el recuento no se enseña el descuadre. */
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    const context = await queryOne<{ device_id: string }>(
      "SELECT device_id FROM sync_context WHERE id = 1",
    );
    const open = context
      ? await queryOne<CashRegisterRow>(
          "SELECT * FROM cash_registers WHERE device_id = $1 AND status = 'open'",
          [context.device_id],
        )
      : null;
    setRegister(open);
    setMovements(
      open
        ? await query<CashMovementRow>(
            `SELECT * FROM cash_movements WHERE register_id = $1
              ORDER BY created_at DESC, rowid DESC`,
            [open.id],
          )
        : [],
    );
    setRecent(
      await query<CashRegisterRow>(
        "SELECT * FROM cash_registers WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 10",
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRegister = async () => {
    const float = parseCents(openFloat);
    if (float === null) return toast.error(t("reg.invalidAmount"));
    setBusy(true);
    try {
      const context = await queryOne<{ device_id: string }>(
        "SELECT device_id FROM sync_context WHERE id = 1",
      );
      await exec(
        `INSERT INTO cash_registers (id, device_id, opened_by, opening_float_cents)
         VALUES ($1, $2, $3, $4)`,
        [newId(), context?.device_id ?? "", staff?.id ?? null, float],
      );
      // El fondo inicial también es un apunte: sin él, el libro de movimientos
      // no explica de dónde salió el dinero que ya había en el cajón.
      toast.success(t("reg.opened"));
      setOpenDialog(false);
      setOpenFloat("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveMovement = async () => {
    if (!register || !moveKind) return;
    const amount = parseCents(moveAmount);
    if (amount === null || amount === 0) return toast.error(t("reg.invalidAmount"));

    // Retiradas y pagos salen del cajón: se guardan en negativo aunque se
    // tecleen en positivo, que es como los dice la gente.
    const signed = moveKind === "adjustment" ? amount : -amount;

    setBusy(true);
    try {
      await exec(
        `INSERT INTO cash_movements (id, register_id, kind, amount_cents, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), register.id, moveKind, signed, moveNote.trim() || null, staff?.id ?? null],
      );
      toast.success(t("reg.movementSaved"));
      setMoveKind(null);
      setMoveAmount("");
      setMoveNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revealCount = async () => {
    if (!register) return;
    const value = parseCents(counted);
    if (value === null) return toast.error(t("reg.invalidAmount"));
    setBusy(true);
    try {
      // Guardar el recuento dispara el trigger que calcula el descuadre. Solo
      // entonces se enseña: contar sabiendo el resultado no es contar.
      await exec("UPDATE cash_registers SET counted_cents = $1 WHERE id = $2", [
        value,
        register.id,
      ]);
      setRevealed(true);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Arqueo en papel.
   *
   * Silencioso si no hay impresora: el cierre no puede depender de que haya
   * papel. Se puede volver a sacar desde el historial cuando la haya.
   */
  const printZ = useCallback(
    async (registerId: string, quiet = false) => {
      if (!settings) return;
      const data = await fetchZReport(registerId);
      if (!data) return;
      const ok = await printHere(
        zReportBlocks(data, settings, {
          locale: lang === "en" ? "en-US" : "es-NI",
          title: t("reg.zTitle"),
          opened: t("reg.zOpened"),
          closed: t("reg.zClosed"),
          float: t("reg.float"),
          cashSales: t("reg.cashSales"),
          drops: t("reg.kind.drop"),
          payouts: t("reg.kind.payout"),
          expected: t("reg.expected"),
          counted: t("reg.counted"),
          difference: t("reg.difference"),
          salesByMethod: t("reg.zByMethod"),
          tips: t("ticket.tip"),
          signature: t("reg.zSignature"),
          methodName: (m) => t(`method.${m}`),
        }),
      );
      if (!ok && !quiet) toast.error(t("print.noPrinters"));
    },
    [settings, printHere, lang, t],
  );

  const closeRegister = async () => {
    if (!register) return;
    setBusy(true);
    try {
      await exec(
        `UPDATE cash_registers
            SET status = 'closed', closed_at = datetime('now'), closed_by = $1, note = $2
          WHERE id = $3`,
        [staff?.id ?? null, closeNote.trim() || null, register.id],
      );
      // El papel sale con el turno ya cerrado, nunca antes: si el cierre
      // fallara, habría un arqueo impreso de algo que sigue abierto.
      await printZ(register.id, true);
      toast.success(t("reg.closed"));
      setCloseDialog(false);
      setCounted("");
      setCloseNote("");
      setRevealed(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cashSales = movements
    .filter((m) => m.kind === "sale")
    .reduce((n, m) => n + m.amount_cents, 0);
  const outflow = movements
    .filter((m) => m.amount_cents < 0)
    .reduce((n, m) => n + m.amount_cents, 0);

  return (
    <>
      <PageHeader
        title={t("reg.title")}
        description={register ? t("reg.openSince", { d: register.opened_at }) : undefined}
        actions={
          register ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCounted("");
                setRevealed(false);
                setCloseDialog(true);
              }}
            >
              <LockKeyhole />
              {t("reg.close")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpenDialog(true)}>
              <Wallet />
              {t("reg.open")}
            </Button>
          )
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : !register ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <Wallet className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium tracking-tight">{t("reg.noneOpen")}</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
                  {[
                    { label: t("reg.float"), value: register.opening_float_cents },
                    { label: t("reg.cashSales"), value: cashSales },
                    { label: t("reg.outflow"), value: outflow },
                  ].map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between px-4 py-2.5">
                      <span className="text-xs text-muted-foreground">{r.label}</span>
                      <span className="font-mono text-sm tabular-nums">
                        {formatCents(r.value)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between bg-accent/25 px-4 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("reg.expected")}
                    </span>
                    <span className="font-mono text-xl font-semibold tabular-nums">
                      {formatCents(register.expected_cents)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(["drop", "payout", "adjustment"] as MoveKind[]).map((k) => (
                    <Button
                      key={k}
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        setMoveAmount("");
                        setMoveNote("");
                        setMoveKind(k);
                      }}
                    >
                      {t(`reg.kind.${k}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="raised rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t("reg.movements")}
                </div>
                {movements.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("reg.noMovements")}
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {movements.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                        {m.amount_cents > 0 ? (
                          <ArrowDownLeft className="size-3.5 shrink-0 text-status-free" />
                        ) : (
                          <ArrowUpRight className="size-3.5 shrink-0 text-status-billed" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium tracking-tight">
                            {t(`reg.kind.${m.kind}`)}
                          </div>
                          <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                            {m.created_at}
                            {m.note ? ` · ${m.note}` : ""}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-sm tabular-nums",
                            m.amount_cents > 0 ? "text-status-free" : "text-status-billed",
                          )}
                        >
                          {m.amount_cents > 0 ? "+" : "−"}
                          {formatCents(Math.abs(m.amount_cents))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {recent.length > 0 ? (
            <div className="mt-6">
              <p className="mb-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("reg.history")}
              </p>
              <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
                {recent.map((r) => (
                  <div key={r.id} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.opened_at} → {r.closed_at}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCents(r.expected_cents)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("reg.zPrint")}
                      aria-label={t("reg.zPrint")}
                      onClick={() => void printZ(r.id)}
                    >
                      <Printer />
                    </Button>
                    <span
                      className={cn(
                        "w-24 shrink-0 text-right font-mono text-sm tabular-nums",
                        r.difference_cents === 0
                          ? "text-muted-foreground"
                          : r.difference_cents > 0
                            ? "text-status-free"
                            : "text-status-billed",
                      )}
                    >
                      {r.difference_cents > 0 ? "+" : ""}
                      {formatCents(r.difference_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Dialog open={openDialog} onOpenChange={(o) => !o && setOpenDialog(false)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("reg.open")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="reg-float">{t("reg.float")}</Label>
            <Input
              id="reg-float"
              autoFocus
              inputMode="decimal"
              value={openFloat}
              onChange={(e) => setOpenFloat(e.currentTarget.value)}
              placeholder="0.00"
              className="mt-2 h-12 text-center font-mono text-xl tabular-nums"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void openRegister()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t("reg.open")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveKind !== null} onOpenChange={(o) => !o && setMoveKind(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{moveKind ? t(`reg.kind.${moveKind}`) : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input
              autoFocus
              inputMode="decimal"
              value={moveAmount}
              onChange={(e) => setMoveAmount(e.currentTarget.value)}
              placeholder="0.00"
              className="h-12 text-center font-mono text-xl tabular-nums"
            />
            <Input
              value={moveNote}
              onChange={(e) => setMoveNote(e.currentTarget.value)}
              placeholder={t("reg.notePh")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveKind(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveMovement()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={closeDialog}
        onOpenChange={(o) => {
          if (!o) {
            setCloseDialog(false);
            setRevealed(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("reg.close")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="reg-count">{t("reg.counted")}</Label>
            <Input
              id="reg-count"
              autoFocus
              inputMode="decimal"
              value={counted}
              onChange={(e) => {
                setCounted(e.currentTarget.value);
                setRevealed(false);
              }}
              placeholder="0.00"
              className="h-14 text-center font-mono text-2xl tabular-nums"
            />

            {revealed && register ? (
              <div className="sunken flex flex-col gap-1.5 rounded-xl bg-muted/60 p-4">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">{t("reg.expected")}</span>
                  <span className="font-mono tabular-nums">
                    {formatCents(register.expected_cents)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">{t("reg.counted")}</span>
                  <span className="font-mono tabular-nums">
                    {formatCents(register.counted_cents ?? 0)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("reg.difference")}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-xl font-semibold tabular-nums",
                      register.difference_cents === 0
                        ? "text-status-free"
                        : "text-status-billed",
                    )}
                  >
                    {register.difference_cents > 0 ? "+" : ""}
                    {formatCents(register.difference_cents)}
                  </span>
                </div>
              </div>
            ) : null}

            {revealed ? (
              <Input
                value={closeNote}
                onChange={(e) => setCloseNote(e.currentTarget.value)}
                placeholder={t("reg.notePh")}
              />
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>
              {t("common.cancel")}
            </Button>
            {revealed ? (
              <Button onClick={() => void closeRegister()} disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
                {t("reg.confirmClose")}
              </Button>
            ) : (
              <Button onClick={() => void revealCount()} disabled={busy || counted === ""}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {t("reg.checkCount")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
