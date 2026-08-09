import { LoaderCircle, TriangleAlert } from "lucide-react";
import { HashRouter, Navigate, Route, Routes } from "react-router";

import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { AppLayout } from "@/components/app-layout";
import { LockScreen } from "@/components/lock-screen";
import { SetupScreen } from "@/components/setup-screen";
import { FloorProvider } from "@/providers/floor-provider";
import { I18nProvider } from "@/providers/i18n-provider";
import { MenuProvider } from "@/providers/menu-provider";
import { SessionProvider, useSession } from "@/providers/session-provider";
import { SyncProvider } from "@/providers/sync-provider";
import { ThemeProvider } from "@/providers/theme-provider";

import { PosRoute } from "@/routes/pos-route";
import { FloorRoute } from "@/routes/floor-route";
import { DashboardRoute } from "@/routes/admin/dashboard-route";
import { ProductsRoute } from "@/routes/admin/products-route";
import { InventoryRoute } from "@/routes/admin/inventory-route";
import { ExpensesRoute } from "@/routes/admin/expenses-route";
import { RegisterRoute } from "@/routes/admin/register-route";
import { PrintersRoute } from "@/routes/admin/printers-route";
import { AuditRoute } from "@/routes/admin/audit-route";
import { BillingRoute } from "@/routes/admin/billing-route";
import { TablesRoute } from "@/routes/admin/tables-route";
import { UsersRoute } from "@/routes/admin/users-route";
import { SettingsRoute } from "@/routes/admin/settings-route";

function Gate() {
  const { phase, error } = useSession();

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <div className="max-w-sm text-center">
          <TriangleAlert className="mx-auto size-5 text-destructive" />
          <p className="mt-3 text-sm font-medium tracking-tight">
            No se pudo abrir la base de datos local
          </p>
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (phase === "setup") return <SetupScreen />;
  if (phase === "locked") return <LockScreen />;

  return (
    <SyncProvider>
      <FloorProvider>
        <MenuProvider>
        {/* HashRouter y no BrowserRouter: el build de producción se sirve por
            un protocolo propio donde el enrutado por ruta no resuelve. */}
        <HashRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/pos" replace />} />
              <Route path="pos" element={<PosRoute />} />
              <Route path="floor" element={<FloorRoute />} />
              <Route path="admin" element={<DashboardRoute />} />
              <Route path="admin/products" element={<ProductsRoute />} />
              <Route path="admin/inventory" element={<InventoryRoute />} />
              <Route path="admin/expenses" element={<ExpensesRoute />} />
              <Route path="admin/register" element={<RegisterRoute />} />
              <Route path="admin/billing" element={<BillingRoute />} />
              <Route path="admin/audit" element={<AuditRoute />} />
              <Route path="admin/tables" element={<TablesRoute />} />
              <Route path="admin/users" element={<UsersRoute />} />
              <Route path="admin/printers" element={<PrintersRoute />} />
              <Route path="admin/settings" element={<SettingsRoute />} />
              <Route path="*" element={<Navigate to="/pos" replace />} />
            </Route>
          </Routes>
        </HashRouter>
        </MenuProvider>
      </FloorProvider>
    </SyncProvider>
  );
}

/** El idioma vive en los ajustes, así que I18n necesita leer la sesión. */
function WithI18n() {
  const { settings, refreshSettings } = useSession();
  return (
    <I18nProvider
      language={settings?.language ?? null}
      onLanguageChanged={refreshSettings}
    >
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Gate />
        </div>
      </div>
      <Toaster position="bottom-right" />
    </I18nProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <WithI18n />
      </SessionProvider>
    </ThemeProvider>
  );
}
