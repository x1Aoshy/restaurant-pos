import { useMemo } from "react";

import { currencyLocale } from "@/lib/format";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { TicketLabels } from "@/features/tickets/ticket-pdf";

/**
 * Rótulos del ticket en el idioma de la aplicación.
 *
 * La fecha y los importes usan localizaciones distintas a propósito: el idioma
 * manda en cómo se escribe la fecha y la moneda manda en cómo se escribe el
 * importe. Poner córdobas con formato inglés está bien; poner la fecha en
 * español cuando toda la pantalla está en inglés, no.
 */
export function useTicketLabels(): TicketLabels {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const currency = settings?.currency ?? "USD";

  return useMemo(
    () => ({
      locale: lang === "en" ? "en-US" : currencyLocale(currency),
      venueFallback: t("ticket.venueFallback"),
      ticket: t("ticket.ticket"),
      table: t("ticket.table"),
      subtotal: t("pos.subtotal"),
      taxes: t("ticket.taxes"),
      taxShort: t("ticket.taxShort"),
      taxOn: t("ticket.taxOn"),
      total: t("pos.total"),
      quantity: t("ticket.qty"),
      description: t("ticket.description"),
      unitPrice: t("ticket.unitPrice"),
      amount: t("ticket.amount"),
    }),
    [t, lang, currency],
  );
}
