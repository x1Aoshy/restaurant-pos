import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const THEME_KEY = "restaurant-os:theme";
const PALETTE_KEY = "restaurant-os:palette";

export type Palette = "warm" | "midnight" | "fresh";

export const PALETTES: {
  id: Palette;
  name: string;
  description: string;
  swatches: [string, string, string];
}[] = [
  {
    id: "warm",
    name: "Cálido",
    description: "Ámbar y crema — espíritu de sala",
    swatches: ["#D97706", "#FDFBF7", "#16A34A"],
  },
  {
    id: "midnight",
    name: "Medianoche",
    description: "Índigo eléctrico sobre gris frío, estilo Discord",
    swatches: ["#5865F2", "#313338", "#23A55A"],
  },
  {
    id: "fresh",
    name: "Fresco",
    description: "Esmeralda y coral, luminoso",
    swatches: ["#10B981", "#0F172A", "#FB7185"],
  },
];

function readPalette(): Palette {
  const v = localStorage.getItem(PALETTE_KEY);
  return v === "midnight" || v === "fresh" ? v : "warm";
}

interface ThemeState {
  dark: boolean;
  toggle: () => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * Montado por encima del gate de auth para que login y app compartan tema.
 * La paleta es preferencia POR EQUIPO (localStorage), no de la nube: la misma
 * cuenta puede verse cálida en la barra y nocturna en caja.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(
    () => localStorage.getItem(THEME_KEY) !== "light",
  );
  const [palette, setPalette] = useState<Palette>(readPalette);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.palette = palette;
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    localStorage.setItem(PALETTE_KEY, palette);
  }, [dark, palette]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  const value = useMemo(
    () => ({ dark, toggle, palette, setPalette }),
    [dark, toggle, palette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
