-- =============================================================================
-- Marca de «ya salió a cocina».
--
-- Faltaba, y era un agujero de verdad: la comanda del POS imprimía al guardar,
-- pero un producto añadido desde la mesa —tocando la mesa en el salón y
-- pulsando un plato— se guardaba y no salía ningún papel. Ese plato no llegaba
-- a la cocina nunca.
--
-- No vale imprimir en cada toque: se añaden de uno en uno y saldría un papel
-- por cerveza. Y tampoco vale reimprimir la comanda entera, porque la cocina
-- volvería a hacer lo que ya hizo. Hace falta saber qué línea salió ya.
--
-- Se marca solo cuando el papel SALIÓ de verdad. Si no hay impresora
-- configurada, la línea sigue pendiente y saldrá el día que la haya.
--
-- Viaja entre terminales: si una comanda ya se mandó a cocina desde la caja de
-- abajo, el terminal de arriba no tiene que volver a mandarla.
-- =============================================================================

ALTER TABLE order_items ADD COLUMN printed_at TEXT;

CREATE INDEX IF NOT EXISTS order_items_pending_print_idx
  ON order_items (order_id) WHERE printed_at IS NULL AND voided_at IS NULL;

DROP TRIGGER IF EXISTS outbox_order_items_insert;
DROP TRIGGER IF EXISTS outbox_order_items_update;

CREATE TRIGGER outbox_order_items_insert
AFTER INSERT ON order_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('order_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'order_id', NEW.order_id, 'product_id', NEW.product_id,
    'quantity', NEW.quantity, 'unit_price_cents', NEW.unit_price_cents,
    'tax_bp', NEW.tax_bp, 'notes', NEW.notes,
    'discount_cents', NEW.discount_cents,
    'voided_at', NEW.voided_at, 'void_reason', NEW.void_reason,
    'voided_by', NEW.voided_by,
    'printed_at', NEW.printed_at,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER outbox_order_items_update
AFTER UPDATE ON order_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('order_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'order_id', NEW.order_id, 'product_id', NEW.product_id,
    'quantity', NEW.quantity, 'unit_price_cents', NEW.unit_price_cents,
    'tax_bp', NEW.tax_bp, 'notes', NEW.notes,
    'discount_cents', NEW.discount_cents,
    'voided_at', NEW.voided_at, 'void_reason', NEW.void_reason,
    'voided_by', NEW.voided_by,
    'printed_at', NEW.printed_at,
    'created_at', NEW.created_at));
END;
