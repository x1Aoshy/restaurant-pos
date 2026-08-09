import { useCallback, useState } from "react";
import { toast } from "sonner";

import { query } from "@/lib/db";
import { lineTaxCents } from "@/lib/money";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { OrderRow } from "@/types/local";

import {
  buildTicketPdf,
  ticketFileName,
  type TicketLine,
} from "@/features/tickets/ticket-pdf";
import { revealTicket, saveTicketPdf } from "@/features/tickets/save-ticket";
import { useTicketLabels } from "@/features/tickets/use-ticket-labels";
import { usePrinting } from "@/features/printing/use-printing";

interface FetchedLine {
  name: string;
  quantity: number;
  unit_price_cents: number;
  tax_bp: number;
  discount_cents: number;
}

export function useTicket() {
  const { settings } = useSession();
  const { t } = useI18n();
  const labels = useTicketLabels();
  const { printReceipt } = usePrinting();
  const [busy, setBusy] = useState(false);

  const generate = useCallback(
    async (
      order: OrderRow,
      tableNumber: number,
      payment?: { method: string; reference: string },
    ) => {
      if (!settings) {
        toast.error(t("toast.noSettings"));
        return;
      }

      setBusy(true);
      try {
        const fetched = await query<FetchedLine>(
          // Las líneas anuladas no salen en el papel: el cliente no paga lo
          // que se devolvió a la cocina.
          `SELECT p.name, oi.quantity, oi.unit_price_cents, oi.tax_bp,
                  oi.discount_cents
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1 AND oi.voided_at IS NULL
            ORDER BY oi.created_at`,
          [order.id],
        );

        const lines: TicketLine[] = fetched.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unit_price_cents,
          bp: l.tax_bp,
          discountCents: l.discount_cents,
          subtotalCents: l.quantity * l.unit_price_cents - l.discount_cents,
        }));

        const map = new Map<number, { base: number; tax: number }>();
        for (const l of fetched) {
          const entry = map.get(l.tax_bp) ?? { base: 0, tax: 0 };
          // Base rebajada por el descuento, igual que en los triggers.
          const base = l.quantity * l.unit_price_cents - l.discount_cents;
          entry.base += base;
          entry.tax += lineTaxCents(1, base, l.tax_bp);
          map.set(l.tax_bp, entry);
        }
        const taxBreakdown = Array.from(map.entries())
          .map(([bp, v]) => ({ bp, ...v }))
          .sort((a, b) => a.bp - b.bp);

        const method = payment?.method ?? order.payment_method;
        const reference = payment?.reference || order.payment_ref;
        const paymentLabel = method
          ? `${t("ticket.paidWith", { m: t(`method.${method}`) })}${
              reference ? ` · ${reference}` : ""
            }`
          : undefined;

        const ticket = {
          settings,
          labels,
          tableNumber,
          reference: order.id.slice(0, 8).toUpperCase(),
          openedAt: order.created_at,
          closedAt: order.closed_at,
          subtotalCents: order.subtotal_cents,
          discountCents: order.discount_cents,
          taxCents: order.tax_cents,
          totalCents: order.total_cents,
          tipCents: order.tip_cents,
          tenderedCents: order.tendered_cents,
          lines,
          taxBreakdown,
          paymentLabel,
        };

        // Primero el papel. Si hay impresora configurada sale por ahí y el PDF
        // queda de respaldo; si no la hay, `printReceipt` no hace nada y el PDF
        // sigue siendo el ticket. Ni un aviso por no tener impresora.
        const printed = await printReceipt(ticket, method === "cash");

        const result = await saveTicketPdf(
          buildTicketPdf(ticket),
          ticketFileName(ticket),
        );
        if (printed) {
          // Con papel en la mano, el aviso del PDF sobra.
          setBusy(false);
          return;
        }

        if (result.status === "saved") {
          toast.success(t("toast.ticketSaved"), {
            description: result.path,
            action: {
              label: t("toast.openFile"),
              onClick: () => void revealTicket(result.path),
            },
          });
        } else if (result.status === "downloaded") {
          toast.success(t("toast.ticketDownloaded"));
        } else if (result.status === "out_of_scope") {
          toast.error(t("toast.scopeFolders"));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("toast.ticketFailed"));
      } finally {
        setBusy(false);
      }
    },
    [settings, labels, printReceipt, t],
  );

  return { generate, busy };
}
