import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, MapPin, Plus, Printer, Route, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { exec, newId, query, queryOne } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { RECEIPT_GROUP } from "@/features/printing/blocks";
import type { PrinterRoutingRow, PrinterRow, ZoneRow } from "@/types/local";

/** Papel de 80 mm y de 58 mm: los dos anchos que existen en la práctica. */
const WIDTHS = [
  { chars: 48, label: "80 mm" },
  { chars: 32, label: "58 mm" },
];

const CODEPAGES = [
  { value: 2, label: "CP850" },
  { value: 19, label: "CP858" },
  { value: 16, label: "CP1252" },
  { value: 0, label: "PC437" },
];

const CUTS = ["partial", "full", "none"] as const;

interface PrinterForm {
  id?: string;
  name: string;
  address: string;
  port: string;
  width_chars: number;
  codepage: number;
  cut_mode: string;
  opens_drawer: boolean;
  active: boolean;
}

const EMPTY: PrinterForm = {
  name: "",
  address: "",
  port: "9100",
  width_chars: 48,
  codepage: 2,
  cut_mode: "partial",
  opens_drawer: true,
  active: true,
};

/**
 * Impresoras, zonas y a quién le toca cada comanda.
 *
 * La IP nunca vive en el producto. El producto dice QUÉ es —bebida, cocina
 * caliente— y una regla aparte dice a dónde va eso en cada planta. Así cambiar
 * una impresora de sitio se arregla en una fila, y no repasando la carta entera.
 */
