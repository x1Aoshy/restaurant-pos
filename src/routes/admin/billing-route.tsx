import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Download, ReceiptText, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { exec, query } from "@/lib/db";
import { formatCents, tableLabel } from "@/lib/format";
import { formatBp, lineTaxCents } from "@/lib/money";
import { useFloor } from "@/providers/floor-provider";
import { useI18n } from "@/providers/i18n-provider";
import { LIVE_ORDER_STATUSES, type OrderRow, type OrderStatus } from "@/types/local";
import { useTicket } from "@/features/tickets/use-ticket";

/** Una cuenta con el número de mesa ya resuelto por el JOIN. */
interface BillingOrder extends OrderRow {
  table_number: number;
}

interface ReceiptLine {
  id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  tax_bp: number;
  discount_cents: number;
}

const STATUS_KEY: Record<OrderStatus, string> = {
  open: "floor.occupied",
  sent_to_kitchen: "floor.occupied",
  served: "floor.occupied",
  billed: "floor.billed",
  paid: "billing.paid",
  cancelled: "billing.cancelled",
};

const STATUS_TONE: Record<OrderStatus, string> = {
  open: "bg-status-busy",
  sent_to_kitchen: "bg-status-busy",
  served: "bg-status-busy",
  billed: "bg-status-billed",
  paid: "bg-status-free",
  cancelled: "bg-muted-foreground",
};

type Filter = "all" | "live" | "paid" | "cancelled";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "billing.all" },
  { key: "live", label: "billing.live" },
  { key: "paid", label: "billing.paid" },
  { key: "cancelled", label: "billing.cancelled" },
];

/** SQLite guarda «2026-08-01 19:04:00» en UTC y sin marca de zona. */
function localDateTime(value: string | null) {
  if (!value) return "";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso).toLocaleString();
}

function localTime(value: string | null) {
  if (!value) return "";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso).toLocaleTimeString();
}

