-- =============================================================================
-- Fase 1 de la sincronización: el buzón de salida.
--
-- Cada cambio que hace este equipo queda apuntado en `sync_outbox` con una
-- copia en JSON de la fila. Es lo que después se sube; sin esto habría que
-- confiar en que cada pantalla se acuerde de anotar lo que toca, y no se
-- acuerda.
--
-- APAGADO POR DEFECTO. Mientras `sync_context.enabled` sea 0 los triggers no
-- escriben nada: quien trabaje con un solo equipo no paga nada por esto. Se
-- enciende desde Ajustes cuando haya un segundo terminal.
--
-- Dos reglas que no son obvias y que están explicadas en SYNC.md:
--
--   * `applying` evita el eco. Al aplicar un cambio que llega de otro equipo se
--     levanta la bandera, y los triggers callan; si no, el cambio rebotaría
--     entre terminales para siempre.
--   * Lo calculado no viaja. Totales, estado de mesa y existencias los deduce
--     cada equipo de las filas de origen. Si además llegaran de fuera se
--     contarían dos veces.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_context (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  -- Identifica a este terminal en el registro de cambios. Se genera una vez.
  device_id TEXT    NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  applying  INTEGER NOT NULL DEFAULT 0 CHECK (applying IN (0,1)),
  -- Último número de cambio recibido del servidor.
  last_seq  INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sync_context (id, device_id)
VALUES (1, lower(hex(randomblob(16))));

CREATE TABLE IF NOT EXISTS sync_outbox (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT    NOT NULL,
  row_id     TEXT    NOT NULL,
  op         TEXT    NOT NULL CHECK (op IN ('upsert','delete')),
  -- JSON de la fila. Nulo en las bajas: no hay nada que describir.
  payload    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS sync_outbox_seq_idx ON sync_outbox (seq);

-- -----------------------------------------------------------------------------
-- settings — una sola fila; solo interesa que viaje al cambiar.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_settings_update
AFTER UPDATE ON settings
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('settings', '1', 'upsert', json_object(
    'restaurant_name',    NEW.restaurant_name,
    'address',            NEW.address,
    'phone',              NEW.phone,
    'currency',           NEW.currency,
    'default_tax_bp',     NEW.default_tax_bp,
    'ticket_header',      NEW.ticket_header,
    'ticket_footer',      NEW.ticket_footer,
    'show_tax_breakdown', NEW.show_tax_breakdown,
    'ticket_format',      NEW.ticket_format,
    'language',           NEW.language));
END;

-- -----------------------------------------------------------------------------
-- staff — el hash del PIN viaja: sin él nadie podría entrar en el terminal
-- nuevo. Es un hash PBKDF2, no el PIN.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_staff_insert
AFTER INSERT ON staff
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('staff', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'full_name', NEW.full_name, 'role', NEW.role,
    'pin_hash', NEW.pin_hash, 'active', NEW.active, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_staff_update
AFTER UPDATE ON staff
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('staff', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'full_name', NEW.full_name, 'role', NEW.role,
    'pin_hash', NEW.pin_hash, 'active', NEW.active, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_staff_delete
AFTER DELETE ON staff
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('staff', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- tables — sin `status`: lo deduce cada equipo del estado de sus cuentas.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_tables_insert
AFTER INSERT ON tables
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('tables', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'number', NEW.number, 'capacity', NEW.capacity));
END;

-- Solo los cambios de configuración. El trigger de estado de mesa dispara un
-- UPDATE en cada cobro y encolarlos sería ruido puro.
CREATE TRIGGER IF NOT EXISTS outbox_tables_update
AFTER UPDATE OF number, capacity ON tables
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('tables', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'number', NEW.number, 'capacity', NEW.capacity));
END;

CREATE TRIGGER IF NOT EXISTS outbox_tables_delete
AFTER DELETE ON tables
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('tables', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_products_insert
AFTER INSERT ON products
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('products', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'price_cents', NEW.price_cents,
    'category', NEW.category, 'available', NEW.available, 'tax_bp', NEW.tax_bp,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_products_update
AFTER UPDATE ON products
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('products', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'price_cents', NEW.price_cents,
    'category', NEW.category, 'available', NEW.available, 'tax_bp', NEW.tax_bp,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_products_delete
AFTER DELETE ON products
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('products', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- orders — sin los totales: salen de las líneas.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_orders_insert
AFTER INSERT ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('orders', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'table_id', NEW.table_id, 'status', NEW.status,
    'tax_bp', NEW.tax_bp, 'opened_by', NEW.opened_by,
    'payment_method', NEW.payment_method, 'payment_ref', NEW.payment_ref,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_orders_update
AFTER UPDATE OF status, tax_bp, payment_method, payment_ref, closed_at ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('orders', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'table_id', NEW.table_id, 'status', NEW.status,
    'tax_bp', NEW.tax_bp, 'opened_by', NEW.opened_by,
    'payment_method', NEW.payment_method, 'payment_ref', NEW.payment_ref,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_orders_delete
AFTER DELETE ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('orders', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- order_items
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_order_items_insert
AFTER INSERT ON order_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('order_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'order_id', NEW.order_id, 'product_id', NEW.product_id,
    'quantity', NEW.quantity, 'unit_price_cents', NEW.unit_price_cents,
    'tax_bp', NEW.tax_bp, 'notes', NEW.notes, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_order_items_update
AFTER UPDATE ON order_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('order_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'order_id', NEW.order_id, 'product_id', NEW.product_id,
    'quantity', NEW.quantity, 'unit_price_cents', NEW.unit_price_cents,
    'tax_bp', NEW.tax_bp, 'notes', NEW.notes, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_order_items_delete
AFTER DELETE ON order_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op)
  VALUES ('order_items', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_expenses_insert
AFTER INSERT ON expenses
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('expenses', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'amount_cents', NEW.amount_cents, 'category', NEW.category,
    'note', NEW.note, 'spent_on', NEW.spent_on, 'created_by', NEW.created_by,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_expenses_update
AFTER UPDATE ON expenses
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('expenses', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'amount_cents', NEW.amount_cents, 'category', NEW.category,
    'note', NEW.note, 'spent_on', NEW.spent_on, 'created_by', NEW.created_by,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_expenses_delete
AFTER DELETE ON expenses
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('expenses', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- inventory_items — sin `stock_milli`: es la suma del libro mayor.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_inventory_items_insert
AFTER INSERT ON inventory_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('inventory_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'unit', NEW.unit,
    'min_stock_milli', NEW.min_stock_milli, 'unit_cost_cents', NEW.unit_cost_cents,
    'active', NEW.active, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_inventory_items_update
AFTER UPDATE OF name, unit, min_stock_milli, unit_cost_cents, active ON inventory_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('inventory_items', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'unit', NEW.unit,
    'min_stock_milli', NEW.min_stock_milli, 'unit_cost_cents', NEW.unit_cost_cents,
    'active', NEW.active, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_inventory_items_delete
AFTER DELETE ON inventory_items
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op)
  VALUES ('inventory_items', OLD.id, 'delete');
END;

-- -----------------------------------------------------------------------------
-- inventory_movements — SOLO los manuales.
--
-- Los que nacen de una venta llevan `order_item_id` y los genera el trigger de
-- inventario a partir de la línea de comanda. Como la línea sí viaja, el
-- terminal que la recibe genera el suyo. Encolar además el original haría que
-- cada venta descontara dos veces.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_inventory_movements_insert
AFTER INSERT ON inventory_movements
WHEN NEW.order_item_id IS NULL
 AND NEW.order_id IS NULL
 AND (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('inventory_movements', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'item_id', NEW.item_id, 'quantity_milli', NEW.quantity_milli,
    'kind', NEW.kind, 'note', NEW.note, 'created_by', NEW.created_by,
    'created_at', NEW.created_at));
END;

-- -----------------------------------------------------------------------------
-- product_recipe — clave compuesta, así que el identificador es «producto/insumo».
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_product_recipe_insert
AFTER INSERT ON product_recipe
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('product_recipe', NEW.product_id || '/' || NEW.item_id, 'upsert',
    json_object('product_id', NEW.product_id, 'item_id', NEW.item_id,
                'quantity_milli', NEW.quantity_milli));
END;

CREATE TRIGGER IF NOT EXISTS outbox_product_recipe_update
AFTER UPDATE ON product_recipe
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('product_recipe', NEW.product_id || '/' || NEW.item_id, 'upsert',
    json_object('product_id', NEW.product_id, 'item_id', NEW.item_id,
                'quantity_milli', NEW.quantity_milli));
END;

CREATE TRIGGER IF NOT EXISTS outbox_product_recipe_delete
AFTER DELETE ON product_recipe
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op)
  VALUES ('product_recipe', OLD.product_id || '/' || OLD.item_id, 'delete');
END;
