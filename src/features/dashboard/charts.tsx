import { useEffect, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";

/**
 * Todos los importes que entran aquí van en CENTAVOS enteros, igual que en la
 * base. Solo se dividen entre cien al escribirlos.
 */

/** Redondea el tope del eje a un número limpio (0 / 500 / 1.000 / 2.000…). */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Etiqueta corta del eje: «1.250» a partir de 125000 centavos. */
function axisLabel(cents: number) {
  return Math.round(cents / 100).toLocaleString();
}

/** Las barras crecen desde cero al montar y en cada cambio de rango. */
function useGrow(deps: unknown) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, [deps]);
  return grown;
}

function ChartCard({
  title,
  legend,
  children,
  table,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
  table: ReactNode;
}) {
  const { t } = useI18n();
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="raised rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-xs font-semibold tracking-tight">{title}</h3>
        <div className="flex items-center gap-3">
          {legend}
          {table ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowTable((v) => !v)}
              className="text-muted-foreground"
            >
              {showTable ? t("dash.hideTable") : t("dash.showTable")}
            </Button>
          ) : null}
        </div>
      </div>
      {/* La tabla no es un extra: es la vía accesible al mismo dato, para que
          ningún valor dependa solo del color o del hover. */}
      <div className="mt-4">{showTable ? table : children}</div>
    </section>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function Tooltip({
  x,
  title,
  rows,
}: {
  x: number;
  title: string;
  rows: { color?: string; label: string; value: string }[];
}) {
  return (
    <div
      className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full"
      style={{ left: `${x}%` }}
    >
      <div className="whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-md">
        <div className="text-[10px] font-medium tracking-tight">{title}</div>
        {rows.map((r) => (
          <div
            key={r.label}
            className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground"
          >
            {r.color ? (
              <span
                className="size-1.5 shrink-0 rounded-[2px]"
                style={{ background: r.color }}
              />
            ) : null}
            <span>{r.label}</span>
            <span className="ml-auto font-mono tabular-nums text-foreground">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface DailyPoint {
  day: string;
  revenueCents: number;
  expenseCents: number;
}

export function DailyRevenueChart({
  data,
  title,
}: {
  data: DailyPoint[];
  title: string;
}) {
  const { t, lang } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const grown = useGrow(data);

  const max = niceMax(
    Math.max(1, ...data.flatMap((d) => [d.revenueCents, d.expenseCents])),
  );
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(
      lang === "en" ? "en-US" : "es-ES",
      { day: "numeric", month: "short" },
    );

  if (data.every((d) => d.revenueCents === 0 && d.expenseCents === 0)) {
    return (
      <ChartCard title={title} table={null}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("dash.noData")}
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      legend={
        <>
          <LegendKey color="var(--chart-revenue)" label={t("dash.revenue")} />
          <LegendKey color="var(--chart-expense)" label={t("dash.expenses")} />
        </>
      }
      table={
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">{t("dash.day")}</th>
                <th className="py-1 text-right font-medium">{t("dash.revenue")}</th>
                <th className="py-1 text-right font-medium">{t("dash.expenses")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{dayLabel(d.day)}</td>
                  <td className="py-1 text-right font-mono">
                    {formatCents(d.revenueCents)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {formatCents(d.expenseCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="flex gap-2">
        <div className="flex h-44 w-14 shrink-0 flex-col justify-between text-right">
          {[...ticks].reverse().map((v) => (
            <span
              key={v}
              className="text-[9px] leading-none tabular-nums text-muted-foreground"
            >
              {axisLabel(v)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-44" onMouseLeave={() => setHover(null)}>
            {ticks.map((v, i) => (
              <span
                key={v}
                className="absolute inset-x-0 h-px bg-border"
                style={{ bottom: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}

            {hover !== null && data[hover] ? (
              <Tooltip
                x={((hover + 0.5) / data.length) * 100}
                title={dayLabel(data[hover].day)}
                rows={[
                  {
                    color: "var(--chart-revenue)",
                    label: t("dash.revenue"),
                    value: formatCents(data[hover].revenueCents),
                  },
                  {
                    color: "var(--chart-expense)",
                    label: t("dash.expenses"),
                    value: formatCents(data[hover].expenseCents),
                  },
                ]}
              />
            ) : null}

            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => (
                <div
                  key={d.day}
                  onMouseEnter={() => setHover(i)}
                  className={cn(
                    // Toda la columna es zona sensible, no solo la barra: acertar
                    // en 10px de ancho con el ratón es una mala experiencia.
                    "flex h-full min-w-0 flex-1 cursor-default items-end justify-center gap-[2px] px-[1px]",
                    "transition-colors duration-150",
                    hover === i && "bg-foreground/[0.04]",
                  )}
                >
                  <div
                    className="w-full max-w-[10px] rounded-t-[4px] transition-[height,opacity] duration-500 ease-out"
                    style={{
                      height: grown ? `${(d.revenueCents / max) * 100}%` : "0%",
                      background: "var(--chart-revenue)",
                      minHeight: d.revenueCents > 0 && grown ? 2 : 0,
                      opacity: hover === null || hover === i ? 1 : 0.45,
                    }}
                  />
                  <div
                    className="w-full max-w-[10px] rounded-t-[4px] transition-[height,opacity] duration-500 ease-out"
                    style={{
                      height: grown ? `${(d.expenseCents / max) * 100}%` : "0%",
                      background: "var(--chart-expense)",
                      minHeight: d.expenseCents > 0 && grown ? 2 : 0,
                      opacity: hover === null || hover === i ? 1 : 0.45,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-1.5 flex">
            {data.map((d, i) => (
              <span
                key={d.day}
                className={cn(
                  "min-w-0 flex-1 text-center text-[9px] tabular-nums transition-colors duration-150",
                  hover === i ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {i === 0 || i === data.length - 1 || i % 3 === 0 ? dayLabel(d.day) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

export interface HourPoint {
  hour: number;
  revenueCents: number;
  tickets: number;
}

export function HourlyChart({ data, title }: { data: HourPoint[]; title: string }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const grown = useGrow(data);

  const max = niceMax(Math.max(1, ...data.map((d) => d.revenueCents)));
  const busiest = data.reduce(
    (a, b) => (b.revenueCents > a.revenueCents ? b : a),
    data[0],
  );

  if (data.every((d) => d.revenueCents === 0)) {
    return (
      <ChartCard title={title} table={null}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("dash.noData")}
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      table={
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">{t("dash.hour")}</th>
                <th className="py-1 text-right font-medium">{t("dash.tickets")}</th>
                <th className="py-1 text-right font-medium">{t("dash.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.revenueCents > 0)
                .map((d) => (
                  <tr key={d.hour} className="border-t border-border">
                    <td className="py-1">{String(d.hour).padStart(2, "0")}:00</td>
                    <td className="py-1 text-right font-mono">{d.tickets}</td>
                    <td className="py-1 text-right font-mono">
                      {formatCents(d.revenueCents)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="relative h-28" onMouseLeave={() => setHover(null)}>
        {hover !== null && data[hover] ? (
          <Tooltip
            x={((hover + 0.5) / data.length) * 100}
            title={`${String(data[hover].hour).padStart(2, "0")}:00`}
            rows={[
              {
                label: t("dash.revenue"),
                value: formatCents(data[hover].revenueCents),
              },
              { label: t("dash.tickets"), value: String(data[hover].tickets) },
            ]}
          />
        ) : null}

        <div className="absolute inset-0 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <div
              key={d.hour}
              onMouseEnter={() => setHover(i)}
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
            >
              <div
                className="w-full rounded-t-[4px] transition-[height,opacity] duration-500 ease-out"
                style={{
                  height: grown ? `${(d.revenueCents / max) * 100}%` : "0%",
                  background: "var(--chart-revenue)",
                  minHeight: d.revenueCents > 0 && grown ? 2 : 0,
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex gap-[2px]">
        {data.map((d) => (
          <span
            key={d.hour}
            className="min-w-0 flex-1 text-center text-[9px] tabular-nums text-muted-foreground"
          >
            {d.hour % 4 === 0 ? String(d.hour).padStart(2, "0") : ""}
          </span>
        ))}
      </div>

      {busiest && busiest.revenueCents > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("dash.peakHour", {
            h: `${String(busiest.hour).padStart(2, "0")}:00`,
            v: formatCents(busiest.revenueCents),
          })}
        </p>
      ) : null}
    </ChartCard>
  );
}

export interface ProductPerfRow {
  product_id: string;
  name: string;
  units: number;
  revenueCents: number;
  /** null = ese producto no controla inventario. */
  producible: number | null;
  low: boolean;
}

/**
 * La tabla que responde a «¿cuántas vendí y cuántas me quedan?».
 * `producible` en null significa que ese producto no controla inventario —
 * se dice explícitamente en vez de mostrar un cero engañoso.
 */
export function ProductTable({
  rows,
  title,
}: {
  rows: ProductPerfRow[];
  title: string;
}) {
  const { t } = useI18n();
  const maxUnits = Math.max(1, ...rows.map((r) => r.units));
  const grown = useGrow(rows);

  if (rows.length === 0) {
    return (
      <ChartCard title={title} table={null}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("dash.noData")}
        </p>
      </ChartCard>
    );
  }

  return (
    <section className="raised rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold tracking-tight">{title}</h3>
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>{t("dash.sold")}</span>
          <span className="w-20 text-right">{t("dash.remaining")}</span>
        </div>
      </div>

      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div
            key={r.product_id}
            className="flex items-center gap-4 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{r.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatCents(r.revenueCents)}
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: grown ? `${(r.units / maxUnits) * 100}%` : "0%",
                    background: "var(--chart-revenue)",
                  }}
                />
              </div>
            </div>

            <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
              {r.units}
            </span>

            <span className="flex w-20 shrink-0 items-center justify-end gap-1.5">
              {r.producible === null ? (
                <span className="text-[10px] text-muted-foreground/60">
                  {t("dash.untracked")}
                </span>
              ) : (
                <>
                  {r.low ? (
                    <TriangleAlert className="size-3 shrink-0 text-status-billed" />
                  ) : null}
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      r.low
                        ? "font-semibold text-status-billed"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.producible}
                  </span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RankedBarChart({
  title,
  rows,
  labelHeader,
}: {
  title: string;
  rows: { label: string; valueCents: number; units: number }[];
  labelHeader: string;
}) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.valueCents));
  const grown = useGrow(rows);

  if (rows.length === 0) {
    return (
      <ChartCard title={title} table={null}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("dash.noData")}
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      table={
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">{labelHeader}</th>
                <th className="py-1 text-right font-medium">{t("dash.units")}</th>
                <th className="py-1 text-right font-medium">{t("dash.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right font-mono">{r.units}</td>
                  <td className="py-1 text-right font-mono">
                    {formatCents(r.valueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="group">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {formatCents(r.valueCents)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out group-hover:opacity-80"
                style={{
                  width: grown ? `${(r.valueCents / max) * 100}%` : "0%",
                  background: "var(--chart-revenue)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

interface Stat {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}

/**
 * Una cifra manda y tres acompañan. Cuatro celdas idénticas no dicen cuál es
 * la importante, y el ojo acaba leyéndolas todas —o ninguna.
 *
 * El héroe usa la tipografía de titulares, no la monoespaciada: a 48px las
 * cifras de ancho fijo se ven sueltas. La mono se queda para las columnas,
 * donde alinear sí importa.
 */
export function StatStrip({ hero, items }: { hero: Stat; items: Stat[] }) {
  return (
    <div className="raised grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:divide-x lg:divide-border">
      <div className="bg-accent/25 p-5">
        <div className="text-xs font-medium text-muted-foreground">{hero.label}</div>
        <div
          className={cn(
            "mt-2 font-heading text-[2.75rem] font-semibold leading-none tracking-tight",
            hero.tone,
          )}
        >
          {hero.value}
        </div>
        {hero.hint ? (
          <div className="mt-2 text-xs text-muted-foreground">{hero.hint}</div>
        ) : null}
      </div>

      <div className="col-span-full grid grid-cols-3 divide-x divide-border border-t border-border lg:col-span-3 lg:contents lg:border-t-0">
        {items.map((item) => (
          <div key={item.label} className="p-4">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div
              className={cn(
                "mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight",
                item.tone,
              )}
            >
              {item.value}
            </div>
            {item.hint ? (
              <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
