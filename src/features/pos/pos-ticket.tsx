import { CircleAlert, LoaderCircle, Minus, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import type { useDraft } from "@/features/pos/use-draft";

export function PosTicket({ draft }: { draft: ReturnType<typeof useDraft> }) {
  const { t } = useI18n();
  const {
    tableNumber,
    setTableNumber,
    table,
    existingOrder,
    lines,
    preview,
    saving,
    setQuantity,
    clear,
    commit,
  } = draft;

  const unknownTable = tableNumber.trim() !== "" && !table;
  const billedTable = existingOrder?.status === "billed";
  const canSave = !!table && lines.length > 0 && !saving && !billedTable;

  return (
    <div className="raised z-10 flex min-h-0 w-[24rem] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <label
          htmlFor="pos-table"
          className="shrink-0 text-xs font-medium text-muted-foreground"
        >
          {t("pos.table")}
        </label>
        <Input
          id="pos-table"
          data-tour="pos-table"
          inputMode="numeric"
          value={tableNumber}
          onChange={(e) =>
            setTableNumber(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))
          }
          placeholder="00"
          className={cn(
            "h-10 w-20 shrink-0 text-center font-mono text-xl tabular-nums",
            unknownTable && "border-destructive",
          )}
        />
        <div className="min-w-0 flex-1 text-xs leading-snug">
          {unknownTable ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <CircleAlert className="size-3.5 shrink-0" />
              {t("pos.unknownTable", { n: tableNumber })}
            </span>
          ) : billedTable ? (
            <span className="flex items-center gap-1.5 text-status-billed">
              <CircleAlert className="size-3.5 shrink-0" />
              {t("pos.billedWarn")}
            </span>
          ) : existingOrder ? (
            <span className="text-muted-foreground">
              {t("pos.openAccount")} ·{" "}
              <span className="font-mono tabular-nums">
                {formatCents(existingOrder.total_cents)}
              </span>
              <br />
              {t("pos.willAppend")}
            </span>
          ) : table ? (
            <span className="text-muted-foreground">
              {t("pos.newAccount", { n: table.capacity })}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("pos.writeTable")}</span>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {lines.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("pos.emptyDraft")}
              <br />
            </p>
          ) : null}

          {lines.map((line) => (
            <div
              key={line.product.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm tracking-tight">
                  {line.product.name}
                </div>
                <div className="font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                  {formatCents(line.product.price_cents)}
                </div>
              </div>

              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("a11y.removeUnit")}
                  onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                >
                  {line.quantity === 1 ? <Trash2 /> : <Minus />}
                </Button>
                <span className="w-6 text-center font-mono text-sm tabular-nums">
                  {line.quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("a11y.addUnit")}
                  onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                >
                  <Plus />
                </Button>
              </div>

              <span className="w-[4.25rem] shrink-0 text-right font-mono text-sm tabular-nums">
                {formatCents(line.quantity * line.product.price_cents)}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-3">
        {/* Línea troquelada: el corte de un ticket de papel. */}
        <div className="tear-line -mx-3 mb-3" />

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{t("pos.subtotal")}</span>
          <span className="font-mono tabular-nums">
            {formatCents(preview.subtotalCents)}
          </span>
        </div>

        {preview.byRate.map((row) => (
          <div
            key={row.bp}
            className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground"
          >
            <span>
              {t("pos.tax")} {formatBp(row.bp)}
            </span>
            <span className="font-mono tabular-nums">{formatCents(row.tax)}</span>
          </div>
        ))}

        <Separator className="my-2.5" />

        {/* El total es LA cifra de esta pantalla: hay que leerlo de pie. */}
        <div className="sunken flex items-baseline justify-between rounded-lg bg-muted/60 px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("pos.total")}
          </span>
          <span className="font-mono text-[1.75rem] font-semibold leading-none tracking-tight text-primary">
            {formatCents(preview.totalCents)}
          </span>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={lines.length === 0 && tableNumber === ""}
            className="self-stretch"
          >
            {t("pos.clear")}
          </Button>
          <Button
            data-tour="pos-save"
            onClick={() => void commit()}
            disabled={!canSave}
            className="h-11 flex-1 text-sm"
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {t("pos.save")}
          </Button>
        </div>

        <p className="mt-2.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <kbd className="raised rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] leading-none">
            Ctrl
          </kbd>
          <span className="opacity-50">+</span>
          <kbd className="raised rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] leading-none">
            Enter
          </kbd>
          <span className="ml-1">{t("pos.ctrlHintShort")}</span>
        </p>
      </div>
    </div>
  );
}
