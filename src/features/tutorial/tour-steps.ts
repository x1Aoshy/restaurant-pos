export interface TourStep {
  /** Valor de `data-tour` del elemento real que se señala. */
  target: string;
  /** Ruta a la que hay que estar para que ese elemento exista. */
  route: string;
  textKey: string;
  /** Dónde cae el cartel respecto al recuadro. */
  side?: "right" | "bottom" | "left" | "top";
}

/**
 * El recorrido señala la aplicación de verdad, no una copia.
 *
 * Una maqueta enseña a usar la maqueta: al salir hay que volver a buscar dónde
 * estaba cada cosa. Aquí se ilumina el botón real, en su sitio real, y lo que
 * se aprende sirve tal cual.
 *
 * Una frase por paso. Si un paso necesita un párrafo, es que el botón está mal
 * puesto y lo que hay que arreglar es el botón.
 */
export const WAITER_TOUR: TourStep[] = [
  { target: "rail-pos", route: "/pos", textKey: "tour.pos", side: "right" },
  { target: "pos-table", route: "/pos", textKey: "tour.table", side: "bottom" },
  { target: "pos-catalog", route: "/pos", textKey: "tour.catalog", side: "right" },
  { target: "pos-save", route: "/pos", textKey: "tour.save", side: "top" },
  { target: "rail-floor", route: "/floor", textKey: "tour.floor", side: "right" },
  { target: "floor-grid", route: "/floor", textKey: "tour.charge", side: "bottom" },
];

export const MANAGER_TOUR: TourStep[] = [
  { target: "rail-admin", route: "/admin", textKey: "tour.admin", side: "right" },
  { target: "admin-nav", route: "/admin", textKey: "tour.adminNav", side: "right" },
];

/** Cierra el recorrido donde empezó: así se sabe cómo volver a verlo. */
export const CLOSING_STEP: TourStep = {
  target: "help",
  route: "",
  textKey: "tour.again",
  side: "right",
};

export function tourFor(isManager: boolean): TourStep[] {
  return isManager
    ? [...WAITER_TOUR, ...MANAGER_TOUR, CLOSING_STEP]
    : [...WAITER_TOUR, CLOSING_STEP];
}
