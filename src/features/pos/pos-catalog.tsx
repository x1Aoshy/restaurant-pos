import { useMemo, useState, type RefObject } from "react";
import { CornerDownLeft, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { formatBp } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useMenu } from "@/providers/menu-provider";
import { MAX_QUANTITY } from "@/features/pos/use-draft";
import type { ProductRow } from "@/types/local";

/**
 * «12 cerveza» son doce cervezas.
 *
 * La cantidad es lo que más se repite al transcribir una nota de papel, y era
 * lo único que no se podía teclear: doce unidades eran once pulsaciones en el
 * botón «+». El número va delante porque es como se lee la nota.
 *
 * Hace falta un separador —espacio, x o *— a propósito. Sin él, «7up» se leería
 * como siete «up», y un producto que empieza por número dejaría de encontrarse.
 */
const WITH_SIGN = /^(\d{1,3})\s*[x*×]\s*(.+)$/;
const WITH_SPACE = /^(\d{1,3})\s+(.+)$/;

function parseSearch(raw: string): { quantity: number; term: string } {
  const m = raw.match(WITH_SIGN) ?? raw.match(WITH_SPACE);
  if (!m) return { quantity: 1, term: raw };
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return { quantity: 1, term: raw };
  return { quantity: Math.min(n, MAX_QUANTITY), term: m[2] };
}

export function PosCatalog({
  onAdd,
  searchRef,
}: {
  onAdd: (product: ProductRow, quantity: number) => void;
  /** Vive en la ruta: el foco vuelve aquí también al guardar la comanda. */
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { products, categories, loading } = useMenu();
  const { t } = useI18n();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const { quantity, term } = useMemo(() => parseSearch(query), [query]);

  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === null || p.category === category) &&
        (q === "" || p.name.toLowerCase().includes(q)),
    );
  }, [products, category, term]);

  /** Añadir siempre limpia y devuelve el foco: la nota sigue en la mano. */
  const add = (product: ProductRow) => {
    onAdd(product, quantity);
    setQuery("");
    searchRef.current?.focus();
  };

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
                add(visible[0]);
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("pos.search")}
            className={cn("pl-8", quantity > 1 && "pr-24")}
          />

          {/* El eco de lo que hará Enter. Es la única pista permanente de que
              el atajo existe, así que enseña también la cantidad leída. */}
          {query && visible.length > 0 ? (
            <span className="pointer-events-none absolute right-2.5 top-1/2 flex max-w-[60%] -translate-y-1/2 items-center gap-1 text-[0.65rem] text-muted-foreground">
              <CornerDownLeft className="size-3 shrink-0" />
              {quantity > 1 ? (
                <span className="shrink-0 font-mono font-semibold tabular-nums text-primary">
                  {quantity}×
                </span>
              ) : null}
              <span className="truncate">{visible[0].name}</span>
            </span>
          ) : null}
        </div>

        {/* La cantidad tecleada, dicha en voz alta. Un «12» suelto delante del
            texto se lee como parte del nombre hasta que algo confirma que se
            entendió como cantidad. */}
        {quantity > 1 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono font-semibold tabular-nums text-primary">
              {quantity}×
            </span>
            <span className="min-w-0 flex-1 truncate">
              {t("pos.qtyPrefix", { n: quantity })}
            </span>
            <Button
              variant="ghost"
              size="xs"
              aria-label={t("lock.clearSearch")}
              onClick={() => {
                setQuery(term);
                searchRef.current?.focus();
              }}
            >
              <X />
            </Button>
          </div>
        ) : null}

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
                  onClick={() => add(product)}
                  className={cn(
                    "relative flex min-h-[5.25rem] flex-col justify-between rounded-2xl border border-border bg-card p-3.5 text-left",
                    "transition-all duration-200 ease-in-out",
                    "hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/50 hover:shadow-md hover:shadow-foreground/5",
                    "active:translate-y-0 active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {/* Con cantidad tecleada, el clic también la respeta. La
                      tarjeta lo dice para que no sorprenda después. */}
                  {quantity > 1 ? (
                    <span className="absolute right-2 top-2 rounded-md bg-primary px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tabular-nums text-primary-foreground">
                      {quantity}×
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "line-clamp-2 text-sm font-medium leading-snug tracking-tight",
                      quantity > 1 && "pr-8",
                    )}
                  >
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
