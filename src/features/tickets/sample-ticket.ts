import { useEffect, useMemo, useState } from "react";

import { query } from "@/lib/db";
import { lineTaxCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import type { TicketLine } from "@/features/tickets/ticket-pdf";

export interface SampleTicket {
  lines: TicketLine[];
  taxBreakdown: { bp: number; base: number; tax: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

interface SampleProduct {
  name: string;
  price_cents: number;
  tax_bp: number | null;
}

/** Cantidades fijas: una muestra con tres unos no enseña cómo queda la columna. */
const QUANTITIES = [2, 1, 3];

function summarize(lines: TicketLine[]): SampleTicket {
  const map = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const entry = map.get(l.bp) ?? { base: 0, tax: 0 };
    entry.base += l.subtotalCents;
    entry.tax += lineTaxCents(l.quantity, l.unitPriceCents, l.bp);
    map.set(l.bp, entry);
  }
  const taxBreakdown = Array.from(map.entries())
    .map(([bp, v]) => ({ bp, ...v }))
    .sort((a, b) => a.bp - b.bp);

  const subtotalCents = lines.reduce((n, l) => n + l.subtotalCents, 0);
  const taxCents = taxBreakdown.reduce((n, b) => n + b.tax, 0);
  return {
    lines,
    taxBreakdown,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

/**
 * Muestra del ticket construida con productos reales de la carta.
 *
 * Antes eran tres platos inventados con precios inventados, así que la vista
 * previa no servía para lo único que importa: comprobar que un nombre largo de
 * TU carta cabe en 80 mm y que el impuesto sale donde debe. Si todavía no hay
 * productos, se cae a una línea genérica.
 *
 * La carta se lee una sola vez. La tasa se aplica al derivar, no al consultar:
 * si no, teclear «15» en el campo del impuesto lanzaría una consulta por
 * pulsación.
 */
export function useSampleTicket(defaultTaxBp: number): SampleTicket {
  const { t } = useI18n();
  const [products, setProducts] = useState<SampleProduct[]>([]);

  useEffect(() => {
    let alive = true;
    void query<SampleProduct>(
      `SELECT name, price_cents, tax_bp
         FROM products
        WHERE available = 1
        ORDER BY category, name
        LIMIT 3`,
    )
      .then((rows) => {
        if (alive) setProducts(rows);
      })
      .catch(() => {
        // Sin muestra real se usa la genérica; no hay nada que avisar aquí.
      });
    return () => {
      alive = false;
    };
  }, []);

  const fallbackName = t("settings.sampleItem");

  return useMemo(() => {
    if (products.length === 0) {
      return summarize([
        {
          name: fallbackName,
          quantity: 2,
          unitPriceCents: 1000,
          bp: defaultTaxBp,
          subtotalCents: 2000,
        },
      ]);
    }

    return summarize(
      products.map((p, i) => {
        const quantity = QUANTITIES[i] ?? 1;
        return {
          name: p.name,
          quantity,
          unitPriceCents: p.price_cents,
          // Un producto sin tasa propia hereda la de la casa, y esa es la que
          // se está editando ahora mismo en el formulario de al lado.
          bp: p.tax_bp ?? defaultTaxBp,
          subtotalCents: quantity * p.price_cents,
        };
      }),
    );
  }, [products, defaultTaxBp, fallbackName]);
}
