-- =============================================================================
-- Turnos de caja, propinas, descuentos, anulaciones y enrutado de impresoras.
--
-- ## Tres decisiones que conviene tener claras antes de leer el SQL
--
-- 1. **La propina NO entra en `total_cents`.** El resumen suma ese campo para
--    calcular ingresos y margen; meter ahí la propina inflaría las dos cifras
--    con dinero que es del mesero, no del local. `total_cents` sigue siendo la
--    venta. Lo que se cobra de verdad es `total_cents + tip_cents`, y eso es lo
--    que entra en el cajón.
--
-- 2. **El descuento va POR LÍNEA y antes del impuesto.** Es lo correcto
--    fiscalmente —se tributa sobre lo que se cobra— y encaja con el redondeo
--    por línea que ya usa toda la casa. `orders.discount_cents` existe, pero lo
--    mantiene un trigger sumando las líneas: no se escribe a mano, para que no
--    haya dos verdades.
--
-- 3. **Anular no es borrar.** Una línea anulada se marca, no desaparece: hace
--    falta el rastro de quién la quitó y por qué. Los totales la ignoran y el
--    inventario devuelve lo que había consumido, exactamente igual que en un
--    borrado.
--
-- Con descuento 0, propina 0 y nada anulado, todas las fórmulas dan el mismo
-- número que antes. Las cuentas ya cerradas no se mueven.
-- =============================================================================


-- =============================================================================
-- 1. PROPINAS, DESCUENTOS Y ANULACIONES
-- =============================================================================

ALTER TABLE orders ADD COLUMN tip_cents      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_reason TEXT;
-- Quién autorizó. La interfaz solo ofrece el descuento a admin y gerente, pero
-- eso organiza la pantalla; lo que deja constancia es esta columna.
ALTER TABLE orders ADD COLUMN discount_by    TEXT REFERENCES staff(id) ON DELETE SET NULL;

ALTER TABLE order_items ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN voided_at   TEXT;
ALTER TABLE order_items ADD COLUMN void_reason TEXT;
ALTER TABLE order_items ADD COLUMN voided_by   TEXT REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_items_live_idx
  ON order_items (order_id) WHERE voided_at IS NULL;

-- -----------------------------------------------------------------------------
-- Totales, versión nueva.
--
--   base de línea = cantidad × precio − descuento
--   impuesto      = ROUND(base × bp / 10000)      ← por línea, como siempre
--   subtotal      = Σ (cantidad × precio)          ← bruto, para que el ticket
--                                                    pueda enseñar el descuento
--   total         = subtotal − descuento + impuesto
--
-- Se repite el mismo cuerpo en cuatro triggers porque SQLite no tiene funciones
-- ni procedimientos: no hay forma de escribirlo una sola vez. Cualquier cambio
-- en la fórmula hay que hacerlo en los cuatro.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS recalc_after_item_insert;
DROP TRIGGER IF EXISTS recalc_after_item_update;
DROP TRIGGER IF EXISTS recalc_after_item_delete;
DROP TRIGGER IF EXISTS recalc_after_item_moved;

CREATE TRIGGER recalc_after_item_insert
AFTER INSERT ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL),
    discount_cents = (SELECT COALESCE(SUM(discount_cents), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(
                        (quantity * unit_price_cents - discount_cents) * tax_bp / 10000.0
                      ) AS INTEGER)), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL)
  WHERE id = NEW.order_id;
  UPDATE orders SET total_cents = subtotal_cents - discount_cents + tax_cents
   WHERE id = NEW.order_id;
END;

CREATE TRIGGER recalc_after_item_update
AFTER UPDATE ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL),
    discount_cents = (SELECT COALESCE(SUM(discount_cents), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(
                        (quantity * unit_price_cents - discount_cents) * tax_bp / 10000.0
                      ) AS INTEGER)), 0)
                        FROM order_items
                       WHERE order_id = NEW.order_id AND voided_at IS NULL)
  WHERE id = NEW.order_id;
  UPDATE orders SET total_cents = subtotal_cents - discount_cents + tax_cents
   WHERE id = NEW.order_id;
END;

