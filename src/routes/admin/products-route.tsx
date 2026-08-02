import { useCallback, useEffect, useState } from "react";
import { CookingPot, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow as Tr,
} from "@/components/ui/table";
import { exec, newId, query } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { bpToInput, centsToInput, formatBp, parseBp, parseCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useMenu } from "@/providers/menu-provider";
import { RecipeDialog } from "@/features/products/recipe-dialog";
import type { ProductRow } from "@/types/local";

interface FormState {
  id?: string;
  name: string;
  category: string;
  /** En decimal mientras se edita; se convierte a centavos al guardar. */
  price: string;
  /** Porcentaje mientras se edita; vacío = hereda la tasa de la casa. */
  taxPercent: string;
  available: boolean;
}

const EMPTY: FormState = {
  name: "",
  category: "",
  price: "",
  taxPercent: "",
  available: true,
};

export function ProductsRoute() {
  const { t } = useI18n();
  const { reload: reloadMenu } = useMenu();

  // La lista de administración NO usa el proveedor del menú: ese filtra a los
  // disponibles para el POS, y un gerente también tiene que ver lo oculto.
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null);
  const [recipeFor, setRecipeFor] = useState<ProductRow | null>(null);

  // Qué productos descuentan inventario. Se marca en la tabla porque, si no,
  // no hay forma de ver de un vistazo cuáles se están vendiendo «a ciegas».
  const [tracked, setTracked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [products, recipes] = await Promise.all([
      query<ProductRow>("SELECT * FROM products ORDER BY category, name"),
      query<{ product_id: string }>(
        "SELECT DISTINCT product_id FROM product_recipe",
      ),
    ]);
    setRows(products);
    setTracked(new Set(recipes.map((r) => r.product_id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form) return;

    const priceCents = parseCents(form.price);
    if (!form.name.trim() || priceCents === null) {
      toast.error(t("toast.nameAndPrice"));
      return;
    }

    // Vacío = hereda la tasa de la casa. Un valor inválido sí es un error.
    const raw = form.taxPercent.trim();
    const taxBp = raw === "" ? null : parseBp(raw);
    if (raw !== "" && taxBp === null) {
      toast.error(t("toast.taxPct"));
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        await exec(
          `UPDATE products
              SET name = $1, category = $2, price_cents = $3,
                  tax_bp = $4, available = $5
            WHERE id = $6`,
          [
            form.name.trim(),
            form.category.trim() || "General",
            priceCents,
            taxBp,
            form.available ? 1 : 0,
            form.id,
          ],
        );
      } else {
        await exec(
          `INSERT INTO products (id, name, category, price_cents, tax_bp, available)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            newId(),
            form.name.trim(),
            form.category.trim() || "General",
            priceCents,
            taxBp,
            form.available ? 1 : 0,
          ],
        );
      }
      toast.success(
        form.id ? t("toast.productUpdated") : t("toast.productCreated"),
      );
      setForm(null);
      await load();
      await reloadMenu();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await exec("DELETE FROM products WHERE id = $1", [pendingDelete.id]);
      toast.success(t("toast.productDeleted"));
      await load();
      await reloadMenu();
    } catch (e) {
      // La clave foránea con ON DELETE RESTRICT lo impide si ya se vendió:
      // borrarlo alteraría tickets ya emitidos.
      toast.error(
        String(e).includes("FOREIGN KEY")
          ? t("toast.productInUse")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
    setPendingDelete(null);
  };

  const toggleAvailable = async (product: ProductRow) => {
    setRows((prev) =>
      prev.map((p) =>
        p.id === product.id ? { ...p, available: p.available ? 0 : 1 } : p,
      ),
    );
    try {
      await exec("UPDATE products SET available = $1 WHERE id = $2", [
        product.available ? 0 : 1,
        product.id,
      ]);
      await reloadMenu();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await load();
    }
  };

  return (
    <>
      <PageHeader
        title={t("products.title")}
        description={t("products.count", { n: rows.length })}
        actions={
          <Button size="sm" onClick={() => setForm({ ...EMPTY })}>
            <Plus />
            {t("products.new")}
          </Button>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">{t("products.empty")}</p>
            </div>
          ) : (
            <div className="raised rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <Tr>
                    <TableHead>{t("products.name")}</TableHead>
                    <TableHead>{t("products.category")}</TableHead>
                    <TableHead className="text-right">{t("products.price")}</TableHead>
                    <TableHead className="text-right">{t("products.tax")}</TableHead>
                    <TableHead className="text-center">
                      {t("products.available")}
                    </TableHead>
                    <TableHead className="w-24" />
                  </Tr>
                </TableHeader>
                <TableBody>
                  {rows.map((product) => (
                    <Tr key={product.id}>
                      <TableCell className="font-medium tracking-tight">
                        {product.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[0.65rem]">
                          {product.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCents(product.price_cents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {product.tax_bp === null
                          ? t("products.default")
                          : formatBp(product.tax_bp)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={product.available === 1}
                          onCheckedChange={() => void toggleAvailable(product)}
                          aria-label={t("a11y.availability")}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("recipe.action")}
                            aria-label={t("recipe.action")}
                            className={
                              tracked.has(product.id)
                                ? "text-status-free"
                                : "text-muted-foreground/50"
                            }
                            onClick={() => setRecipeFor(product)}
                          >
                            <CookingPot />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("common.edit")}
                            aria-label={t("common.edit")}
                            onClick={() =>
                              setForm({
                                id: product.id,
                                name: product.name,
                                category: product.category,
                                price: centsToInput(product.price_cents),
                                taxPercent:
                                  product.tax_bp === null
                                    ? ""
                                    : bpToInput(product.tax_bp),
                                available: product.available === 1,
                              })
                            }
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            onClick={() => setPendingDelete(product)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}        </div>
      </ScrollArea>

      <RecipeDialog
        product={recipeFor}
        onOpenChange={(open) => {
          if (open) return;
          setRecipeFor(null);
          void load();
        }}
      />

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? t("products.edit") : t("products.new")}
            </DialogTitle>
            <DialogDescription>{t("products.dialogDesc")}</DialogDescription>
          </DialogHeader>

          {form ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="p-name">{t("products.name")}</Label>
                <Input
                  id="p-name"
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="p-cat">{t("products.category")}</Label>
                <Input
                  id="p-cat"
                  list="product-categories"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.currentTarget.value })
                  }
                  placeholder="General"
                />
                <datalist id="product-categories">
                  {Array.from(new Set(rows.map((r) => r.category))).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="p-price">{t("products.price")}</Label>
                  <Input
                    id="p-price"
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: e.currentTarget.value })
                    }
                    placeholder="0.00"
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="p-tax">{t("products.taxPct")}</Label>
                  <Input
                    id="p-tax"
                    inputMode="decimal"
                    value={form.taxPercent}
                    onChange={(e) =>
                      setForm({ ...form, taxPercent: e.currentTarget.value })
                    }
                    placeholder={t("products.default")}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <Label htmlFor="p-avail">{t("products.available")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("products.visibleInPos")}
                  </p>
                </div>
                <Switch
                  id="p-avail"
                  checked={form.available}
                  onCheckedChange={(v) => setForm({ ...form, available: v })}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("products.deleteTitle", { n: pendingDelete?.name ?? "—" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("products.deleteBody")}
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
