import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, MapPin, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { exec, newId, query } from "@/lib/db";
import { useFloor } from "@/providers/floor-provider";
import { useI18n } from "@/providers/i18n-provider";
import type { TableRow } from "@/types/local";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FormState {
  id?: string;
  number: string;
  capacity: string;
  zoneId: string;
}

export function TablesRoute() {
  const { t } = useI18n();
  const { reload, zones } = useFloor();

  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TableRow | null>(null);
  const [bulkCount, setBulkCount] = useState("10");
  const [bulkFrom, setBulkFrom] = useState("1");
  const [bulkZone, setBulkZone] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setRows(
      await query<TableRow>("SELECT * FROM tables WHERE number > 0 ORDER BY number"),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    const number = Number.parseInt(form.number, 10);
    const capacity = Number.parseInt(form.capacity, 10);
    if (!Number.isFinite(number) || number < 1) {
      toast.error(t("tables.badNumber"));
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 1) {
      toast.error(t("tables.badCapacity"));
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        await exec(
          "UPDATE tables SET number = $1, capacity = $2, zone_id = $3 WHERE id = $4",
          [number, capacity, form.zoneId || null, form.id],
        );
      } else {
        await exec(
          "INSERT INTO tables (id, number, capacity, zone_id) VALUES ($1, $2, $3, $4)",
          [newId(), number, capacity, form.zoneId || null],
        );
      }
      toast.success(t("tables.saved"));
      setForm(null);
      await load();
      await reload();
    } catch (e) {
      // El número de mesa es único: dos mesas con el mismo número harían
      // imposible saber cuál se está cobrando.
      toast.error(
        String(e).includes("UNIQUE")
          ? t("tables.duplicate", { n: number })
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setSaving(false);
    }
  };

  /** Instalación nueva: crear el salón entero de golpe en vez de una a una. */
  const createBulk = async () => {
    const count = Number.parseInt(bulkCount, 10);
    if (!Number.isFinite(count) || count < 1 || count > 200) {
      toast.error(t("tables.badBulk"));
      return;
    }

    // El número de inicio es lo que hace usable la barra: los taburetes se
    // numeran del 101 en adelante y no se mezclan con las mesas del salón.
    const from = Math.max(1, Number.parseInt(bulkFrom, 10) || 1);

    setSaving(true);
    try {
      const taken = new Set(rows.map((r) => r.number));
      let created = 0;
      for (let n = from; created < count && n < from + 500; n++) {
        if (taken.has(n)) continue; // no pisar las que ya existen
        await exec(
          "INSERT INTO tables (id, number, capacity, zone_id) VALUES ($1, $2, 4, $3)",
          [newId(), n, bulkZone || null],
        );
        created++;
      }
      toast.success(t("tables.bulkDone", { n: created }));
      setBulkOpen(false);
      await load();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await exec("DELETE FROM tables WHERE id = $1", [pendingDelete.id]);
      toast.success(t("tables.deleted"));
      await load();
      await reload();
    } catch (e) {
      // ON DELETE RESTRICT: una mesa con cuentas en el historial no se borra,
      // porque esas cuentas dejarían de saber a qué mesa pertenecían.
      toast.error(
        String(e).includes("FOREIGN KEY")
          ? t("tables.inUse")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
    setPendingDelete(null);
  };

  return (
    <>
      <PageHeader
        title={t("tables.title")}
        description={t("tables.count", { n: rows.length })}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoneOpen(true)}>
              <MapPin />
              {t("print.newZone")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <Wand2 />
              {t("tables.bulk")}
            </Button>
            <Button
              size="sm"
              onClick={() => setForm({ number: "", capacity: "4", zoneId: "" })}
            >
              <Plus />
              {t("tables.new")}
            </Button>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-sm font-semibold">{t("tables.empty")}</p>
              <Button className="mt-5" onClick={() => setBulkOpen(true)}>
                <Wand2 />
                {t("tables.bulk")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {rows.map((table) => (
                <div
                  key={table.id}
                  className={cn(
                    "raised group flex flex-col justify-between rounded-xl border border-border bg-card p-3",
                    table.status !== "available" && "border-status-busy/40",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight">
                      {String(table.number).padStart(2, "0")}
                    </span>
                    <div className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("common.edit")}
                        onClick={() =>
                          setForm({
                            id: table.id,
                            number: String(table.number),
                            capacity: String(table.capacity),
                            zoneId: table.zone_id ?? "",
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("common.delete")}
                        onClick={() => setPendingDelete(table)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <span className="mt-2 truncate text-xs text-muted-foreground">
                    {t("tables.seats", { n: table.capacity })}
                    {table.zone_id
                      ? ` · ${zones.find((z) => z.id === table.zone_id)?.name ?? ""}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? t("tables.edit") : t("tables.new")}
            </DialogTitle>
          </DialogHeader>

          {form ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="tb-num">{t("tables.number")}</Label>
                <Input
                  id="tb-num"
                  autoFocus
                  inputMode="numeric"
                  value={form.number}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      number: e.currentTarget.value.replace(/\D/g, "").slice(0, 3),
                    })
                  }
                  className="text-center font-mono text-lg tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tb-cap">{t("tables.capacity")}</Label>
                <Input
                  id="tb-cap"
                  inputMode="numeric"
                  value={form.capacity}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      capacity: e.currentTarget.value.replace(/\D/g, "").slice(0, 2),
                    })
                  }
                  className="text-center font-mono text-lg tabular-nums"
                />
              </div>

              {/* La zona decide a qué barra o cocina se manda la comanda de
                  esta mesa. Con una sola sala no hace falta tocarla. */}
              {zones.length > 0 ? (
                <div className="col-span-2 flex flex-col gap-2">
                  <Label>{t("print.zone")}</Label>
                  <Select
                    value={form.zoneId}
                    onValueChange={(v: string | null) =>
                      setForm({ ...form, zoneId: v ?? "" })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          zones.find((z) => z.id === v)?.name ?? t("floor.noZone")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t("floor.noZone")}</SelectItem>
                      {zones.map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          {z.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={(o) => !o && setBulkOpen(false)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("tables.bulk")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="tb-bulk">{t("tables.howMany")}</Label>
                <Input
                  id="tb-bulk"
                  autoFocus
                  inputMode="numeric"
                  value={bulkCount}
                  onChange={(e) =>
                    setBulkCount(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))
                  }
                  className="text-center font-mono text-lg tabular-nums"
                />
              </div>
              {/* Numerar desde 101 es lo que separa los taburetes de barra de
                  las mesas del salón sin inventar un tipo nuevo de mesa. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="tb-from">{t("tables.startAt")}</Label>
                <Input
                  id="tb-from"
                  inputMode="numeric"
                  value={bulkFrom}
                  onChange={(e) =>
                    setBulkFrom(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))
                  }
                  className="text-center font-mono text-lg tabular-nums"
                />
              </div>
            </div>

            {zones.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Label>{t("print.zone")}</Label>
                <Select
                  value={bulkZone}
                  onValueChange={(v: string | null) => setBulkZone(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) =>
                        zones.find((z) => z.id === v)?.name ?? t("floor.noZone")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("floor.noZone")}</SelectItem>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void createBulk()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
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
                try {
                  await exec("INSERT INTO zones (id, name) VALUES ($1, $2)", [
                    newId(),
                    zoneName.trim(),
                  ]);
                  setZoneName("");
                  setZoneOpen(false);
                  await reload();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tables.deleteTitle", { n: pendingDelete?.number ?? "—" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tables.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
