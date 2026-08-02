import { useCallback, useEffect, useMemo, useState } from "react";
import { History, LoaderCircle, Pencil, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exec, newId, query } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { centsToInput, formatMilli, parseCents, parseMilli } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import {
  MANUAL_MOVEMENT_KINDS,
  type InventoryItemRow,
  type InventoryMovementRow,
  type MovementKind,
} from "@/types/local";

interface ItemForm {
  id?: string;
  name: string;
  unit: string;
  minStock: string;
  unitCost: string;
  active: boolean;
}

const EMPTY_ITEM: ItemForm = {
  name: "",
  unit: "unidad",
  minStock: "0",
  unitCost: "0",
  active: true,
};

export function InventoryRoute() {
  const { staff } = useSession();
  const { t } = useI18n();

  const [rows, setRows] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [saving, setSaving] = useState(false);

  const [moveFor, setMoveFor] = useState<InventoryItemRow | null>(null);
  const [moveQty, setMoveQty] = useState("");
  const [moveKind, setMoveKind] = useState<MovementKind>("purchase");
  const [moveNote, setMoveNote] = useState("");

  const [historyFor, setHistoryFor] = useState<InventoryItemRow | null>(null);
  const [history, setHistory] = useState<InventoryMovementRow[] | null>(null);

  const load = useCallback(async () => {
    setRows(
      await query<InventoryItemRow>("SELECT * FROM inventory_items ORDER BY name"),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!historyFor) {
      setHistory(null);
      return;
    }
    let alive = true;
    void query<InventoryMovementRow>(
      `SELECT * FROM inventory_movements
        WHERE item_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [historyFor.id],
    ).then((rowsOut) => {
      if (alive) setHistory(rowsOut);
    });
    return () => {
      alive = false;
    };
  }, [historyFor]);

  const lowStock = useMemo(
    () =>
      rows.filter(
        (r) => r.active === 1 && r.min_stock_milli > 0 && r.stock_milli <= r.min_stock_milli,
      ),
    [rows],
  );

  const saveItem = async () => {
    if (!itemForm) return;
    if (!itemForm.name.trim()) return toast.error(t("inv.nameRequired"));

    // El esquema exige mínimo >= 0; recortarlo aquí evita que un «-1» escrito
    // por error vuelva como un CHECK constraint que no dice nada al usuario.
    const minStock = Math.max(0, parseMilli(itemForm.minStock) ?? 0);
    const unitCost = parseCents(itemForm.unitCost) ?? 0;

    setSaving(true);
    try {
      if (itemForm.id) {
        await exec(
          `UPDATE inventory_items
              SET name = $1, unit = $2, min_stock_milli = $3,
                  unit_cost_cents = $4, active = $5
            WHERE id = $6`,
          [
            itemForm.name.trim(),
            itemForm.unit.trim() || "unidad",
            minStock,
            unitCost,
            itemForm.active ? 1 : 0,
            itemForm.id,
          ],
        );
      } else {
        await exec(
          `INSERT INTO inventory_items
             (id, name, unit, min_stock_milli, unit_cost_cents, active)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            newId(),
            itemForm.name.trim(),
            itemForm.unit.trim() || "unidad",
            minStock,
            unitCost,
            itemForm.active ? 1 : 0,
          ],
        );
      }
      toast.success(t("inv.saved"));
      setItemForm(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveMovement = async () => {
    if (!moveFor) return;
    const milli = parseMilli(moveQty);
    if (milli === null || milli === 0) return toast.error(t("inv.invalidQty"));

    setSaving(true);
    try {
      await exec(
        `INSERT INTO inventory_movements
           (id, item_id, quantity_milli, kind, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), moveFor.id, milli, moveKind, moveNote.trim() || null, staff?.id ?? null],
      );
      toast.success(t("inv.movementSaved"));
      setMoveFor(null);
      setMoveQty("");
      setMoveNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("inv.title")}
        description={t("inv.count", { n: rows.length })}
        actions={
          <div className="flex items-center gap-2.5">
            {lowStock.length > 0 ? (
              <span className="flex items-center gap-1.5 rounded-full bg-status-billed-soft px-2.5 py-0.5 text-xs font-medium text-status-billed">
                <TriangleAlert className="size-3" />
                {t("inv.lowStockCount", { n: lowStock.length })}
              </span>
            ) : null}
            <Button size="sm" onClick={() => setItemForm({ ...EMPTY_ITEM })}>
              <Plus />
              {t("inv.new")}
            </Button>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">{t("inv.empty")}</p>
            </div>
          ) : (
            <div className="raised rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("inv.name")}</TableHead>
                    <TableHead className="w-24">{t("inv.unit")}</TableHead>
                    <TableHead className="w-32 text-right">{t("inv.stock")}</TableHead>
                    <TableHead className="w-28 text-right">{t("inv.minStock")}</TableHead>
                    <TableHead className="w-32 text-right">{t("inv.unitCost")}</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => {
                    const low =
                      item.active === 1 &&
                      item.min_stock_milli > 0 &&
                      item.stock_milli <= item.min_stock_milli;
                    return (
                      <TableRow key={item.id} className={cn(item.active === 0 && "opacity-50")}>
                        <TableCell className="font-medium tracking-tight">{item.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              low && "font-semibold text-status-billed",
                            )}
                          >
                            {formatMilli(item.stock_milli)}
                          </span>
                          {low ? (
                            <TriangleAlert className="ml-1.5 inline size-3 text-status-billed" />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {item.min_stock_milli > 0 ? formatMilli(item.min_stock_milli) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCents(item.unit_cost_cents)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("inv.movement")}
                              aria-label={t("inv.movement")}
                              onClick={() => {
                                setMoveKind("purchase");
                                setMoveQty("");
                                setMoveNote("");
                                setMoveFor(item);
                              }}
                            >
                              <Plus />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("inv.history")}
                              aria-label={t("inv.history")}
                              onClick={() => setHistoryFor(item)}
                            >
                              <History />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("common.edit")}
                              aria-label={t("common.edit")}
                              onClick={() =>
                                setItemForm({
                                  id: item.id,
                                  name: item.name,
                                  unit: item.unit,
                                  minStock: formatMilli(item.min_stock_milli),
                                  unitCost: centsToInput(item.unit_cost_cents),
                                  active: item.active === 1,
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}        </div>
      </ScrollArea>

      <Dialog open={itemForm !== null} onOpenChange={(o) => !o && setItemForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{itemForm?.id ? t("inv.edit") : t("inv.new")}</DialogTitle>
          </DialogHeader>

          {itemForm ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="i-name">{t("inv.name")}</Label>
                <Input
                  id="i-name"
                  autoFocus
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.currentTarget.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="i-unit">{t("inv.unit")}</Label>
                  <Input
                    id="i-unit"
                    list="inv-units"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.currentTarget.value })}
                    placeholder={t("inv.unitHint")}
                  />
                  <datalist id="inv-units">
                    {["unidad", "kg", "g", "L", "ml", "caja", "botella"].map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="i-cost">{t("inv.unitCost")}</Label>
                  <Input
                    id="i-cost"
                    inputMode="decimal"
                    value={itemForm.unitCost}
                    onChange={(e) => setItemForm({ ...itemForm, unitCost: e.currentTarget.value })}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="i-min">{t("inv.minStock")}</Label>
                <Input
                  id="i-min"
                  inputMode="decimal"
                  value={itemForm.minStock}
                  onChange={(e) => setItemForm({ ...itemForm, minStock: e.currentTarget.value })}
                  className="font-mono tabular-nums"
                />
                <p className="text-xs text-muted-foreground">{t("inv.minStockHint")}</p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <Label htmlFor="i-active">{t("inv.active")}</Label>
                <Switch
                  id="i-active"
                  checked={itemForm.active}
                  onCheckedChange={(v) => setItemForm({ ...itemForm, active: v })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setItemForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveItem()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveFor !== null} onOpenChange={(o) => !o && setMoveFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inv.movement")}</DialogTitle>
            <DialogDescription>
              {moveFor?.name} · {moveFor?.unit}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="m-kind">{t("inv.kind")}</Label>
              <Select
                value={moveKind}
                onValueChange={(v: string | null) => {
                  if (v) setMoveKind(v as MovementKind);
                }}
              >
                <SelectTrigger id="m-kind">
                  <SelectValue>{(v: string) => t(`kind.${v}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_MOVEMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="m-qty">{t("inv.quantity")}</Label>
              <Input
                id="m-qty"
                autoFocus
                inputMode="decimal"
                value={moveQty}
                onChange={(e) => setMoveQty(e.currentTarget.value)}
                placeholder="0"
                className="font-mono tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{t("inv.quantityHint")}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="m-note">{t("inv.note")}</Label>
              <Input
                id="m-note"
                value={moveNote}
                onChange={(e) => setMoveNote(e.currentTarget.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveFor(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveMovement()} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyFor !== null} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inv.historyOf", { n: historyFor?.name ?? "" })}</DialogTitle>
          </DialogHeader>

          {history === null ? (
            <Skeleton className="h-40 rounded-md" />
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("inv.noHistory")}
            </p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <div className="divide-y divide-border">
                {history.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-xs font-medium tracking-tight">
                        {t(`kind.${m.kind}`)}
                      </div>
                      <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                        {m.created_at}
                        {m.note ? ` · ${m.note}` : ""}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm tabular-nums",
                        m.quantity_milli > 0 ? "text-status-free" : "text-status-billed",
                      )}
                    >
                      {m.quantity_milli > 0 ? "+" : ""}
                      {formatMilli(m.quantity_milli)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
