-- =============================================================================
-- Lo que el cliente entrega en mano, y lo que se le devuelve.
--
-- Faltaba una pieza que se usa en cada cobro en efectivo del día: el ticket
-- decía cuánto costaba la cuenta, pero no cuánto entregó el cliente ni cuánto
-- vuelto se le dio. Cuando alguien reclama —«te di quinientos»— no había dónde
-- mirar.
--
-- Se guarda UN solo número, `tendered_cents`. El vuelto y lo que falte se
-- deducen de él y del total:
--
--   vuelto   = MAX(0, entregado - (total + propina))
--   pendiente = MAX(0, (total + propina) - entregado)
--
-- Guardar los tres sería guardar la misma verdad tres veces, y las tres podrían
-- dejar de coincidir. Nulo significa «no se anotó», que es lo normal en tarjeta
-- y en las cuentas cobradas antes de esta versión.
--
-- Cobrar de menos ocurre —el cliente no llega, se le perdona el resto, se paga
-- a medias—, así que la aplicación lo permite; lo que no hace es esconderlo.
-- =============================================================================

ALTER TABLE orders ADD COLUMN tendered_cents INTEGER;


-- -----------------------------------------------------------------------------
-- El cajón recibe lo que de verdad entró, no lo que decía la cuenta.
--
-- El trigger anterior metía siempre `total + propina`. Si el cliente pagó de
-- menos, el arqueo esperaba un dinero que nunca estuvo en el cajón y el
-- descuadre aparecía al cerrar, sin explicación posible a esas horas.
--
-- El vuelto NO se resta: sale del mismo cajón donde acaba de entrar el billete,
-- así que en neto queda lo cobrado. Anotar entrada y salida por separado sería
-- más fiel pero llenaría el arqueo de ruido sin cambiar ni un centavo el total.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS cash_on_order_paid;

CREATE TRIGGER cash_on_order_paid
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'paid' AND OLD.status <> 'paid'
 AND NEW.payment_method = 'cash'
 AND NEW.total_cents + NEW.tip_cents <> 0
 AND (SELECT applying FROM sync_context WHERE id = 1) = 0
BEGIN
  INSERT INTO cash_movements (id, register_id, kind, amount_cents, order_id, created_by)
  SELECT lower(hex(randomblob(16))), r.id, 'sale',
         CASE
           WHEN NEW.tendered_cents IS NOT NULL
            AND NEW.tendered_cents < NEW.total_cents + NEW.tip_cents
           THEN NEW.tendered_cents
           ELSE NEW.total_cents + NEW.tip_cents
         END,
         NEW.id, NEW.opened_by
    FROM cash_registers r
   WHERE r.status = 'open'
     AND r.device_id = (SELECT device_id FROM sync_context WHERE id = 1);
END;


-- -----------------------------------------------------------------------------
-- El buzón de sincronización, con la columna nueva.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS outbox_orders_insert;
DROP TRIGGER IF EXISTS outbox_orders_update;

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
    'tendered_cents', NEW.tendered_cents,
    'discount_reason', NEW.discount_reason, 'discount_by', NEW.discount_by,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;

CREATE TRIGGER outbox_orders_update
AFTER UPDATE ON orders
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('orders', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'table_id', NEW.table_id, 'status', NEW.status,
    'tax_bp', NEW.tax_bp, 'opened_by', NEW.opened_by,
    'payment_method', NEW.payment_method, 'payment_ref', NEW.payment_ref,
    'tip_cents', NEW.tip_cents,
    'tendered_cents', NEW.tendered_cents,
    'discount_reason', NEW.discount_reason, 'discount_by', NEW.discount_by,
    'created_at', NEW.created_at, 'closed_at', NEW.closed_at));
END;
