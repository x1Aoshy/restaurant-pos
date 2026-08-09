import { useState } from "react";
import { NavLink } from "react-router";
import {
  CircleQuestionMark,
  ClipboardList,
  LayoutGrid,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SyncBadge } from "@/components/sync-badge";
import { BackupBadge } from "@/components/backup-badge";
import { TourOverlay } from "@/features/tutorial/tour-overlay";
import { cn } from "@/lib/utils";
import { useSession } from "@/providers/session-provider";
import { useI18n } from "@/providers/i18n-provider";

/**
 * Raíl de trabajo. Solo lo que se usa durante el turno.
 *
 * Llegó a tener diez iconos y en 56 px de ancho eso no es navegación, es un
 * examen de memoria: sin texto, un almacén y una caja registradora se parecen
 * demasiado. Las pantallas de gestión se agrupan tras una sola puerta y allí
 * se listan con su nombre escrito — ver `admin-nav.tsx`.
 */
function RailLink({
  to,
  end,
  icon: Icon,
  label,
  tour,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
  tour?: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      data-tour={tour}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          "relative flex size-10 items-center justify-center rounded-xl transition-colors duration-150",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        )
      }
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {/* Barra de acento en el borde: el relleno solo ya marcaba el activo,
              pero se confundía con el estado hover. Esto no. */}
          <span
            className={cn(
              "absolute -left-2.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary",
              "transition-all duration-200 ease-out",
              isActive ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
            )}
          />
          <Icon className="size-5" />
        </>
      )}
    </NavLink>
  );
}

export function AppSidebar() {
  const { staff, signOut } = useSession();
  const { t } = useI18n();

  const [tutorial, setTutorial] = useState(false);

  const isManager = staff?.role === "admin" || staff?.role === "manager";

  const initials =
    (staff?.full_name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w: string) => w[0]!.toUpperCase())
      .join("") || "?";

  const who = `${staff?.full_name || t("common.user")} · ${
    staff ? t(`role.${staff.role}`) : ""
  }`;

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-sidebar py-3">
      <nav className="flex flex-1 flex-col items-center gap-1.5">
        <RailLink to="/pos" icon={ClipboardList} label={t("nav.orders")} tour="rail-pos" />
        <RailLink to="/floor" icon={LayoutGrid} label={t("nav.tables")} tour="rail-floor" />

        {isManager ? (
          <>
            <div className="my-1.5 h-px w-6 bg-border" />
            {/* Sin `end`: queda marcado en cualquier pantalla de gestión, que
                es justo lo que dice el panel abierto al lado. */}
            <RailLink
              to="/admin"
              icon={SlidersHorizontal}
              label={t("nav.manage")}
              tour="rail-admin"
            />
          </>
        ) : null}
      </nav>

      <div className="flex flex-col items-center gap-1.5">
        <SyncBadge />
        <BackupBadge />

        {/* Encima de la burbuja: la ayuda pertenece a la persona que tiene el
            turno, no a la pantalla en la que esté. Sustituye a los párrafos
            explicativos que antes vivían dentro de cada pantalla y que ahí solo
            estorbaban a quien ya sabe. */}
        <button
          type="button"
          data-tour="help"
          onClick={() => setTutorial(true)}
          title={t("tour.open")}
          aria-label={t("tour.open")}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            "text-muted-foreground transition-colors duration-150",
            "hover:bg-accent/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <CircleQuestionMark className="size-4" />
        </button>

        {/* Insignia, no botón: antes abría un menú que no se veía. Ahora solo
            identifica quién tiene la sesión; la acción vive en su propio botón. */}
        <div
          title={who}
          className="flex size-9 select-none items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground ring-1 ring-border"
        >
          {initials}
        </div>

        <div className="my-1 h-px w-6 bg-border" />

        {/* El tema vive solo en Ajustes → Apariencia: es una preferencia que se
            toca una vez, no una acción de turno que merezca sitio en el raíl. */}
        <button
          type="button"
          onClick={() => void signOut()}
          title={t("nav.signout")}
          aria-label={t("nav.signout")}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            "text-muted-foreground transition-colors duration-150",
            "hover:bg-destructive/10 hover:text-destructive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <LogOut className="size-4" />
        </button>
      </div>

      {tutorial ? <TourOverlay onClose={() => setTutorial(false)} /> : null}
    </aside>
  );
}
