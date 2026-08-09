import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { exec, query, queryOne } from "@/lib/db";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import type { PrinterRow } from "@/types/local";
import {
  RECEIPT_GROUP,
  kitchenBlocks,
  receiptBlocks,
  voidBlocks,
  type Block,
} from "@/features/printing/blocks";
import type { TicketData } from "@/features/tickets/ticket-pdf";

/** Lo que necesita el adaptador de Rust; el resto de la fila no le sirve. */
function configOf(p: PrinterRow) {
  return {
    address: p.address,
    port: p.port,
    width_chars: p.width_chars,
    codepage: p.codepage,
    cut_mode: p.cut_mode,
  };
}

/**
 * Qué impresora atiende un grupo en una zona.
 *
 * `ORDER BY r.zone_id IS NULL` pone primero la regla concreta de la zona y deja
 * la de reserva —la que vale para todas— como segunda opción. Sin ese orden, en
 * un local con dos plantas la de reserva podría ganarle a la específica según
 * el humor del planificador de consultas.
 */
async function routeFor(group: string, zoneId: string | null) {
  return queryOne<PrinterRow>(
    `SELECT p.* FROM printer_routing r
       JOIN printers p ON p.id = r.printer_id
      WHERE r.print_group = $1
        AND (r.zone_id = $2 OR r.zone_id IS NULL)
        AND p.active = 1
      ORDER BY r.zone_id IS NULL
      LIMIT 1`,
    [group, zoneId],
  );
}

interface KitchenRow {
  id: string;
  name: string;
  quantity: number;
  notes: string | null;
  print_group: string;
}

/**
 * Impresión térmica.
 *
 * **Sin impresora configurada no pasa nada.** Ni error ni aviso: es el estado
 * normal de una instalación que todavía imprime en PDF, y un mensaje rojo cada
 * vez que se guarda una comanda enseñaría a la gente a ignorar los mensajes.
 * Solo se avisa cuando hay una ruta declarada y el envío falla — ahí sí hay algo
 * roto que arreglar.
 */
