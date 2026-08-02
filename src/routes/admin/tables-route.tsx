import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
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
  DialogDescription,
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

interface FormState {
  id?: string;
  number: string;
  capacity: string;
}

export function TablesRoute() {
  const { t } = useI18n();
  const { reload } = useFloor();

  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TableRow | null>(null);
  const [bulkCount, setBulkCount] = useState("10");
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setRows(await query<TableRow>("SELECT * FROM tables ORDER BY number"));
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
        await exec("UPDATE tables SET number = $1, capacity = $2 WHERE id = $3", [
          number,
          capacity,
          form.id,
        ]);
      } else {
        await exec(
          "INSERT INTO tables (id, number, capacity) VALUES ($1, $2, $3)",
          [newId(), number, capacity],
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

    setSaving(true);
    try {
      const taken = new Set(rows.map((r) => r.number));
      let created = 0;
      for (let n = 1; created < count; n++) {
        if (taken.has(n)) continue; // no pisar las que ya existen
        await exec(
          "INSERT INTO tables (id, number, capacity) VALUES ($1, $2, 4)",
          [newId(), n],
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
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <Wand2 />
              {t("tables.bulk")}
            </Button>
            <Button
              size="sm"
              onClick={() => setForm({ number: "", capacity: "4" })}
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
                  <span className="mt-2 text-xs text-muted-foreground">
                    {t("tables.seats", { n: table.capacity })}
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
            <DialogDescription>{t("tables.bulkHint")}</DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Label htmlFor="tb-bulk">{t("tables.howMany")}</Label>
            <Input
              id="tb-bulk"
              autoFocus
              inputMode="numeric"
              value={bulkCount}
              onChange={(e) =>
                setBulkCount(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))
              }
              className="mt-2 text-center font-mono text-lg tabular-nums"
            />
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
