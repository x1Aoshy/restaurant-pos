import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { useFloor } from "@/providers/floor-provider";
import { useI18n } from "@/providers/i18n-provider";

import {
  DailyRevenueChart,
  HourlyChart,
  ProductTable,
  RankedBarChart,
  StatStrip,
} from "@/features/dashboard/charts";
import {
  fetchCategories,
  fetchDaily,
  fetchHourly,
  fetchProducts,
  type CategoryTotals,
  type DayTotals,
  type HourTotals,
  type ProductTotals,
} from "@/features/dashboard/queries";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

export function DashboardRoute() {
  const { tables, liveOrders } = useFloor();
  const { t } = useI18n();

  const [range, setRange] = useState<Range>(7);
  const [daily, setDaily] = useState<DayTotals[]>([]);
  const [categories, setCategories] = useState<CategoryTotals[]>([]);
  const [products, setProducts] = useState<ProductTotals[]>([]);
  const [hours, setHours] = useState<HourTotals[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (days: Range) => {
    try {
      // Los agregados los calcula SQLite: traer todo el historial al cliente
      // para sumarlo aquí deja de funcionar en cuanto haya unos meses de
      // ventas, y el resumen es justo lo que se abre a diario.
      const [d, c, p, h] = await Promise.all([
        fetchDaily(days),
        fetchCategories(days),
        fetchProducts(days),
        fetchHourly(days),
      ]);
      setDaily(d);
      setCategories(c);
      setProducts(p);
      setHours(h);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(range);
  }, [load, range]);

  const stats = useMemo(() => {
    const revenue = daily.reduce((n, d) => n + d.revenueCents, 0);
    const expense = daily.reduce((n, d) => n + d.expenseCents, 0);
    const tickets = daily.reduce((n, d) => n + d.tickets, 0);
    const profit = revenue - expense;
    return {
      revenue,
      expense,
      profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      // Redondear el promedio a centavo entero: dividir centavos entre cuentas
      // da decimales que no existen en ninguna caja.
      average: tickets > 0 ? Math.round(revenue / tickets) : 0,
      tickets,
      openCount: Object.keys(liveOrders).length,
      occupied: tables.filter((x) => x.status !== "available").length,
      lowStock: products.filter((p) => p.low).length,
    };
  }, [daily, liveOrders, tables, products]);

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        description={
          stats.occupied > 0
            ? `${stats.occupied} ${t("dash.tablesInService").toLowerCase()}`
            : undefined
        }
        actions={
          /* Un solo grupo de filtros arriba, que aplica a todo lo de abajo.
             Nunca filtros dentro de cada tarjeta. */
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
        {/* Al refrescar se atenúa el render anterior en vez de saltar a un
            esqueleto: sin salto de layout. */}
        <div
          className={cn(loading ? "opacity-60" : "opacity-100")}
          style={{ transition: "opacity 150ms" }}
        >
          <div className="flex flex-col gap-4 p-4">
            {loading && daily.length === 0 ? (
              <>
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-72 rounded-xl" />
              </>
            ) : (
              <>
                <StatStrip
                  hero={{
                    label: t("dash.revenue"),
                    value: formatCents(stats.revenue),
                    hint: `${stats.tickets} ${t("dash.tickets").toLowerCase()} · ${t(
                      `dash.range${range}`,
                    )}`,
                  }}
                  items={[
                    {
                      label: t("dash.expenses"),
                      value: formatCents(stats.expense),
                    },
                    {
                      label: t("dash.profit"),
                      value: formatCents(stats.profit),
                      hint: `${t("dash.margin")} ${stats.margin.toFixed(1)}%`,
                      tone: stats.profit < 0 ? "text-destructive" : "text-status-free",
                    },
                    {
                      label: t("dash.avgTicket"),
                      value: formatCents(stats.average),
                      hint:
                        stats.lowStock > 0
                          ? t("inv.lowStockCount", { n: stats.lowStock })
                          : `${stats.openCount} ${t("dash.openTabs").toLowerCase()}`,
                    },
                  ]}
                />

                <DailyRevenueChart
                  data={daily}
                  title={t("dash.revenueVsExpenses")}
                />

                <ProductTable
                  title={t("dash.productPerf")}
                  rows={products.slice(0, 12)}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <HourlyChart title={t("dash.byHour")} data={hours} />
                  <RankedBarChart
                    title={t("dash.byCategory")}
                    labelHeader={t("dash.category")}
                    rows={categories.map((c) => ({
                      label: c.category,
                      valueCents: c.revenueCents,
                      units: c.units,
                    }))}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
