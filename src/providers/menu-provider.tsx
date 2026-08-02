import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { query } from "@/lib/db";
import type { ProductRow } from "@/types/local";

interface MenuState {
  products: ProductRow[];
  categories: string[];
  loading: boolean;
  reload: () => Promise<void>;
}

const MenuContext = createContext<MenuState | null>(null);

/**
 * Carta disponible para vender. Solo productos activos: la pantalla de
 * administración consulta la tabla completa por su cuenta, porque un gerente
 * también tiene que ver lo que está oculto.
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await query<ProductRow>(
      "SELECT * FROM products WHERE available = 1 ORDER BY category, name",
    );
    setProducts(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))),
    [products],
  );

  const value = useMemo(
    () => ({ products, categories, loading, reload }),
    [products, categories, loading, reload],
  );

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useMenu must be used inside <MenuProvider>");
  return ctx;
}
