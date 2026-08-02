-- =============================================================================
-- El libro de inventario pasa a apuntar a la LÍNEA de comanda, no solo a la
-- cuenta.
--
-- El esquema inicial tenía dos agujeros, comprobados ejecutando los triggers:
--
--   1. Cambiar la cantidad de una línea no movía existencias. Si el mesero
--      apuntaba una Coca-Cola y luego la corregía a tres, se vendían tres y se
--      descontaba una. El informe de «cuántas vendí hoy» mentía en silencio.
--   2. Al borrar una cuenta, la devolución se calculaba sobre la cantidad
--      actual de la línea, no sobre lo que realmente se había descontado, así
--      que el error de arriba se convertía además en existencias de más.
--
-- La corrección es hacer que cada apunte lleve el identificador de su línea.
-- Con eso la devolución siempre es «lo contrario de lo que hay apuntado para
-- esta línea», que es correcto sin importar cuántas veces se corrigiera la
-- cantidad, y no puede duplicarse: si la línea ya está saldada, la suma es
-- cero y no se apunta nada.
--
-- Los apuntes anteriores a esta migración quedan sin línea asociada. No se
-- intenta reconstruirlos: adivinar a qué línea pertenecía cada uno daría cifras
-- inventadas. Si el inventario ya estaba en uso, conviene recontar una vez con
-- un movimiento de tipo «Ajuste».
-- =============================================================================

ALTER TABLE inventory_movements ADD COLUMN order_item_id TEXT;

CREATE INDEX IF NOT EXISTS inventory_movements_line_idx
  ON inventory_movements (order_item_id);

DROP TRIGGER IF EXISTS stock_on_item_insert;
DROP TRIGGER IF EXISTS stock_on_item_delete;

-- Venta: descuenta la receta multiplicada por la cantidad.
CREATE TRIGGER stock_on_item_insert
AFTER INSERT ON order_items
BEGIN
  INSERT INTO inventory_movements
    (id, item_id, quantity_milli, kind, order_id, order_item_id)
  SELECT lower(hex(randomblob(16))), r.item_id,
         -(r.quantity_milli * NEW.quantity), 'sale', NEW.order_id, NEW.id
    FROM product_recipe r
   WHERE r.product_id = NEW.product_id;
END;

-- Corrección de cantidad: apunta solo la diferencia. Sumar la diferencia y no
-- reescribir el apunte deja el rastro completo de lo que pasó en la mesa.
CREATE TRIGGER stock_on_item_quantity_update
AFTER UPDATE OF quantity ON order_items
WHEN NEW.quantity <> OLD.quantity
BEGIN
  INSERT INTO inventory_movements
    (id, item_id, quantity_milli, kind, order_id, order_item_id)
  SELECT lower(hex(randomblob(16))), r.item_id,
         -(r.quantity_milli * (NEW.quantity - OLD.quantity)),
         CASE WHEN NEW.quantity > OLD.quantity THEN 'sale' ELSE 'reversal' END,
         NEW.order_id, NEW.id
    FROM product_recipe r
   WHERE r.product_id = NEW.product_id;
END;

-- Devolución al borrar la línea: exactamente lo contrario de lo apuntado.
-- El HAVING cumple dos funciones: respeta el CHECK (quantity_milli <> 0) y
-- hace la operación idempotente — una línea ya saldada no devuelve nada.
--
-- Se consulta por `order_item_id` y no por la cuenta porque al borrar una
-- cuenta entera el CASCADE llega aquí con la fila padre YA borrada; está
-- comprobado. La línea, en cambio, siempre se conoce.
CREATE TRIGGER stock_on_item_delete
AFTER DELETE ON order_items
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

-- Anular una cuenta devuelve las existencias: lo que no se cobró no se vendió,
-- y si no volviera al almacén el recuento del día saldría corto.
CREATE TRIGGER stock_on_order_cancel
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
BEGIN
  INSERT INTO inventory_movements
    (id, item_id, quantity_milli, kind, order_id, order_item_id)
  SELECT lower(hex(randomblob(16))), m.item_id,
         -SUM(m.quantity_milli), 'reversal', NEW.id, oi.id
    FROM order_items oi
    JOIN inventory_movements m ON m.order_item_id = oi.id
   WHERE oi.order_id = NEW.id
   GROUP BY oi.id, m.item_id
  HAVING SUM(m.quantity_milli) <> 0;
END;
