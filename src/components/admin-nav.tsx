import { NavLink } from "react-router";
import {
  ChartNoAxesColumn,
  ShieldCheck,
  LayoutGrid,
  Package,
  Printer,
  ReceiptText,
  Wallet as WalletIcon,
  Settings,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";

/**
 * Índice de gestión, visible solo dentro de `/admin`.
 *
 * Con nombre escrito y no solo icono: son ocho pantallas que se abren de tarde
 * en tarde, y en ese uso leer «Inventario» cuesta menos que reconocer un
 * dibujo de almacén. El raíl de al lado se queda con lo del turno.
 *
 * Los tres grupos son los tres motivos por los que se entra aquí: mirar cómo
 * va el negocio, tocar la carta, o cambiar cómo funciona el local.
 */
const GROUPS: {
  title: string;
  items: { to: string; end?: boolean; icon: LucideIcon; label: string }[];
}[] = [
  {
    title: "admin.groupBusiness",
    items: [
      { to: "/admin", end: true, icon: ChartNoAxesColumn, label: "nav.overview" },
      { to: "/admin/billing", icon: ReceiptText, label: "nav.billing" },
      { to: "/admin/audit", icon: ShieldCheck, label: "nav.audit" },
      { to: "/admin/register", icon: WalletIcon, label: "nav.register" },
      { to: "/admin/expenses", icon: Wallet, label: "nav.expenses" },
    ],
  },
  {
    title: "admin.groupMenu",
    items: [
      { to: "/admin/products", icon: Package, label: "nav.products" },
      { to: "/admin/inventory", icon: Warehouse, label: "nav.inventory" },
    ],
  },
  {
    title: "admin.groupVenue",
    items: [
      { to: "/admin/tables", icon: LayoutGrid, label: "nav.tablesAdmin" },
      { to: "/admin/users", icon: Users, label: "nav.users" },
      { to: "/admin/printers", icon: Printer, label: "nav.printers" },
      { to: "/admin/settings", icon: Settings, label: "nav.settings" },
    ],
  },
];

export function AdminNav() {
  const { t } = useI18n();

  return (
    <nav data-tour="admin-nav" className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar/60 px-2.5 py-3">
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t("nav.manage")}
      </p>

      {GROUPS.map((group, i) => (
        <div key={group.title} className={cn(i > 0 && "mt-4")}>
          <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {t(group.title)}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]",
                    "transition-colors duration-150",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{t(item.label)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
