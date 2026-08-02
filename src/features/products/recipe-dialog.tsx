import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Wand2, X } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { newId, query, queryOne, transaction, type Statement } from "@/lib/db";
import { formatMilli, parseMilli } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import type { InventoryItemRow, ProductRow } from "@/types/local";

interface Line {
  item_id: string;
  /** Texto crudo del campo: se valida al guardar, no mientras se teclea. */
  quantity: string;
}

export function RecipeDialog({
  product,
  onOpenChange,
}: {
  product: ProductRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<InventoryItemRow[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (productId: string) => {
    const [itemRows, recipeRows] = await Promise.all([
      query<InventoryItemRow>(
        "SELECT * FROM inventory_items WHERE active = 1 ORDER BY name",
      ),
      query<{ item_id: string; quantity_milli: number }>(
        "SELECT item_id, quantity_milli FROM product_recipe WHERE product_id = $1",
        [productId],
      ),
    ]);
    setItems(itemRows);
    setLines(
      recipeRows.map((r) => ({
        item_id: r.item_id,
        quantity: formatMilli(r.quantity_milli),
      })),
    );
  }, []);

  useEffect(() => {
    if (!product) {
      setItems(null);
      setLines([]);
      return;
    }
    void load(product.id).catch((e) => {
      toast.error(e instanceof Error ? e.message : String(e));
      setItems([]);
    });
  }, [product, load]);

  const available = useMemo(
    () => (items ?? []).filter((i) => !lines.some((l) => l.item_id === i.id)),
    [items, lines],
  );

  const unitOf = (id: string) => items?.find((i) => i.id === id)?.unit ?? "";
  const nameOf = (id: string) => items?.find((i) => i.id === id)?.name ?? "—";

  /**
   * Atajo para bebidas embotelladas y similares: crea el insumo con el nombre
   * del producto y la receta 1:1 de una vez. Sin esto había que decir a mano,
   * en tres pasos, que «una Coca-Cola gasta una Coca-Cola».
   */
  const trackOneToOne = async () => {
    if (!product) return;
    setSaving(true);
    try {
      // Reutilizar el insumo si ya existe con ese nombre: pulsar el atajo dos
      // veces no debe dejar dos «Coca-Cola» distintos en el inventario.
      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM inventory_items WHERE name = $1 COLLATE NOCASE LIMIT 1",
        [product.name],
      );
      const itemId = existing?.id ?? newId();

      const statements: Statement[] = [];
      if (!existing) {
        statements.push({
          sql: `INSERT INTO inventory_items (id, name, unit, unit_cost_cents)
                VALUES ($1, $2, 'unidad', 0)`,
          values: [itemId, product.name],
        });
      }
      statements.push({
        sql: `INSERT INTO product_recipe (product_id, item_id, quantity_milli)
              VALUES ($1, $2, 1000)
              ON CONFLICT (product_id, item_id)
              DO UPDATE SET quantity_milli = 1000`,
        values: [product.id, itemId],
      });

      await transaction(statements);
      toast.success(t("recipe.saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!product) return;

    const parsed = lines
      .map((l) => ({ item_id: l.item_id, milli: parseMilli(l.quantity) }))
      .filter((l): l is { item_id: string; milli: number } => (l.milli ?? 0) > 0);

    setSaving(true);
    try {
      const statements: Statement[] = parsed.map((line) => ({
        sql: `INSERT INTO product_recipe (product_id, item_id, quantity_milli)
              VALUES ($1, $2, $3)
              ON CONFLICT (product_id, item_id)
              DO UPDATE SET quantity_milli = excluded.quantity_milli`,
        values: [product.id, line.item_id, line.milli],
      }));

      // Borrar lo que ya no está, dentro de la misma transacción: si esto
      // fallara por separado el producto podría quedarse descontando un
      // insumo que el usuario acaba de quitar.
      const keep = parsed.map((l) => l.item_id);
      if (keep.length === 0) {
        statements.push({
          sql: "DELETE FROM product_recipe WHERE product_id = $1",
          values: [product.id],
        });
      } else {
        const holes = keep.map((_, i) => `$${i + 2}`).join(", ");
        statements.push({
          sql: `DELETE FROM product_recipe
                 WHERE product_id = $1 AND item_id NOT IN (${holes})`,
          values: [product.id, ...keep],
        });
      }

      await transaction(statements);
      toast.success(t("recipe.saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("recipe.title", { n: product?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("recipe.desc")}</DialogDescription>
        </DialogHeader>

        {items === null ? (
          <Skeleton className="h-32 rounded-md" />
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-5 text-center">
                <p className="text-sm text-muted-foreground">
                  {items.length === 0 ? t("recipe.noItems") : t("recipe.empty")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void trackOneToOne()}
                  disabled={saving}
                >
                  <Wand2 />
                  {t("recipe.quickTrack")}
                </Button>
              </div>
            ) : null}

            {lines.map((line, idx) => (
              <div key={line.item_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {nameOf(line.item_id)}
                </span>
                <Input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => {
                    const next = lines.slice();
                    next[idx] = { ...line, quantity: e.currentTarget.value };
                    setLines(next);
                  }}
                  className="w-24 font-mono tabular-nums"
                />
                <span className="w-16 shrink-0 text-xs text-muted-foreground">
                  {unitOf(line.item_id)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.delete")}
                  onClick={() => setLines(lines.filter((l) => l.item_id !== line.item_id))}
                >
                  <X />
                </Button>
              </div>
            ))}

            {available.length > 0 ? (
              <Select
                value=""
                onValueChange={(v: string | null) => {
                  if (v) setLines([...lines, { item_id: v, quantity: "1" }]);
                }}
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue placeholder={t("recipe.add")}>
                    {() => (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Plus className="size-3.5" />
                        {t("recipe.add")}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {available.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} · {i.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <p className="mt-1 text-xs text-muted-foreground">{t("recipe.perUnit")}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || items === null || lines.length === 0}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
