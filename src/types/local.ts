/**
 * Filas tal y como las devuelve SQLite.
 *
 * Los nombres llevan sufijo de unidad a propósito (`_cents`, `_bp`, `_milli`):
 * es la forma más barata de que nadie sume un importe en centavos con uno en
 * unidades sin darse cuenta.
 */

export type StaffRole = "admin" | "manager" | "waiter" | "cashier";
export type TableStatus = "available" | "occupied" | "billed";
export type OrderStatus =
  | "open"
  | "sent_to_kitchen"
  | "served"
  | "billed"
  | "paid"
  | "cancelled";
export type PaymentMethod = "cash" | "card" | "transfer" | "other";
export type MovementKind =
  | "initial"
  | "purchase"
  | "sale"
  | "reversal"
  | "waste"
  | "adjustment";

export const LIVE_ORDER_STATUSES: OrderStatus[] = [
  "open",
  "sent_to_kitchen",
  "served",
  "billed",
];

export const MANUAL_MOVEMENT_KINDS: MovementKind[] = [
  "purchase",
  "waste",
  "adjustment",
  "initial",
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "card",
  "transfer",
  "other",
];

export interface SettingsRow {
  id: number;
  restaurant_name: string;
  address: string;
  phone: string;
  currency: string;
  default_tax_bp: number;
  ticket_header: string;
  ticket_footer: string;
  /** SQLite no tiene booleanos: 0 o 1. */
  show_tax_breakdown: number;
  ticket_format: string;
  language: string;
  updated_at: string;
}

export interface StaffRow {
  id: string;
  full_name: string;
  role: StaffRole;
  pin_hash: string;
  active: number;
  created_at: string;
}

/** Sin el hash: lo que circula por la interfaz nunca lo necesita. */
export type StaffPublic = Omit<StaffRow, "pin_hash">;

export interface TableRow {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  price_cents: number;
  category: string;
  available: number;
  tax_bp: number | null;
  created_at: string;
}

export interface OrderRow {
  id: string;
  table_id: string;
  status: OrderStatus;
  subtotal_cents: number;
  tax_bp: number;
  tax_cents: number;
  total_cents: number;
  opened_by: string | null;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
  created_at: string;
  closed_at: string | null;
  /**
   * Cuenta que absorbió a esta al sincronizar, cuando dos terminales abrieron
   * la misma mesa a la vez. Con valor, la cuenta sigue en el historial pero ya
   * no está viva: sus líneas están en la otra.
   */
  merged_into: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  tax_bp: number;
  notes: string | null;
  created_at: string;
}

export interface ExpenseRow {
  id: string;
  amount_cents: number;
  category: string;
  note: string | null;
  spent_on: string;
  created_by: string | null;
  created_at: string;
}

export interface InventoryItemRow {
  id: string;
  name: string;
  unit: string;
  stock_milli: number;
  min_stock_milli: number;
  unit_cost_cents: number;
  active: number;
  created_at: string;
}

export interface InventoryMovementRow {
  id: string;
  item_id: string;
  quantity_milli: number;
  kind: MovementKind;
  note: string | null;
  order_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RecipeRow {
  product_id: string;
  item_id: string;
  quantity_milli: number;
}