export function usePrinting() {
  const { staff, settings } = useSession();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "es-NI";

  const send = useCallback(
    async (printer: PrinterRow, blocks: Block[]) => {
      try {
        await invoke("printer_print", { config: configOf(printer), blocks });
        return true;
      } catch (e) {
        toast.error(t("print.failed", { n: printer.name }), {
          description: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    },
    [t],
  );

  /** Ticket del cliente, por la impresora de la zona de ESTE terminal. */
  const printReceipt = useCallback(
    async (data: TicketData, openDrawer: boolean) => {
      const context = await queryOne<{ zone_id: string | null }>(
        "SELECT zone_id FROM sync_context WHERE id = 1",
      );
      const printer = await routeFor(RECEIPT_GROUP, context?.zone_id ?? null);
      if (!printer) return false;
      return send(printer, receiptBlocks(data, { openDrawer }));
    },
    [send],
  );

  /**
   * Comandas de cocina y barra, por la zona de la MESA.
   *
   * La zona de la mesa y no la del terminal: lo que importa es a qué planta hay
   * que llevar el plato, no desde qué ordenador se apuntó.
   *
   * Se manda un papel por grupo. Cuando dos grupos comparten impresora salen
   * dos tickets seguidos, y eso es correcto: en la barra se separan igual.
   *
   * Solo sale lo que NO ha salido ya. Sin eso, añadir una cerveza a una mesa
   * reimprimiría la comanda entera y la cocina volvería a hacer lo que ya hizo.
   * Y se marca únicamente lo que se imprimió de verdad: si un grupo no tiene
   * impresora, sus líneas siguen pendientes para el día que la haya.
   */
  const printKitchen = useCallback(
    async (orderId: string, tableNumber: number, zoneId: string | null) => {
      const lines = await query<KitchenRow>(
        `SELECT oi.id, p.name, oi.quantity, oi.notes, p.print_group
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
            AND oi.voided_at IS NULL
            AND oi.printed_at IS NULL
          ORDER BY p.print_group, oi.created_at`,
        [orderId],
      );
      if (lines.length === 0) return 0;

      const byGroup = new Map<string, KitchenRow[]>();
      for (const line of lines) {
        const list = byGroup.get(line.print_group) ?? [];
        list.push(line);
        byGroup.set(line.print_group, list);
      }

      let sent = 0;
      for (const [group, groupLines] of byGroup) {
        const printer = await routeFor(group, zoneId);
        if (!printer) continue;
        const ok = await send(
          printer,
          kitchenBlocks({
            groupLabel: group,
            tableNumber,
            reference: orderId.slice(0, 8).toUpperCase(),
            waiter: staff?.full_name ?? null,
            at: new Date().toISOString(),
            locale,
            counterName: t("pos.counterShort"),
            lines: groupLines,
          }),
        );
        if (!ok) continue;
        const holes = groupLines.map((_, i) => `$${i + 1}`).join(", ");
        await exec(
          `UPDATE order_items SET printed_at = datetime('now')
            WHERE id IN (${holes})`,
          groupLines.map((l) => l.id),
        );
        sent += groupLines.length;
      }
      return sent;
    },
    [send, staff, locale, t],
  );

  /**
   * Avisa a cocina de que una línea que ya había salido se anula.
   *
   * Va por la misma impresora que sacó la comanda —el grupo del producto y la
   * zona de la mesa—, porque el papel a retirar está clavado justo ahí.
   *
   * No devuelve nada ni avisa si falla: la anulación ya está guardada y es lo
   * que importa; el papel es un extra. Un error rojo aquí haría pensar que no
   * se anuló.
   */
  const printVoid = useCallback(
    async (input: {
      group: string;
      tableNumber: number;
      zoneId: string | null;
      orderId: string;
      name: string;
      quantity: number;
      reason: string | null;
    }) => {
      const printer = await routeFor(input.group, input.zoneId);
      if (!printer) return;
      await send(
        printer,
        voidBlocks({
          banner: t("void.voided"),
          tableNumber: input.tableNumber,
          reference: input.orderId.slice(0, 8).toUpperCase(),
          waiter: staff?.full_name ?? null,
          at: new Date().toISOString(),
          locale,
          counterName: t("pos.counterShort"),
          line: { name: input.name, quantity: input.quantity, notes: null },
          reason: input.reason,
        }),
      );
    },
    [send, staff, locale, t],
  );

  /**
   * Manda bloques por la impresora del ticket de este terminal.
   *
   * Devuelve `false` si no hay ninguna configurada, sin ruido: es el estado
   * normal de una instalación que todavía imprime en PDF.
   */
  const printHere = useCallback(
    async (blocks: Block[]) => {
      const context = await queryOne<{ zone_id: string | null }>(
        "SELECT zone_id FROM sync_context WHERE id = 1",
      );
      const printer = await routeFor(RECEIPT_GROUP, context?.zone_id ?? null);
      if (!printer) return false;
      return send(printer, blocks);
    },
    [send],
  );

  /** Abre el cajón sin vender: para dar cambio de algo que no es una venta. */
  const openDrawer = useCallback(async () => {
    const context = await queryOne<{ zone_id: string | null }>(
      "SELECT zone_id FROM sync_context WHERE id = 1",
    );
    const printer =
      (await routeFor(RECEIPT_GROUP, context?.zone_id ?? null)) ??
      (await queryOne<PrinterRow>(
        "SELECT * FROM printers WHERE opens_drawer = 1 AND active = 1 LIMIT 1",
      ));
    if (!printer) {
      toast.error(t("print.noDrawer"));
      return;
    }
    try {
      await invoke("printer_open_drawer", { config: configOf(printer) });
    } catch (e) {
      toast.error(t("print.failed", { n: printer.name }), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [t]);

  return {
    printReceipt,
    printKitchen,
    printVoid,
    printHere,
    openDrawer,
    hasSettings: Boolean(settings),
  };
}