export function BillingRoute() {
  const { t } = useI18n();
  const { reload: reloadFloor } = useFloor();

  const [rows, setRows] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [receipt, setReceipt] = useState<BillingOrder | null>(null);
  const [lines, setLines] = useState<ReceiptLine[] | null>(null);
  const [pendingCancel, setPendingCancel] = useState<BillingOrder | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BillingOrder | null>(null);
  const [confirmWord, setConfirmWord] = useState("");
  const { generate, busy: generating } = useTicket();

  const load = useCallback(async () => {
    try {
      setRows(
        await query<BillingOrder>(
          `SELECT o.*, tb.number AS table_number
             FROM orders o
             JOIN tables tb ON tb.id = o.table_id
            ORDER BY o.created_at DESC
            LIMIT 200`,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!receipt) {
      setLines(null);
      return;
    }
    let alive = true;
    void query<ReceiptLine>(
      // Las anuladas no salen: el cliente no pagó lo que volvió a la cocina.
      `SELECT oi.id, p.name, oi.quantity, oi.unit_price_cents, oi.tax_bp,
              oi.discount_cents
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 AND oi.voided_at IS NULL
        ORDER BY oi.created_at`,
      [receipt.id],
    ).then((data) => {
      if (alive) setLines(data);
    });
    return () => {
      alive = false;
    };
  }, [receipt]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((o) => {
      const passFilter =
        filter === "all"
          ? true
          : filter === "live"
            ? LIVE_ORDER_STATUSES.includes(o.status) && o.merged_into === null
            : o.status === filter;
      if (!passFilter) return false;
      if (q === "") return true;
      return (
        String(o.table_number).includes(q) ||
        o.id.slice(0, 8).toLowerCase().includes(q) ||
        (o.payment_ref ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  /** Solo suma lo cobrado: incluir las anuladas inflaría la cifra del día. */
  const totalCents = useMemo(
    () =>
      visible.reduce(
        (n, o) => (o.status === "paid" && !o.merged_into ? n + o.total_cents : n),
        0,
      ),
    [visible],
  );

  const taxRows = useMemo(() => {
    if (!lines) return [];
    const map = new Map<number, { base: number; tax: number }>();
    for (const l of lines) {
      const entry = map.get(l.tax_bp) ?? { base: 0, tax: 0 };
      // Base rebajada por el descuento, igual que en los triggers de la base.
      const base = l.quantity * l.unit_price_cents - l.discount_cents;
      entry.base += base;
      entry.tax += lineTaxCents(1, base, l.tax_bp);
      map.set(l.tax_bp, entry);
    }
    return Array.from(map.entries())
      .map(([bp, v]) => ({ bp, ...v }))
      .sort((a, b) => a.bp - b.bp);
  }, [lines]);

  const confirmCancel = async () => {
    if (!pendingCancel) return;
    try {
      await exec("UPDATE orders SET status = 'cancelled' WHERE id = $1", [
        pendingCancel.id,
      ]);
      toast.success(t("billing.cancelled_ok"));
      await load();
      await reloadFloor();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setPendingCancel(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      // order_items cae por ON DELETE CASCADE, y sus triggers devuelven al
      // inventario exactamente lo que esa cuenta había descontado.
      await exec("DELETE FROM orders WHERE id = $1", [pendingDelete.id]);
      toast.success(t("billing.deleted"));
      await load();
      await reloadFloor();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setPendingDelete(null);
    setConfirmWord("");
  };

  const deleteWord = t("billing.deleteConfirmWord");

  return (
    <>
      <PageHeader
        title={t("billing.title")}
        description={`${visible.length} · ${formatCents(totalCents)}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                placeholder={t("billing.search")}
                className="h-7 w-56 pl-8 text-xs"
              />
            </div>
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.key}
                  variant={filter === f.key ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setFilter(f.key)}
                >
                  {t(f.label)}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">{t("billing.empty")}</p>
            </div>
          ) : (
            /* Filas en lugar de tabla: cada cuenta es una unidad con su propio
               ritmo, y las acciones dejan de competir con cinco columnas. */
            <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
              {visible.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center gap-4 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/40"
                >
                  <div className="flex w-14 shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        STATUS_TONE[order.status],
                      )}
                    />
                    <span className="truncate font-mono text-sm font-semibold tabular-nums">
                      {tableLabel(order.table_number, t("pos.counterShort"))}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium tracking-tight">
                      <span>{t(STATUS_KEY[order.status])}</span>
                      <span className="font-mono font-normal text-muted-foreground">
                        {order.id.slice(0, 8).toUpperCase()}
                      </span>
                      {/* Absorbida por otra al sincronizar: sus líneas están en
                          la que se quedó. Se enseña para que nadie la busque. */}
                      {order.merged_into ? (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          {t("billing.mergedInto", {
                            n: order.merged_into.slice(0, 8).toUpperCase(),
                          })}
                        </span>
                      ) : null}
                      {/* El método y su número son lo que permite cuadrar la
                          caja contra el estado del banco al cierre. */}
                      {order.payment_method ? (
                        <span className="font-normal text-muted-foreground">
                          · {t(`method.${order.payment_method}`)}
                          {order.payment_ref ? (
                            <span className="ml-1 font-mono">{order.payment_ref}</span>
                          ) : order.payment_method !== "cash" ? (
                            <span className="ml-1 text-status-billed">
                              · {t("pay.refMissing")}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {localDateTime(order.created_at)}
                      {order.closed_at ? ` → ${localTime(order.closed_at)}` : ""}
                    </div>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 font-mono text-sm tabular-nums",
                      (order.status === "cancelled" || order.merged_into) &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {formatCents(order.total_cents)}
                  </span>

                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("billing.receipt")}
                      aria-label={t("billing.receipt")}
                      onClick={() => setReceipt(order)}
                    >
                      <ReceiptText />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("billing.pdf")}
                      aria-label={t("billing.pdf")}
                      disabled={generating}
                      onClick={() => void generate(order, order.table_number)}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("billing.cancel")}
                      aria-label={t("billing.cancel")}
                      disabled={order.status === "paid" || order.status === "cancelled"}
                      onClick={() => setPendingCancel(order)}
                    >
                      <Ban />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("billing.delete")}
                      aria-label={t("billing.delete")}
                      onClick={() => {
                        setConfirmWord("");
                        setPendingDelete(order);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={receipt !== null} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {receipt?.table_number === 0
                ? t("pos.counterShort")
                : `${t("billing.table")} ${tableLabel(receipt?.table_number ?? 0, "")}`}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {localDateTime(receipt?.created_at ?? null)} ·{" "}
              {receipt?.id.slice(0, 8).toUpperCase()}
            </DialogDescription>
          </DialogHeader>

          {lines === null ? (
            <Skeleton className="h-40 rounded-md" />
          ) : (
            <div className="py-2">
              <div className="flex flex-col gap-2">
                {lines.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {l.quantity}×
                      </span>
                      <span className="truncate">{l.name}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="font-mono text-[0.65rem] tabular-nums text-muted-foreground/70">
                        {formatBp(l.tax_bp)}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatCents(l.quantity * l.unit_price_cents - l.discount_cents)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{t("pos.subtotal")}</span>
                <span className="font-mono tabular-nums">
                  {formatCents(receipt?.subtotal_cents ?? 0)}
                </span>
              </div>
              {receipt && receipt.discount_cents > 0 ? (
                <div className="mt-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>
                    {t("ticket.discount")}
                    {receipt.discount_reason ? ` · ${receipt.discount_reason}` : ""}
                  </span>
                  <span className="font-mono tabular-nums">
                    −{formatCents(receipt.discount_cents)}
                  </span>
                </div>
              ) : null}

              {taxRows.map((r) => (
                <div
                  key={r.bp}
                  className="mt-1.5 flex items-baseline justify-between text-xs text-muted-foreground"
                >
                  <span>
                    {t("pos.tax")} {formatBp(r.bp)}
                  </span>
                  <span className="font-mono tabular-nums">{formatCents(r.tax)}</span>
                </div>
              ))}

              {receipt && receipt.tip_cents > 0 ? (
                <div className="mt-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>{t("ticket.tip")}</span>
                  <span className="font-mono tabular-nums">
                    {formatCents(receipt.tip_cents)}
                  </span>
                </div>
              ) : null}

              <Separator className="my-4" />

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold tracking-tight">
                  {/* Con propina lo que manda es lo que se pagó; sin ella, el
                      total de siempre. Dos cifras casi iguales solo confunden. */}
                  {receipt && receipt.tip_cents > 0
                    ? t("ticket.totalPaid")
                    : t("pos.total")}
                </span>
                <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">
                  {formatCents((receipt?.total_cents ?? 0) + (receipt?.tip_cents ?? 0))}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(o) => !o && setPendingCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("billing.cancelTitle", { n: pendingCancel?.table_number ?? "—" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("billing.cancelBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("billing.back")}</AlertDialogCancel>
            <Button onClick={() => void confirmCancel()}>{t("billing.cancel")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingDelete(null);
            setConfirmWord("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("billing.deleteTitle", { n: pendingDelete?.table_number ?? "—" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("billing.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>

          {/* Confirmación escrita: borrar una cuenta pagada altera los informes
              de ventas, así que no puede quedar a un solo clic de distancia. */}
          <Input
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.currentTarget.value)}
            placeholder={deleteWord}
            autoFocus
            className="font-mono"
          />

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmWord.trim().toUpperCase() !== deleteWord}
              onClick={() => void confirmDelete()}
            >
              <Trash2 />
              {t("billing.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
