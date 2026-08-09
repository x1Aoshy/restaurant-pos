import { useCallback, useEffect, useState } from "react";
import { Ban, HandCoins, TicketPercent } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCents, tableLabel } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import {
  fetchDiscounts,
  fetchTipsByStaff,
  fetchTotals,
  fetchVoids,
  fetchVoidsByStaff,
  type AuditTotals,
  type DiscountRow,
  type TipsByStaff,
  type VoidRow,
} from "@/features/audit/queries";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

/** SQLite guarda «2026-08-02 19:04:00» en UTC y sin marca de zona. */
function local(value: string | null) {
  if (!value) return "";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso).toLocaleString();
}

function Card({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Ban;
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="raised rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight",
          tone,
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="mb-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {empty ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">—</p>
        </div>
      ) : (
        <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Revisión de lo que se regala y lo que se quita.
 *
 * Responde a tres preguntas que se hacen al cerrar la semana: cuánta propina
 * hay que repartir, qué se invitó y quién lo autorizó, y qué platos se
 * anularon. Los datos llevaban ahí desde que se construyeron los descuentos y
 * las anulaciones; lo que faltaba era poder leerlos.
 *
 * No acusa a nadie ni marca nada en rojo por sí solo. Una anulación suelta es
 * un plato que se cayó; veinte de la misma persona es otra cosa, y esa lectura
 * la hace quien conoce a su gente, no una regla automática.
 */
export function AuditRoute() {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>(7);
  const [loading, setLoading] = useState(true);

  const [totals, setTotals] = useState<AuditTotals | null>(null);
  const [tips, setTips] = useState<TipsByStaff[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [voids, setVoids] = useState<VoidRow[]>([]);
  const [voidsBy, setVoidsBy] = useState<
    { name: string | null; n: number; cents: number }[]
  >([]);

  const load = useCallback(async (days: Range) => {
    try {
      const [tot, tp, disc, vd, vby] = await Promise.all([
        fetchTotals(days),
        fetchTipsByStaff(days),
        fetchDiscounts(days),
        fetchVoids(days),
        fetchVoidsByStaff(days),
      ]);
      setTotals(tot);
      setTips(tp);
      setDiscounts(disc);
      setVoids(vd);
      setVoidsBy(vby);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(range);
  }, [load, range]);

  return (
    <>
      <PageHeader
        title={t("audit.title")}
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r}
                variant={range === r ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setRange(r)}
              >
                {t(`dash.range${r}`)}
              </Button>
            ))}
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn("transition-opacity duration-150", loading && "opacity-60")}
        >
          <div className="flex max-w-4xl flex-col gap-6 p-4">
            {loading && !totals ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : totals ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Card
                  icon={HandCoins}
                  label={t("audit.tips")}
                  value={formatCents(totals.tipCents)}
                  hint={t("audit.tipsHint", { n: totals.tipTickets })}
                  tone="text-status-free"
                />
                <Card
                  icon={TicketPercent}
                  label={t("audit.discounts")}
                  value={formatCents(totals.discountCents)}
                  hint={t("audit.count", { n: totals.discountCount })}
                  tone={totals.discountCents > 0 ? "text-status-billed" : undefined}
                />
                <Card
                  icon={Ban}
                  label={t("audit.voids")}
                  value={formatCents(totals.voidCents)}
                  hint={t("audit.count", { n: totals.voidCount })}
                  tone={totals.voidCents > 0 ? "text-status-billed" : undefined}
                />
              </div>
            ) : null}

            {/* La lista que se usa de verdad al cerrar el turno: cuánto le toca
                a cada quien. */}
            <Section title={t("audit.tipsByStaff")} empty={tips.length === 0}>
              {tips.map((row) => (
                <div
                  key={row.staff_id ?? "none"}
                  className="flex items-center gap-4 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
                    {row.name ?? t("audit.unknown")}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("audit.tickets", { n: row.tickets })}
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatCents(row.tips)}
                  </span>
                </div>
              ))}
            </Section>

            <Section title={t("audit.discountList")} empty={discounts.length === 0}>
              {discounts.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {tableLabel(row.table_number, t("pos.counterShort"))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium tracking-tight">
                      {row.discount_reason ?? t("audit.noReason")}
                    </div>
                    <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                      {local(row.at)}
                      {row.by_name ? ` · ${row.by_name}` : ` · ${t("audit.unknown")}`}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-status-billed">
                    −{formatCents(row.discount_cents)}
                  </span>
                </div>
              ))}
            </Section>

            {/* Quién anula más. Es la señal que se busca al abrir esto. */}
            {voidsBy.length > 1 ? (
              <Section title={t("audit.voidsByStaff")} empty={false}>
                {voidsBy.map((row, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">
                      {row.name ?? t("audit.unknown")}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("audit.count", { n: row.n })}
                    </span>
                    <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums">
                      {formatCents(row.cents)}
                    </span>
                  </div>
                ))}
              </Section>
            ) : null}

            <Section title={t("audit.voidList")} empty={voids.length === 0}>
              {voids.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {tableLabel(row.table_number, t("pos.counterShort"))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium tracking-tight">
                      <span className="font-mono text-muted-foreground">
                        {row.quantity}×{" "}
                      </span>
                      {row.product_name}
                      {row.void_reason ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.void_reason}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                      {local(row.voided_at)}
                      {row.by_name ? ` · ${row.by_name}` : ` · ${t("audit.unknown")}`}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-status-billed">
                    {formatCents(row.amount_cents)}
                  </span>
                </div>
              ))}
            </Section>

          </div>
        </div>
      </ScrollArea>
    </>
  );
}