export function PrintersRoute() {
  const { t } = useI18n();

  const [printers, setPrinters] = useState<PrinterRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [routes, setRoutes] = useState<PrinterRoutingRow[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [terminalZone, setTerminalZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<PrinterForm | null>(null);
  const [zoneName, setZoneName] = useState("");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  // Era la única papelera de la aplicación que borraba en el clic. Que a veces
  // pregunte y a veces no enseña a no leer el diálogo cuando sí aparece.
  const [pendingRoute, setPendingRoute] = useState<PrinterRoutingRow | null>(null);
  const [routeDraft, setRouteDraft] = useState({
    zone_id: "",
    print_group: RECEIPT_GROUP,
    printer_id: "",
  });

  const load = useCallback(async () => {
    const [p, z, r, g, ctx] = await Promise.all([
      query<PrinterRow>("SELECT * FROM printers ORDER BY name"),
      query<ZoneRow>("SELECT * FROM zones ORDER BY name"),
      query<PrinterRoutingRow>("SELECT * FROM printer_routing"),
      query<{ print_group: string }>(
        "SELECT DISTINCT print_group FROM products ORDER BY print_group",
      ),
      queryOne<{ zone_id: string | null }>(
        "SELECT zone_id FROM sync_context WHERE id = 1",
      ),
    ]);
    setPrinters(p);
    setZones(z);
    setRoutes(r);
    // El grupo del ticket del cliente no sale de la carta: es fijo.
    setGroups([RECEIPT_GROUP, ...g.map((x) => x.print_group)]);
    setTerminalZone(ctx?.zone_id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrinter = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.address.trim()) {
      return toast.error(t("print.nameAndAddress"));
    }
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return toast.error(t("print.badPort"));
    }

    setBusy(true);
    try {
      const values = [
        form.name.trim(),
        form.address.trim(),
        port,
        form.width_chars,
        form.codepage,
        form.cut_mode,
        form.opens_drawer ? 1 : 0,
        form.active ? 1 : 0,
      ];
      if (form.id) {
        await exec(
          `UPDATE printers SET name=$1, address=$2, port=$3, width_chars=$4,
                  codepage=$5, cut_mode=$6, opens_drawer=$7, active=$8
            WHERE id=$9`,
          [...values, form.id],
        );
      } else {
        await exec(
          `INSERT INTO printers (name, address, port, width_chars, codepage,
                                 cut_mode, opens_drawer, active, id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [...values, newId()],
        );
      }
      toast.success(t("print.saved"));
      setForm(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async (p: PrinterRow) => {
    setBusy(true);
    try {
      await invoke("printer_test", {
        config: {
          address: p.address,
          port: p.port,
          width_chars: p.width_chars,
          codepage: p.codepage,
          cut_mode: p.cut_mode,
        },
      });
      toast.success(t("print.testSent"));
    } catch (e) {
      toast.error(t("print.failed", { n: p.name }), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const setTerminal = async (zoneId: string | null) => {
    try {
      await exec("UPDATE sync_context SET zone_id = $1 WHERE id = 1", [zoneId]);
      setTerminalZone(zoneId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const addRoute = async () => {
    if (!routeDraft.printer_id || !routeDraft.print_group) return;
    try {
      await exec(
        `INSERT INTO printer_routing (id, zone_id, print_group, printer_id)
         VALUES ($1, $2, $3, $4)`,
        [
          newId(),
          routeDraft.zone_id || null,
          routeDraft.print_group,
          routeDraft.printer_id,
        ],
      );
      setRouteOpen(false);
      await load();
    } catch (e) {
      toast.error(
        String(e).includes("UNIQUE") ? t("print.routeExists") : String(e),
      );
    }
  };

  const zoneName_ = (id: string | null) =>
    id ? (zones.find((z) => z.id === id)?.name ?? "—") : t("print.anyZone");

  return (
    <>
      <PageHeader
        title={t("print.title")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoneOpen(true)}>
              <MapPin />
              {t("print.newZone")}
            </Button>
            <Button size="sm" onClick={() => setForm({ ...EMPTY })}>
              <Plus />
              {t("print.newPrinter")}
            </Button>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex max-w-3xl flex-col gap-6 p-4">
          {/* Dónde está este terminal. Decide por qué impresora sale el ticket
              del cliente y qué cajón se abre. */}
          <div className="raised rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <Label className="text-[13px]">{t("print.terminalZone")}</Label>
              </div>
              <Select
                value={terminalZone ?? ""}
                onValueChange={(v: string | null) => void setTerminal(v || null)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue>{(v: string) => zoneName_(v || null)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("print.anyZone")}</SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <section>
            <p className="mb-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("print.printers")}
            </p>
            {loading ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : printers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <Printer className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("print.noPrinters")}
                </p>
              </div>
            ) : (
              <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
                {printers.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5",
                      p.active === 0 && "opacity-50",
                    )}
                  >
                    <Printer className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium tracking-tight">{p.name}</div>
                      <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                        {p.address}:{p.port} ·{" "}
                        {WIDTHS.find((w) => w.chars === p.width_chars)?.label ??
                          `${p.width_chars}c`}{" "}
                        · {CODEPAGES.find((c) => c.value === p.codepage)?.label}
                        {p.opens_drawer ? ` · ${t("print.drawer")}` : ""}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() => void testPrint(p)}
                    >
                      {t("print.test")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setForm({
                          id: p.id,
                          name: p.name,
                          address: p.address,
                          port: String(p.port),
                          width_chars: p.width_chars,
                          codepage: p.codepage,
                          cut_mode: p.cut_mode,
                          opens_drawer: p.opens_drawer === 1,
                          active: p.active === 1,
                        })
                      }
                    >
                      {t("common.edit")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("print.routing")}
              </p>
              <Button
                variant="ghost"
                size="xs"
                disabled={printers.length === 0}
                onClick={() => {
                  setRouteDraft({
                    zone_id: "",
                    print_group: RECEIPT_GROUP,
                    printer_id: printers[0]?.id ?? "",
                  });
                  setRouteOpen(true);
                }}
              >
                <Route />
                {t("print.newRoute")}
              </Button>
            </div>

            {routes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">{t("print.noRoutes")}</p>
              </div>
            ) : (
              <div className="raised divide-y divide-border rounded-xl border border-border bg-card">
                {routes.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                      {zoneName_(r.zone_id)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium tracking-tight">
                      {r.print_group}
                    </span>
                    <span className="shrink-0 text-muted-foreground">→</span>
                    <span className="w-40 shrink-0 truncate text-right">
                      {printers.find((p) => p.id === r.printer_id)?.name ?? "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.delete")}
                      onClick={() => setPendingRoute(r)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? t("print.editPrinter") : t("print.newPrinter")}
            </DialogTitle>
          </DialogHeader>

          {form ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pr-name">{t("print.name")}</Label>
                <Input
                  id="pr-name"
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                  placeholder="Barra planta 1"
                />
              </div>

              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pr-addr">{t("print.address")}</Label>
                  <Input
                    id="pr-addr"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
                    placeholder="192.168.1.50"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pr-port">{t("print.port")}</Label>
                  <Input
                    id="pr-port"
                    inputMode="numeric"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.currentTarget.value })}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-2">
                  <Label>{t("print.paper")}</Label>
                  <Select
                    value={String(form.width_chars)}
                    onValueChange={(v: string | null) =>
                      v && setForm({ ...form, width_chars: Number(v) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          WIDTHS.find((w) => String(w.chars) === v)?.label ?? v
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WIDTHS.map((w) => (
                        <SelectItem key={w.chars} value={String(w.chars)}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("print.codepage")}</Label>
                  <Select
                    value={String(form.codepage)}
                    onValueChange={(v: string | null) =>
                      v && setForm({ ...form, codepage: Number(v) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          CODEPAGES.find((c) => String(c.value) === v)?.label ?? v
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CODEPAGES.map((c) => (
                        <SelectItem key={c.value} value={String(c.value)}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("print.cut")}</Label>
                  <Select
                    value={form.cut_mode}
                    onValueChange={(v: string | null) =>
                      v && setForm({ ...form, cut_mode: v })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{(v: string) => t(`print.cut.${v}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CUTS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`print.cut.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <Label htmlFor="pr-drawer">{t("print.drawer")}</Label>
                </div>
                <Switch
                  id="pr-drawer"
                  checked={form.opens_drawer}
                  onCheckedChange={(v) => setForm({ ...form, opens_drawer: v })}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <Label htmlFor="pr-active">{t("inv.active")}</Label>
                <Switch
                  id="pr-active"
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void savePrinter()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zoneOpen} onOpenChange={(o) => !o && setZoneOpen(false)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("print.newZone")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={zoneName}
            onChange={(e) => setZoneName(e.currentTarget.value)}
            placeholder="Planta 1"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={async () => {
                if (!zoneName.trim()) return;
                await exec("INSERT INTO zones (id, name) VALUES ($1, $2)", [
                  newId(),
                  zoneName.trim(),
                ]);
                setZoneName("");
                setZoneOpen(false);
                await load();
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={routeOpen} onOpenChange={(o) => !o && setRouteOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("print.newRoute")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-2">
              <Label>{t("print.zone")}</Label>
              <Select
                value={routeDraft.zone_id}
                onValueChange={(v: string | null) =>
                  setRouteDraft({ ...routeDraft, zone_id: v ?? "" })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => zoneName_(v || null)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("print.anyZone")}</SelectItem>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("print.group")}</Label>
              <Select
                value={routeDraft.print_group}
                onValueChange={(v: string | null) =>
                  v && setRouteDraft({ ...routeDraft, print_group: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("print.printer")}</Label>
              <Select
                value={routeDraft.printer_id}
                onValueChange={(v: string | null) =>
                  v && setRouteDraft({ ...routeDraft, printer_id: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => printers.find((p) => p.id === v)?.name ?? "—"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRouteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void addRoute()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRoute !== null}
        onOpenChange={(o) => !o && setPendingRoute(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("print.deleteRouteTitle", {
                g: pendingRoute?.print_group ?? "—",
                p:
                  printers.find((p) => p.id === pendingRoute?.printer_id)?.name ??
                  "—",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("print.deleteRouteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingRoute) return;
                await exec("DELETE FROM printer_routing WHERE id = $1", [
                  pendingRoute.id,
                ]);
                setPendingRoute(null);
                await load();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
