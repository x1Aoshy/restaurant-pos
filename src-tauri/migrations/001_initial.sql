-- =============================================================================
-- Esquema local (SQLite). Se aplica solo al abrir la aplicación.
--
-- DINERO EN CENTAVOS. Todos los importes son enteros: 1250 = 12,50. SQLite no
-- tiene tipo decimal, y guardar dinero en coma flotante produce descuadres de
-- un centavo imposibles de explicar después. La conversión a la moneda visible
-- ocurre solo al mostrar.
--
-- Los enumerados de Postgres pasan a CHECK, que da la misma garantía.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Configuración del local (fila única)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  restaurant_name    TEXT    NOT NULL DEFAULT 'Mi restaurante',
  address            TEXT    NOT NULL DEFAULT '',
  phone              TEXT    NOT NULL DEFAULT '',
  currency           TEXT    NOT NULL DEFAULT 'NIO' CHECK (currency IN ('NIO','USD')),
  -- Tasa en puntos básicos: 1000 = 10 %. Entero, por lo mismo que el dinero.
  default_tax_bp     INTEGER NOT NULL DEFAULT 1000 CHECK (default_tax_bp >= 0 AND default_tax_bp < 10000),
  ticket_header      TEXT    NOT NULL DEFAULT '',
  ticket_footer      TEXT    NOT NULL DEFAULT 'Gracias por su visita',
  show_tax_breakdown INTEGER NOT NULL DEFAULT 1 CHECK (show_tax_breakdown IN (0,1)),
  ticket_format      TEXT    NOT NULL DEFAULT 'pos80' CHECK (ticket_format IN ('pos80','a4')),
  language           TEXT    NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

-- -----------------------------------------------------------------------------
-- Personal. La autenticación es local: PIN de 4 a 8 dígitos.
--
-- El PIN se guarda como hash, no en claro. No es defensa contra alguien con
-- acceso físico al archivo —quien lo tenga puede editar la base directamente—
-- sino contra que los PIN queden a la vista de cualquiera que abra el fichero.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id         TEXT    PRIMARY KEY,
  full_name  TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'waiter' CHECK (role IN ('admin','manager','waiter','cashier')),
  pin_hash   TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- Salón
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tables (
  id         TEXT    PRIMARY KEY,
  number     INTEGER NOT NULL UNIQUE,
  capacity   INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
  status     TEXT    NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','billed')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- Carta
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  category      TEXT    NOT NULL DEFAULT 'General',
  available     INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  -- NULL = hereda la tasa por defecto de la casa.
  tax_bp        INTEGER CHECK (tax_bp IS NULL OR (tax_bp >= 0 AND tax_bp < 10000)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category) WHERE available = 1;

-- -----------------------------------------------------------------------------
-- Cuentas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT    PRIMARY KEY,
  table_id       TEXT    NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  status         TEXT    NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','sent_to_kitchen','served','billed','paid','cancelled')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_bp         INTEGER NOT NULL DEFAULT 1000,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  opened_by      TEXT    REFERENCES staff(id) ON DELETE SET NULL,
  payment_method TEXT    CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','other')),
  payment_ref    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at      TEXT
);

-- Una mesa solo puede tener UNA cuenta viva. En SQLite el índice único parcial
-- hace exactamente el mismo trabajo que en Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_order_per_table
  ON orders (table_id)
  WHERE status IN ('open','sent_to_kitchen','served','billed');

CREATE INDEX IF NOT EXISTS orders_closed_idx ON orders (closed_at) WHERE status = 'paid';

-- -----------------------------------------------------------------------------
-- Líneas de comanda
--
-- El precio y la tasa se CONGELAN al vender. Si se leyeran del producto al
-- mostrar, editar la carta reescribiría los tickets ya emitidos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT    PRIMARY KEY,
  order_id        TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      TEXT    NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  tax_bp          INTEGER NOT NULL,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- -----------------------------------------------------------------------------
-- Totales calculados por la base, nunca por el cliente.
--
-- El impuesto se redondea POR LÍNEA antes de sumar, igual que en el ticket
-- impreso: si se redondeara solo al final, el papel y la base dirían cifras
-- distintas.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS recalc_after_item_insert
AFTER INSERT ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items WHERE order_id = NEW.order_id),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(quantity * unit_price_cents * tax_bp / 10000.0) AS INTEGER)), 0)
                        FROM order_items WHERE order_id = NEW.order_id)
  WHERE id = NEW.order_id;
  UPDATE orders SET total_cents = subtotal_cents + tax_cents WHERE id = NEW.order_id;
END;

CREATE TRIGGER IF NOT EXISTS recalc_after_item_update
AFTER UPDATE ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items WHERE order_id = NEW.order_id),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(quantity * unit_price_cents * tax_bp / 10000.0) AS INTEGER)), 0)
                        FROM order_items WHERE order_id = NEW.order_id)
  WHERE id = NEW.order_id;
  UPDATE orders SET total_cents = subtotal_cents + tax_cents WHERE id = NEW.order_id;
