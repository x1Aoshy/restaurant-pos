import { Outlet, useLocation } from "react-router";

import { AdminNav } from "@/components/admin-nav";
import { AppSidebar } from "@/components/app-sidebar";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { useSession } from "@/providers/session-provider";

export function AppLayout() {
  const { settings, staff } = useSession();
  const { pathname } = useLocation();

  // El índice de gestión solo ocupa sitio mientras se está en gestión. Durante
  // el servicio la pantalla entera es para la comanda.
  const isManager = staff?.role === "admin" || staff?.role === "manager";
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground antialiased">
      <AppSidebar />
      {inAdmin && isManager ? <AdminNav /> : null}
      {/* key por moneda: formatMoney guarda la moneda en estado de módulo (no
          reactivo). Al cambiarla en Ajustes, remontar las rutas repinta todos
          los importes con el símbolo nuevo sin reiniciar la app. */}
      <div
        key={settings?.currency ?? "none"}
        className="bg-dots flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <Outlet />
      </div>

      {/* En la raíz: los atajos se piden desde cualquier pantalla, no solo
          desde la que los usa. */}
      <ShortcutsDialog />
    </div>
  );
}
