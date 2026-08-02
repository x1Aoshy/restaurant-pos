import { useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

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

export function PosCatalog({ onAdd }: { onAdd: (product: ProductRow) => void }) {
  const { products, categories, loading } = useMenu();
  const { t } = useI18n();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === null || p.category === category) &&
        (q === "" || p.name.toLowerCase().includes(q)),
    );
  }, [products, category, query]);

  return (
    <div data-tour="pos-catalog" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter es el atajo global de guardar: sin este guard
              // ambos manejadores disparaban y la comanda se guardaba SIN el
              // producto que esta pulsación acababa de añadir.
              if (e.ctrlKey || e.metaKey) return;
              if (e.key === "Enter" && visible.length > 0) {
                e.preventDefault();
                onAdd(visible[0]);
                setQuery("");
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("pos.search")}
            className="pl-8"
          />
          {query && visible.length > 0 ? (
            <span className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[0.65rem] text-muted-foreground">
              <CornerDownLeft className="size-3" />
              {visible[0].name}
            </span>
          ) : null}
        </div>

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
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 2xl:grid-cols-4">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[5.25rem] rounded-2xl" />
              ))
            : visible.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onAdd(product)}
                  className={cn(
                    "flex min-h-[5.25rem] flex-col justify-between rounded-2xl border border-border bg-card p-3.5 text-left",
                    "transition-all duration-200 ease-in-out",
                    "hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/50 hover:shadow-md hover:shadow-foreground/5",
                    "active:translate-y-0 active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug tracking-tight">
                    {product.name}
                  </span>
                  <span className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums text-primary">
                      {formatCents(product.price_cents)}
                    </span>
                    {product.tax_bp !== null ? (
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {formatBp(product.tax_bp)}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}

          {!loading && visible.length === 0 ? (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              {t("pos.noMatch")}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
