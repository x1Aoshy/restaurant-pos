import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exec, newId, query } from "@/lib/db";
import { formatCents, todayLocal } from "@/lib/format";
import { centsToInput, parseCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { ExpenseRow } from "@/types/local";

interface FormState {
  id?: string;
  amount: string;
  category: string;
  note: string;
  spentOn: string;
}

const EMPTY: FormState = {
  amount: "",
  category: "",
  note: "",
  spentOn: todayLocal(),
};

export function ExpensesRoute() {
  const { staff } = useSession();
  const { t } = useI18n();

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExpenseRow | null>(null);

  const load = useCallback(async () => {
    setRows(
      await query<ExpenseRow>(
        "SELECT * FROM expenses ORDER BY spent_on DESC, created_at DESC LIMIT 300",
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCents = useMemo(
    () => rows.reduce((n, r) => n + r.amount_cents, 0),
    [rows],
  );

  const save = async () => {
    if (!form) return;

    const amountCents = parseCents(form.amount);
    if (amountCents === null || amountCents <= 0) {
      toast.error(t("exp.invalid"));
      return;
    }

    const category = form.category.trim() || "General";
    const note = form.note.trim() || null;
    const spentOn = form.spentOn || todayLocal();

    setSaving(true);
    try {
      if (form.id) {
        await exec(
          `UPDATE expenses
              SET amount_cents = $1, category = $2, note = $3, spent_on = $4
            WHERE id = $5`,
          [amountCents, category, note, spentOn, form.id],
        );
      } else {
        await exec(
          `INSERT INTO expenses (id, amount_cents, category, note, spent_on, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId(), amountCents, category, note, spentOn, staff?.id ?? null],
        );
      }
      toast.success(t("exp.saved"));
      setForm(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await exec("DELETE FROM expenses WHERE id = $1", [pendingDelete.id]);
      toast.success(t("exp.deleted"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setPendingDelete(null);
  };

  return (
    <>
      <PageHeader
        title={t("exp.title")}
        description={formatCents(totalCents)}
        actions={
          <Button size="sm" onClick={() => setForm({ ...EMPTY, spentOn: todayLocal() })}>
            <Plus />
            {t("exp.new")}
          </Button>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {loading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">{t("exp.empty")}</p>
            </div>
          ) : (
            <div className="raised rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">{t("exp.date")}</TableHead>
                    <TableHead className="w-40">{t("exp.category")}</TableHead>
                    <TableHead>{t("exp.note")}</TableHead>
                    <TableHead className="text-right">{t("exp.amount")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {row.spent_on}
                      </TableCell>
                      <TableCell className="text-sm">{row.category}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.note || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCents(row.amount_cents)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t("common.edit")}
                            aria-label={t("common.edit")}
                            onClick={() =>
                              setForm({
                                id: row.id,
                                amount: centsToInput(row.amount_cents),
                                category: row.category,
                                note: row.note ?? "",
                                spentOn: row.spent_on,
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
                            onClick={() => setPendingDelete(row)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("exp.edit") : t("exp.new")}</DialogTitle>
          </DialogHeader>

          {form ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="e-amount">{t("exp.amount")}</Label>
                  <Input
                    id="e-amount"
                    autoFocus
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.currentTarget.value })}
                    placeholder="0.00"
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="e-date">{t("exp.date")}</Label>
                  <Input
                    id="e-date"
                    type="date"
                    value={form.spentOn}
                    onChange={(e) => setForm({ ...form, spentOn: e.currentTarget.value })}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="e-cat">{t("exp.category")}</Label>
                <Input
                  id="e-cat"
                  list="expense-categories"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.currentTarget.value })}
                  placeholder="General"
                />
                <datalist id="expense-categories">
                  {Array.from(new Set(rows.map((r) => r.category))).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="e-note">{t("exp.note")}</Label>
                <Input
                  id="e-note"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.currentTarget.value })}
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
            <AlertDialogTitle>{t("exp.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("exp.deleteBody")}</AlertDialogDescription>
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
