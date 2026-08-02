import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, LoaderCircle, Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { exec } from "@/lib/db";
import { cn } from "@/lib/utils";
import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "@/lib/format";
import { bpToInput, formatBp, parseBp } from "@/lib/money";
import { LANGS } from "@/lib/langs";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import { PALETTES, useTheme } from "@/providers/theme-provider";
import type { SettingsRow } from "@/types/local";

import { buildTicketPdf, ticketFileName } from "@/features/tickets/ticket-pdf";
import { saveTicketPdf } from "@/features/tickets/save-ticket";
import { useSampleTicket } from "@/features/tickets/sample-ticket";
import { SyncSettings } from "@/features/sync/sync-settings";
import { useTicketLabels } from "@/features/tickets/use-ticket-labels";

type Tab = "venue" | "ticket" | "appearance" | "sync";

/** Una fila = un ajuste: etiqueta y explicación a la izquierda, control a la derecha. */
function Row({
  label,
  hint,
  htmlFor,
  children,
  stack,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 px-4 py-3.5",
        stack ? "flex-col" : "items-center justify-between",
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-[13px]">
          {label}
        </Label>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <div className={cn("shrink-0", stack ? "w-full" : "w-60")}>{children}</div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

export function SettingsRoute() {
  const { settings, refreshSettings } = useSession();
  const { palette, setPalette, dark, toggle } = useTheme();
  const { lang, setLang, t } = useI18n();

  const [tab, setTab] = useState<Tab>("venue");
  const [form, setForm] = useState<SettingsRow | null>(settings);
  // La tasa vive como TEXTO mientras se edita: como número, «0.» se convertía
  // en 0 en cada pulsación y era imposible teclear «15.5».
  const [taxText, setTaxText] = useState(() =>
    settings ? bpToInput(settings.default_tax_bp) : "",
  );
  const [saving, setSaving] = useState(false);

  // La muestra usa la tasa que hay ESCRITA, no la guardada: así el efecto de
  // subir el impuesto se ve en el ticket antes de pulsar «Guardar».
  const labels = useTicketLabels();
  const sample = useSampleTicket(parseBp(taxText) ?? settings?.default_tax_bp ?? 0);

  const dirty = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = () => {
    dirty.current = true;
    setIsDirty(true);
  };

  useEffect(() => {
    if (!settings || dirty.current) return;
    setForm(settings);
    setTaxText(bpToInput(settings.default_tax_bp));
  }, [settings]);

  const save = async () => {
    if (!form) return;

    const bp = parseBp(taxText);
    if (bp === null) {
      toast.error(t("toast.taxRange"));
      return;
    }

    setSaving(true);
    try {
      await exec(
        `UPDATE settings SET
           restaurant_name = $1, address = $2, phone = $3,
           default_tax_bp = $4, ticket_header = $5, ticket_footer = $6,
           show_tax_breakdown = $7, ticket_format = $8,
           updated_at = datetime('now')
         WHERE id = 1`,
        [
          form.restaurant_name.trim(),
          form.address.trim(),
          form.phone.trim(),
          bp,
          form.ticket_header,
          form.ticket_footer,
          form.show_tax_breakdown,
          form.ticket_format,
        ],
      );
      dirty.current = false;
      setIsDirty(false);
      toast.success(t("settings.saved"));
      await refreshSettings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /** La moneda se aplica al instante: no pasa por «Guardar». */
  const changeCurrency = async (v: string | null) => {
    if (!v || !form || !isSupportedCurrency(v)) return;
    setForm({ ...form, currency: v });
    try {
      await exec("UPDATE settings SET currency = $1 WHERE id = 1", [v]);
      await refreshSettings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadSample = async () => {
    if (!form) return;
    try {
      const ticket = {
        settings: form,
        labels,
        tableNumber: 4,
        reference: t("settings.sampleRef").toUpperCase(),
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        ...sample,
      };
      const result = await saveTicketPdf(
        buildTicketPdf(ticket),
        ticketFileName(ticket),
      );
      if (result.status === "out_of_scope") toast.error(t("toast.scopeFolders"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.ticketFailed"));
    }
  };

  if (!form) {
    return (
      <>
        <PageHeader title={t("settings.title")} />
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  const set = <K extends keyof SettingsRow>(key: K, value: SettingsRow[K]) => {
    markDirty();
    setForm({ ...form, [key]: value });
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "venue", label: t("settings.tabVenue") },
    { id: "ticket", label: t("settings.tabTicket") },
    { id: "appearance", label: t("settings.tabAppearance") },
    { id: "sync", label: t("settings.tabSync") },
  ];

  // Apariencia se guarda sola: mostrar «Guardar» ahí sugeriría cambios
  // pendientes que no existen.
  const needsSave = tab === "venue" || tab === "ticket";
  const money = (cents: number) =>
    new Intl.NumberFormat(
      SUPPORTED_CURRENCIES.find((c) => c.code === form.currency)?.locale ?? "en-US",
      { style: "currency", currency: form.currency },
    ).format(cents / 100);

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        actions={
          needsSave ? (
            <div className="flex items-center gap-2.5">
              {isDirty ? (
                <span className="text-xs text-muted-foreground">
                  {t("settings.unsaved")}
                </span>
              ) : null}
              <Button size="sm" onClick={() => void save()} disabled={saving || !isDirty}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                {t("settings.save")}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="flex shrink-0 gap-1 border-b border-border px-4 py-2">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-150",
              tab === x.id
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {tab === "venue" ? (
            <div className="max-w-2xl">
              <Card>
                <Row label={t("settings.name")} hint={t("settings.nameHint")} htmlFor="s-name">
                  <Input
                    id="s-name"
                    value={form.restaurant_name}
                    onChange={(e) => set("restaurant_name", e.currentTarget.value)}
                  />
                </Row>
                <Row label={t("settings.address")} hint={t("settings.optional")} htmlFor="s-address">
                  <Input
                    id="s-address"
                    value={form.address}
                    onChange={(e) => set("address", e.currentTarget.value)}
                    placeholder={t("settings.addressPh")}
                  />
                </Row>
                <Row label={t("settings.phone")} hint={t("settings.optional")} htmlFor="s-phone">
                  <Input
                    id="s-phone"
                    value={form.phone}
                    onChange={(e) => set("phone", e.currentTarget.value)}
                  />
                </Row>
              </Card>

              <div className="mt-6">
                <Card>
                  <Row label={t("settings.currency")} hint={t("settings.instant")} htmlFor="s-currency">
                    <Select value={form.currency} onValueChange={(v: string | null) => void changeCurrency(v)}>
                      <SelectTrigger id="s-currency" className="w-full">
                        <SelectValue>
                          {(v: string) => {
                            const c = SUPPORTED_CURRENCIES.find((x) => x.code === v);
                            return c ? `${c.symbol}  ${c.code}` : "—";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.symbol} {c.code} — {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label={t("settings.defaultTax")} hint={t("settings.taxesDesc")} htmlFor="s-tax">
                    <div className="flex items-center gap-2">
                      <Input
                        id="s-tax"
                        inputMode="decimal"
                        value={taxText}
                        onChange={(e) => {
                          markDirty();
                          setTaxText(e.currentTarget.value);
                        }}
                        className="font-mono tabular-nums"
                      />
                      <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {formatBp(parseBp(taxText) ?? 0)}
                      </span>
                    </div>
                  </Row>
                </Card>
                <p className="mt-2 px-1 text-xs text-muted-foreground">
                  {t("settings.taxExampleLocal")}
                </p>
              </div>
            </div>
          ) : null}

          {tab === "ticket" ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div>
                <Card>
                  <Row label={t("settings.header")} hint={t("settings.optional")} htmlFor="s-header" stack>
                    <Textarea
                      id="s-header"
                      rows={2}
                      value={form.ticket_header}
                      onChange={(e) => set("ticket_header", e.currentTarget.value)}
                      placeholder={t("settings.headerPh")}
                    />
                  </Row>
                  <Row label={t("settings.footer")} htmlFor="s-footer" stack>
                    <Textarea
                      id="s-footer"
                      rows={2}
                      value={form.ticket_footer}
                      onChange={(e) => set("ticket_footer", e.currentTarget.value)}
                    />
                  </Row>
                  <Row label={t("settings.format")} hint={t("settings.formatHint")} htmlFor="s-format">
                    <Select
                      value={form.ticket_format}
                      onValueChange={(v: string | null) => {
                        if (v) set("ticket_format", v);
                      }}
                    >
                      <SelectTrigger id="s-format" className="w-full">
                        <SelectValue>
                          {(v: string) =>
                            v === "a4" ? t("settings.formatA4") : t("settings.formatPos80")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pos80">{t("settings.formatPos80")}</SelectItem>
                        <SelectItem value="a4">{t("settings.formatA4")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label={t("settings.breakdown")} hint={t("settings.breakdownDesc")} htmlFor="s-breakdown">
                    <div className="flex justify-end">
                      <Switch
                        id="s-breakdown"
                        checked={form.show_tax_breakdown === 1}
                        onCheckedChange={(v) => set("show_tax_breakdown", v ? 1 : 0)}
                      />
                    </div>
                  </Row>
                </Card>

                <Button variant="outline" size="sm" className="mt-4" onClick={() => void downloadSample()}>
                  <Download />
                  {t("settings.samplePdf")}
                </Button>
              </div>

              <div className="lg:sticky lg:top-0 lg:self-start">
                <div className="overflow-hidden rounded-xl border border-border bg-white text-zinc-900 shadow-sm">
                  <div className="p-5">
                    <div className="text-center">
                      <div className="truncate text-sm font-bold">
                        {form.restaurant_name || "—"}
                      </div>
                      {form.address ? (
                        <div className="mt-0.5 truncate text-[0.65rem] text-zinc-500">
                          {form.address}
                        </div>
                      ) : null}
                      {form.phone ? (
                        <div className="truncate text-[0.65rem] text-zinc-500">{form.phone}</div>
                      ) : null}
                      <div className="mt-1 font-mono text-[0.6rem] text-zinc-500">
                        {t("settings.sampleRef").toUpperCase()} · {labels.table} 04
                      </div>
                    </div>

                    {form.ticket_header ? (
                      <p className="mt-2.5 whitespace-pre-line text-center text-[0.65rem] text-zinc-700">
                        {form.ticket_header}
                      </p>
                    ) : null}

                    <div className="mt-3 h-px bg-zinc-900" />

                    <div className="mt-2.5 flex flex-col gap-1.5">
                      {sample.lines.map((l) => (
                        <div key={l.name} className="text-[0.65rem]">
                          <div className="truncate">{l.name}</div>
                          <div className="flex justify-between text-zinc-500">
                            <span className="font-mono">
                              {l.quantity} x {money(l.unitPriceCents)}
                            </span>
                            <span className="font-mono tabular-nums text-zinc-900">
                              {money(l.subtotalCents)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 h-px bg-zinc-200" />

                    <div className="mt-2.5 flex flex-col gap-0.5 text-[0.65rem]">
                      <div className="flex justify-between text-zinc-500">
                        <span>{labels.subtotal}</span>
                        <span className="font-mono tabular-nums text-zinc-900">
                          {money(sample.subtotalCents)}
                        </span>
                      </div>
                      {form.show_tax_breakdown === 1 ? (
                        sample.taxBreakdown.map((x) => (
                          <div key={x.bp} className="flex justify-between text-zinc-500">
                            <span>
                              {labels.taxShort} {formatBp(x.bp)}
                            </span>
                            <span className="font-mono tabular-nums text-zinc-900">
                              {money(x.tax)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between text-zinc-500">
                          <span>{labels.taxes}</span>
                          <span className="font-mono tabular-nums text-zinc-900">
                            {money(sample.taxCents)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between border-t border-zinc-900 pt-2">
                      <span className="text-xs font-bold">
                        {labels.total.toUpperCase()}
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums">
                        {money(sample.totalCents)}
                      </span>
                    </div>

                    {form.ticket_footer ? (
                      <p className="mt-4 whitespace-pre-line text-center text-[0.65rem] text-zinc-500">
                        {form.ticket_footer}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-snug text-muted-foreground">
                  {t("settings.previewNote")}
                </p>
              </div>
            </div>
          ) : null}

          {tab === "sync" ? <SyncSettings /> : null}

          {tab === "appearance" ? (
            <div className="max-w-2xl">
              <div className="grid gap-2.5 sm:grid-cols-3">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPalette(p.id)}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-colors duration-150",
                      palette === p.id
                        ? "border-primary bg-accent/40"
                        : "border-border hover:border-primary/40 hover:bg-accent/20",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {p.swatches.map((s) => (
                          <span
                            key={s}
                            className="size-4 rounded-full border border-black/10"
                            style={{ background: s }}
                          />
                        ))}
                      </div>
                      {palette === p.id ? <Check className="size-3.5 text-primary" /> : null}
                    </div>
                    <div className="mt-2.5 text-[13px] font-medium tracking-tight">{p.name}</div>
                    <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {p.description}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <Card>
                  <Row label={t("appearance.dark")} hint={t("appearance.darkHint")} htmlFor="s-dark">
                    <div className="flex justify-end">
                      <Switch id="s-dark" checked={dark} onCheckedChange={toggle} />
                    </div>
                  </Row>
                  <Row label={t("appearance.language")} hint={t("appearance.languageHintLocal")} htmlFor="s-lang">
                    <Select
                      value={lang}
                      onValueChange={(v: string | null) => {
                        if (v === "es" || v === "en") void setLang(v);
                      }}
                    >
                      <SelectTrigger id="s-lang" className="w-full">
                        <SelectValue>
                          {(v: string) => LANGS.find((l) => l.id === v)?.label ?? v}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {LANGS.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );
}