CREATE TRIGGER recalc_after_item_delete
AFTER DELETE ON order_items
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL),
    discount_cents = (SELECT COALESCE(SUM(discount_cents), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(
                        (quantity * unit_price_cents - discount_cents) * tax_bp / 10000.0
                      ) AS INTEGER)), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL)
  WHERE id = OLD.order_id;
  UPDATE orders SET total_cents = subtotal_cents - discount_cents + tax_cents
   WHERE id = OLD.order_id;
END;

-- Al mover una línea entre cuentas (fusión de comandas), el trigger de UPDATE
-- ya recalcula la que la recibe. Este recalcula la que la pierde.
CREATE TRIGGER recalc_after_item_moved
AFTER UPDATE OF order_id ON order_items
WHEN NEW.order_id <> OLD.order_id
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL),
    discount_cents = (SELECT COALESCE(SUM(discount_cents), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(
                        (quantity * unit_price_cents - discount_cents) * tax_bp / 10000.0
                      ) AS INTEGER)), 0)
                        FROM order_items
                       WHERE order_id = OLD.order_id AND voided_at IS NULL)
  WHERE id = OLD.order_id;
  UPDATE orders SET total_cents = subtotal_cents - discount_cents + tax_cents
   WHERE id = OLD.order_id;
END;

-- Anular devuelve al inventario exactamente lo apuntado para esa línea. Mismo
-- criterio —y misma idempotencia— que el borrado: si ya está saldada, el HAVING
-- deja la suma fuera y no se devuelve dos veces.
CREATE TRIGGER IF NOT EXISTS stock_on_item_void
AFTER UPDATE OF voided_at ON order_items
WHEN NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL
BEGIN
  INSERT INTO inventory_movements
    (id, item_id, quantity_milli, kind, order_item_id)
  SELECT lower(hex(randomblob(16))), m.item_id,
         -SUM(m.quantity_milli), 'reversal', OLD.id
    FROM inventory_movements m
   WHERE m.order_item_id = OLD.id
   GROUP BY m.item_id
  HAVING SUM(m.quantity_milli) <> 0;
END;


-- =============================================================================
-- 2. TURNOS DE CAJA
-- =============================================================================

CREATE TABLE IF NOT EXISTS cash_registers (
  id                  TEXT    PRIMARY KEY,
  -- Un cajón es físico y pertenece a un equipo, no al negocio. Se guarda para
  -- que el arqueo de un terminal no se mezcle con el de otro.
  device_id           TEXT    NOT NULL,
  opened_by           TEXT    REFERENCES staff(id) ON DELETE SET NULL,
  opened_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  opening_float_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),

  closed_by           TEXT    REFERENCES staff(id) ON DELETE SET NULL,
  closed_at           TEXT,
  -- Lo que se contó a mano al cerrar. Nulo mientras el turno sigue abierto.
  counted_cents       INTEGER,

  -- Calculados por trigger. Nunca se escriben desde la interfaz: si el descuadre
  -- se pudiera teclear, dejaría de significar nada.
  expected_cents      INTEGER NOT NULL DEFAULT 0,
  difference_cents    INTEGER NOT NULL DEFAULT 0,

  status              TEXT    NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','closed')),
  note                TEXT
);