END;

CREATE TRIGGER IF NOT EXISTS recalc_after_item_delete
AFTER DELETE ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items WHERE order_id = OLD.order_id),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(quantity * unit_price_cents * tax_bp / 10000.0) AS INTEGER)), 0)
                        FROM order_items WHERE order_id = OLD.order_id)
  WHERE id = OLD.order_id;
  UPDATE orders SET total_cents = subtotal_cents + tax_cents WHERE id = OLD.order_id;
END;

-- -----------------------------------------------------------------------------
-- El estado de la mesa sigue al de la cuenta, para que el salón no pueda
-- desincronizarse porque alguien olvidó actualizarlo.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS table_status_on_order_insert
AFTER INSERT ON orders
BEGIN
  UPDATE tables SET status = 'occupied', updated_at = datetime('now')
   WHERE id = NEW.table_id;
END;

CREATE TRIGGER IF NOT EXISTS table_status_on_order_update
AFTER UPDATE OF status ON orders
WHEN NEW.status <> OLD.status
BEGIN
  UPDATE tables SET
    status = CASE
      WHEN NEW.status IN ('paid','cancelled') THEN 'available'
      WHEN NEW.status = 'billed'              THEN 'billed'
      ELSE 'occupied'
    END,
    updated_at = datetime('now')
  WHERE id = NEW.table_id;

  UPDATE orders SET closed_at = datetime('now')
   WHERE id = NEW.id
     AND NEW.status IN ('paid','cancelled')
     AND closed_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS table_status_on_order_delete
AFTER DELETE ON orders
BEGIN
  UPDATE tables SET status = 'available', updated_at = datetime('now')
   WHERE id = OLD.table_id
     AND NOT EXISTS (
       SELECT 1 FROM orders
        WHERE table_id = OLD.table_id
          AND status IN ('open','sent_to_kitchen','served','billed')
     );
END;

-- -----------------------------------------------------------------------------
-- Gastos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT    PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category     TEXT    NOT NULL DEFAULT 'General',
  note         TEXT,
  spent_on     TEXT    NOT NULL,
  created_by   TEXT    REFERENCES staff(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (spent_on DESC);

-- -----------------------------------------------------------------------------
-- Inventario: insumos, recetas y libro mayor.
--
-- Las cantidades van en milésimas (1500 = 1,5 kg): mismo motivo que el dinero.
-- El stock es la suma del libro mayor, mantenida por trigger — nunca un campo
-- que se edite a mano.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  unit            TEXT    NOT NULL DEFAULT 'unidad',
  stock_milli     INTEGER NOT NULL DEFAULT 0,
  min_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_milli >= 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_idx
  ON inventory_items (LOWER(name));

CREATE TABLE IF NOT EXISTS product_recipe (
  product_id     TEXT    NOT NULL REFERENCES products(id)        ON DELETE CASCADE,
  item_id        TEXT    NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  PRIMARY KEY (product_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id             TEXT    PRIMARY KEY,
  item_id        TEXT    NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli <> 0),
  kind           TEXT    NOT NULL
                   CHECK (kind IN ('initial','purchase','sale','reversal','waste','adjustment')),
  note           TEXT,
  order_id       TEXT    REFERENCES orders(id) ON DELETE SET NULL,
  created_by     TEXT    REFERENCES staff(id)  ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS inventory_movements_item_idx
  ON inventory_movements (item_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS stock_after_movement_insert
AFTER INSERT ON inventory_movements
BEGIN
  UPDATE inventory_items
     SET stock_milli = (SELECT COALESCE(SUM(quantity_milli), 0)
                          FROM inventory_movements WHERE item_id = NEW.item_id)
   WHERE id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS stock_after_movement_delete
AFTER DELETE ON inventory_movements
BEGIN
  UPDATE inventory_items
     SET stock_milli = (SELECT COALESCE(SUM(quantity_milli), 0)
                          FROM inventory_movements WHERE item_id = OLD.item_id)
   WHERE id = OLD.item_id;
END;

-- Consumo automático al vender. El seguimiento es opcional: un producto sin
-- receta no mueve inventario, así que se puede controlar la cerveza sin tener
-- que despiezar cada plato del menú.
CREATE TRIGGER IF NOT EXISTS stock_on_item_insert
AFTER INSERT ON order_items
BEGIN
  INSERT INTO inventory_movements (id, item_id, quantity_milli, kind, order_id)
  SELECT lower(hex(randomblob(16))), r.item_id,
         -(r.quantity_milli * NEW.quantity), 'sale', NEW.order_id
    FROM product_recipe r
   WHERE r.product_id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS stock_on_item_delete
AFTER DELETE ON order_items
BEGIN
  INSERT INTO inventory_movements (id, item_id, quantity_milli, kind)
  SELECT lower(hex(randomblob(16))), r.item_id,
         (r.quantity_milli * OLD.quantity), 'reversal'
    FROM product_recipe r
   WHERE r.product_id = OLD.product_id;
END;
