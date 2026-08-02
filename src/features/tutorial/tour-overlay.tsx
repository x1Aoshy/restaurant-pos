import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n-provider";
import { useSession } from "@/providers/session-provider";
import { tourFor, type TourStep } from "@/features/tutorial/tour-steps";

/** Aire alrededor del recuadro iluminado. */
const PAD = 6;
const GAP = 10;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Recorrido guiado sobre la interfaz de verdad.
 *
 * Se oscurece todo menos el elemento del que se habla, que queda recortado y
 * **se puede tocar**: el hueco no atrapa los clics, el resto de la pantalla sí.
 * Así se aprende sobre la aplicación real en vez de sobre una maqueta que luego
 * hay que traducir mentalmente.
 *
 * El oscurecido se hace con cuatro rectángulos alrededor del hueco y no con una
 * capa agujereada por CSS: una sombra gigante taparía visualmente, pero seguiría
 * capturando los clics justo encima de lo que se quiere dejar libre.
 */
export function TourOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { staff } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isManager = staff?.role === "admin" || staff?.role === "manager";
  const steps = useMemo(() => tourFor(isManager), [isManager]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step: TourStep | undefined = steps[index];
  const last = index === steps.length - 1;

  // Llevar a la pantalla del paso antes de buscar su elemento: si no está
  // montado, no hay nada que iluminar.
  useEffect(() => {
    if (step?.route && pathname !== step.route) navigate(step.route);
  }, [step, pathname, navigate]);

  const measure = useCallback(() => {
    if (!step) return;
    const node = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!node) {
      setRect(null);
      return;
    }
    const r = node.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    measure();
    // Un fotograma después, para cuando el cambio de pantalla aún no ha pintado.
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, pathname]);

  const next = useCallback(() => {
    if (last) onClose();
    else setIndex((i) => i + 1);
  }, [last, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose]);

  if (!step) return null;

  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // El cartel se coloca según el lado pedido, y se recorta a la ventana para
  // que nunca se salga por un borde.
  const side = step.side ?? "bottom";
  const label: React.CSSProperties = !hole
    ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    : side === "right"
      ? { top: hole.top, left: hole.left + hole.width + GAP }
      : side === "left"
        ? { top: hole.top, right: window.innerWidth - hole.left + GAP }
        : side === "top"
          ? { bottom: window.innerHeight - hole.top + GAP, left: hole.left }
          : { top: hole.top + hole.height + GAP, left: hole.left };

  const dim = "fixed bg-black/65 transition-all duration-200 ease-out";

  return (
    <div className="fixed inset-0 z-[100]">
      {hole ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div
            className={dim}
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className={dim}
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
          />
          <div
            className={dim}
            style={{
              top: hole.top,
              left: hole.left + hole.width,
              right: 0,
              height: hole.height,
            }}
          />
          {/* Solo el anillo: no atrapa clics, así el elemento sigue usándose. */}
          <div
            className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-all duration-200 ease-out"
            style={hole}
          />
        </>
      ) : (
        <div className={cn(dim, "inset-0")} />
      )}

      <div
        className="raised fixed z-10 max-w-[17rem] rounded-xl border border-border bg-popover px-3.5 py-3 transition-all duration-200 ease-out"
        style={label}
      >
        <p className="text-[13px] leading-snug">{t(step.textKey)}</p>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {index + 1}/{steps.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              {t("tour.skip")}
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {last ? t("tour.done") : t("tour.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