-- Un solo turno abierto por equipo. Mismo razonamiento que una cuenta viva por
-- mesa: dos cajas abiertas a la vez hacen que ningún arqueo cuadre.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_register_per_device
  ON cash_registers (device_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS cash_registers_opened_idx
  ON cash_registers (opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_movements (
  id           TEXT    PRIMARY KEY,
  register_id  TEXT    NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL
                 CHECK (kind IN ('sale','refund','drop','payout','adjustment')),
  -- Con signo: entra positivo, sale negativo. Una retirada a la caja fuerte es
  -- negativa aunque se teclee en positivo; eso lo pone la interfaz.
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  order_id     TEXT    REFERENCES orders(id) ON DELETE SET NULL,
  note         TEXT,
  created_by   TEXT    REFERENCES staff(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS cash_movements_register_idx
  ON cash_movements (register_id, created_at);

-- -----------------------------------------------------------------------------
-- Lo esperado en el cajón es el fondo inicial más todo el movimiento. Se
-- recalcula entero en vez de ir sumando: sumar acumula el error de cualquier
-- fallo intermedio y no hay forma de notarlo hasta el arqueo.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS register_total_after_movement_insert
AFTER INSERT ON cash_movements
BEGIN
  UPDATE cash_registers
     SET expected_cents = opening_float_cents
                        + (SELECT COALESCE(SUM(amount_cents), 0)
                             FROM cash_movements WHERE register_id = NEW.register_id)
   WHERE id = NEW.register_id;
  UPDATE cash_registers
     SET difference_cents = COALESCE(counted_cents, expected_cents) - expected_cents
   WHERE id = NEW.register_id;
END;

CREATE TRIGGER IF NOT EXISTS register_total_after_movement_delete
AFTER DELETE ON cash_movements
BEGIN
  UPDATE cash_registers
     SET expected_cents = opening_float_cents
                        + (SELECT COALESCE(SUM(amount_cents), 0)
                             FROM cash_movements WHERE register_id = OLD.register_id)
   WHERE id = OLD.register_id;
  UPDATE cash_registers
     SET difference_cents = COALESCE(counted_cents, expected_cents) - expected_cents
   WHERE id = OLD.register_id;
END;

-- El descuadre aparece en cuanto se teclea el recuento, no al guardar el cierre.
CREATE TRIGGER IF NOT EXISTS register_difference_on_count
AFTER UPDATE OF counted_cents ON cash_registers
WHEN NEW.counted_cents IS NOT NULL
BEGIN
  UPDATE cash_registers
     SET difference_cents = NEW.counted_cents - NEW.expected_cents
   WHERE id = NEW.id;
END;

-- -----------------------------------------------------------------------------
-- Cobrar en efectivo mete el dinero en el cajón solo.
--
-- Dos guardas que no son opcionales:
--
--   * `applying = 0` — al recibir por sincronización la venta de OTRO terminal,
--     este trigger crearía un apunte en el cajón de aquí. El dinero no está
--     aquí. Mismo error que ya costó una vez con el inventario.
--   * el turno tiene que ser de ESTE equipo y estar abierto. Si no hay ninguno,
--     el SELECT no devuelve filas y no se apunta nada: cobrar sin caja abierta
--     no debe fallar, solo no cuadra en el arqueo.
--
-- Va el total MÁS la propina: es el efectivo que el cliente deja encima.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS cash_on_order_paid
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'paid' AND OLD.status <> 'paid'
 AND NEW.payment_method = 'cash'
 AND NEW.total_cents + NEW.tip_cents <> 0
 AND (SELECT applying FROM sync_context WHERE id = 1) = 0
BEGIN
  INSERT INTO cash_movements (id, register_id, kind, amount_cents, order_id, created_by)
  SELECT lower(hex(randomblob(16))), r.id, 'sale',
         NEW.total_cents + NEW.tip_cents, NEW.id, NEW.opened_by
    FROM cash_registers r
   WHERE r.status = 'open'
     AND r.device_id = (SELECT device_id FROM sync_context WHERE id = 1);
END;


-- =============================================================================
-- 3. IMPRESORAS Y ENRUTADO POR ZONA
-- =============================================================================

CREATE TABLE IF NOT EXISTS zones (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS printers (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  connection  TEXT    NOT NULL DEFAULT 'network'
                CHECK (connection IN ('network','usb')),
  -- IP para red, ruta o identificador del dispositivo para USB.
  address     TEXT    NOT NULL DEFAULT '',
  port        INTEGER NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
  -- Caracteres por línea: 48 en papel de 80 mm, 32 en el de 58 mm. Lo necesita
  -- el adaptador ESC/POS para partir el texto.
  width_chars INTEGER NOT NULL DEFAULT 48 CHECK (width_chars BETWEEN 20 AND 96),
  -- Si esta impresora es la que abre el cajón portamonedas.
  opens_drawer INTEGER NOT NULL DEFAULT 0 CHECK (opens_drawer IN (0,1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A qué grupo de impresión pertenece cada producto. Las bebidas van a la barra
-- y la comida a la cocina; el producto dice QUÉ es, nunca a qué IP va.
ALTER TABLE products ADD COLUMN print_group TEXT NOT NULL DEFAULT 'food';

-- Dónde está físicamente la mesa. Manda para las comandas de cocina y barra: lo
-- que importa es a qué planta hay que llevar el plato, no desde qué ordenador
-- se apuntó.
-- Sin clave foránea, como `merged_into`: esta columna cruza la sincronización.
-- Si un equipo crea la zona y otro asigna la mesa antes de que la primera haya
-- salido, la fila llegaría apuntando a una zona que aquí todavía no existe, y
-- una clave foránea tumbaría el lote entero dejando el terminal atascado.
ALTER TABLE tables ADD COLUMN zone_id TEXT;

-- Dónde está este TERMINAL. Manda para el ticket del cliente y para el cajón.
-- Va en `sync_context` porque es lo único que no se sincroniza: si viviera en
-- `settings`, el último equipo que lo tocara le pondría su planta a todos.
ALTER TABLE sync_context ADD COLUMN zone_id TEXT;

-- Referencias blandas por el mismo motivo que `tables.zone_id`. La limpieza que
-- daría el ON DELETE CASCADE se hace con triggers, unas líneas más abajo.
CREATE TABLE IF NOT EXISTS printer_routing (
  id          TEXT PRIMARY KEY,
  -- Nulo = vale para cualquier zona. Es la regla de reserva, para no obligar a
  -- declarar cada combinación en un local de una sola planta.
  zone_id     TEXT,
  print_group TEXT NOT NULL,
  printer_id  TEXT NOT NULL
);

-- Una sola regla por combinación. Se indexa sobre COALESCE porque en SQLite dos
-- NULL no se consideran iguales, y sin esto podrían convivir varias reglas de
-- reserva para el mismo grupo sin que nadie se enterara.
CREATE UNIQUE INDEX IF NOT EXISTS printer_routing_unique
  ON printer_routing (COALESCE(zone_id, '*'), print_group);

-- Lo que haría el ON DELETE CASCADE que no podemos poner.
CREATE TRIGGER IF NOT EXISTS routing_cleanup_on_printer_delete
AFTER DELETE ON printers
BEGIN
  DELETE FROM printer_routing WHERE printer_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS routing_cleanup_on_zone_delete
AFTER DELETE ON zones
BEGIN
  DELETE FROM printer_routing WHERE zone_id = OLD.id;
  UPDATE tables SET zone_id = NULL WHERE zone_id = OLD.id;
END;


-- =============================================================================
-- 4. SINCRONIZACIÓN
--
-- Todo lo nuevo que sea configuración compartida —zonas, impresoras, enrutado—
-- y el rastro de caja viaja entre terminales. Lo calculado no: los totales de
-- la cuenta y lo esperado en el cajón los deduce cada equipo de sus propias
-- filas de origen.
--
-- `cash_movements` de tipo 'sale' SÍ viaja, para que el dueño vea el arqueo de
-- los dos puestos desde uno. Lo que no puede pasar es que al recibirlo se genere
-- otro apunte encima: de eso se ocupa la guarda `applying` del trigger de cobro.
-- =============================================================================

DROP TRIGGER IF EXISTS outbox_orders_insert;
DROP TRIGGER IF EXISTS outbox_orders_update;
DROP TRIGGER IF EXISTS outbox_order_items_insert;
DROP TRIGGER IF EXISTS outbox_order_items_update;
DROP TRIGGER IF EXISTS outbox_products_insert;
DROP TRIGGER IF EXISTS outbox_products_update;
DROP TRIGGER IF EXISTS outbox_tables_insert;
DROP TRIGGER IF EXISTS outbox_tables_update;

CREATE TRIGGER outbox_orders_insert
AFTER INSERT ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('orders', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'table_id', NEW.table_id, 'status', NEW.status,
    'tax_bp', NEW.tax_bp, 'opened_by', NEW.opened_by,
    'payment_method', NEW.payment_method, 'payment_ref', NEW.payment_ref,
    'tip_cents', NEW.tip_cents,
    'discount_reason', NEW.discount_reason, 'discount_by', NEW.discount_by,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;

CREATE TRIGGER outbox_orders_update
AFTER UPDATE OF status, tax_bp, payment_method, payment_ref, closed_at,
                tip_cents, discount_reason, discount_by ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('orders', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'table_id', NEW.table_id, 'status', NEW.status,
    'tax_bp', NEW.tax_bp, 'opened_by', NEW.opened_by,
    'payment_method', NEW.payment_method, 'payment_ref', NEW.payment_ref,
    'tip_cents', NEW.tip_cents,
    'discount_reason', NEW.discount_reason, 'discount_by', NEW.discount_by,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;

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
    'created_at', NEW.created_at));
END;

CREATE TRIGGER outbox_products_insert
AFTER INSERT ON products
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('products', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'price_cents', NEW.price_cents,
    'category', NEW.category, 'available', NEW.available, 'tax_bp', NEW.tax_bp,
    'print_group', NEW.print_group, 'created_at', NEW.created_at));
END;

CREATE TRIGGER outbox_products_update
AFTER UPDATE ON products
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('products', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'price_cents', NEW.price_cents,
    'category', NEW.category, 'available', NEW.available, 'tax_bp', NEW.tax_bp,
    'print_group', NEW.print_group, 'created_at', NEW.created_at));
END;

CREATE TRIGGER outbox_tables_insert
AFTER INSERT ON tables
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('tables', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'number', NEW.number, 'capacity', NEW.capacity,
    'zone_id', NEW.zone_id));
END;

CREATE TRIGGER outbox_tables_update
AFTER UPDATE OF number, capacity, zone_id ON tables
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('tables', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'number', NEW.number, 'capacity', NEW.capacity,
    'zone_id', NEW.zone_id));
END;

-- -----------------------------------------------------------------------------
-- Tablas nuevas. `expected_cents` y `difference_cents` no viajan: los recalcula
-- cada equipo desde los movimientos, igual que los totales de la cuenta.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS outbox_zones_insert
AFTER INSERT ON zones
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('zones', NEW.id, 'upsert',
    json_object('id', NEW.id, 'name', NEW.name, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_zones_update
AFTER UPDATE ON zones
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('zones', NEW.id, 'upsert',
    json_object('id', NEW.id, 'name', NEW.name, 'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_zones_delete
AFTER DELETE ON zones
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('zones', OLD.id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS outbox_printers_insert
AFTER INSERT ON printers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'connection', NEW.connection,
    'address', NEW.address, 'port', NEW.port, 'width_chars', NEW.width_chars,
    'opens_drawer', NEW.opens_drawer, 'active', NEW.active,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_printers_update
AFTER UPDATE ON printers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'connection', NEW.connection,
    'address', NEW.address, 'port', NEW.port, 'width_chars', NEW.width_chars,
    'opens_drawer', NEW.opens_drawer, 'active', NEW.active,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER IF NOT EXISTS outbox_printers_delete
AFTER DELETE ON printers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op) VALUES ('printers', OLD.id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS outbox_printer_routing_insert
AFTER INSERT ON printer_routing
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printer_routing', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'zone_id', NEW.zone_id, 'print_group', NEW.print_group,
    'printer_id', NEW.printer_id));
END;

CREATE TRIGGER IF NOT EXISTS outbox_printer_routing_update
AFTER UPDATE ON printer_routing
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printer_routing', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'zone_id', NEW.zone_id, 'print_group', NEW.print_group,
    'printer_id', NEW.printer_id));
END;

CREATE TRIGGER IF NOT EXISTS outbox_printer_routing_delete
AFTER DELETE ON printer_routing
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op)
  VALUES ('printer_routing', OLD.id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS outbox_cash_registers_insert
AFTER INSERT ON cash_registers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('cash_registers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'device_id', NEW.device_id, 'opened_by', NEW.opened_by,
    'opened_at', NEW.opened_at, 'opening_float_cents', NEW.opening_float_cents,
    'closed_by', NEW.closed_by, 'closed_at', NEW.closed_at,
    'counted_cents', NEW.counted_cents, 'status', NEW.status, 'note', NEW.note));
END;

CREATE TRIGGER IF NOT EXISTS outbox_cash_registers_update
AFTER UPDATE OF closed_by, closed_at, counted_cents, status, note
  ON cash_registers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('cash_registers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'device_id', NEW.device_id, 'opened_by', NEW.opened_by,
    'opened_at', NEW.opened_at, 'opening_float_cents', NEW.opening_float_cents,
    'closed_by', NEW.closed_by, 'closed_at', NEW.closed_at,
    'counted_cents', NEW.counted_cents, 'status', NEW.status, 'note', NEW.note));
END;

CREATE TRIGGER IF NOT EXISTS outbox_cash_movements_insert
AFTER INSERT ON cash_movements
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('cash_movements', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'register_id', NEW.register_id, 'kind', NEW.kind,
    'amount_cents', NEW.amount_cents, 'order_id', NEW.order_id,
    'note', NEW.note, 'created_by', NEW.created_by,
    'created_at', NEW.created_at));
END;
