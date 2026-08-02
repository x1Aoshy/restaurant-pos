import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useMenu } from "@/providers/menu-provider";
import type { ProductRow } from "@/types/local";

export function MenuPicker({
  onAdd,
  disabled,
}: {
  onAdd: (product: ProductRow) => void;
  disabled?: boolean;
}) {
  const { products, categories, loading } = useMenu();
  const { t } = useI18n();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === null || p.category === category) &&
        (q === "" || p.name.toLowerCase().includes(q)),
    );
  }, [products, category, query]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t("pos.search")}
          className="h-8"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={category === null ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setCategory(null)}
          >
            {t("pos.all")}
          </Button>
          {categories.map((c) => (
            <Button
              key={c}
              variant={category === c ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-1 gap-1.5 p-4 sm:grid-cols-2">
          {visible.map((product) => (
            <button
              key={product.id}
              type="button"
              disabled={disabled}
              onClick={() => onAdd(product)}
              className={cn(
                "group flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2.5 text-left",
                "transition-all duration-200 ease-in-out",
                "hover:border-border hover:bg-muted/60",
                "disabled:pointer-events-none disabled:opacity-40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium tracking-tight">
                  {product.name}
                </div>
                {product.tax_bp !== null ? (
                  <div className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">
                    imp. {formatBp(product.tax_bp)}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {formatCents(product.price_cents)}
                </span>
                <Plus className="size-3.5 opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100" />
              </div>
            </button>
          ))}

          {visible.length === 0 ? (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              {t("pos.noMatch")}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
