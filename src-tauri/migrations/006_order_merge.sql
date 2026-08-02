-- =============================================================================
-- Fusión de comandas: dos terminales abren la misma mesa a la vez.
--
-- ## Qué pasaba
--
-- El índice `one_live_order_per_table` impide dos cuentas vivas en una mesa, y
-- eso está bien mientras solo escriba un equipo. Con dos, cada uno abre la suya
-- sin ver al otro y al sincronizar la segunda choca contra el índice. Como los
-- cambios se aplican en una transacción, el choque tumba el lote entero,
-- `last_seq` no avanza y el terminal reintenta lo mismo cada treinta segundos
-- para siempre. No es que quedaran dos cuentas: es que la sincronización moría.
--
-- ## Cómo se resuelve
--
-- Ninguna comanda se descarta nunca. Se quedan las dos, pero una absorbe a la
-- otra: la más antigua se lleva las líneas de la más nueva, y esta queda
-- marcada con `merged_into` apuntando a su destino.
--
-- «La más antigua» se decide por `(created_at, id)`, y ese desempate es lo que
-- hace que funcione sin coordinar nada: los dos terminales tienen las dos filas,
-- aplican la misma regla y llegan al mismo resultado por su cuenta. No hace
-- falta que ninguno anuncie la fusión, y por eso la fusión NO se apunta en el
-- buzón — se recalcula en cada equipo.
--
-- No se usa un estado nuevo («merged») porque cambiar un CHECK en SQLite obliga
-- a reconstruir la tabla, y reconstruir `orders` con las claves foráneas de
-- `order_items` apuntándole es una operación que no cabe dentro de la
-- transacción en la que corren estas migraciones. Una columna y un índice
-- parcial dan la misma garantía sin tocar la tabla.
-- =============================================================================

ALTER TABLE orders ADD COLUMN merged_into TEXT REFERENCES orders(id);

-- Una cuenta absorbida deja de estar viva aunque conserve su estado: así el
-- historial sigue diciendo la verdad de lo que pasó en la mesa.
DROP INDEX IF EXISTS one_live_order_per_table;
CREATE UNIQUE INDEX one_live_order_per_table
  ON orders (table_id)
  WHERE status IN ('open','sent_to_kitchen','served','billed')
    AND merged_into IS NULL;

CREATE INDEX IF NOT EXISTS orders_merged_idx
  ON orders (merged_into) WHERE merged_into IS NOT NULL;

-- La mesa solo se libera si no queda ninguna cuenta viva DE VERDAD. Sin esta
-- corrección, absorber la última cuenta de una mesa la dejaría ocupada para
-- siempre.
DROP TRIGGER IF EXISTS table_status_on_order_delete;
CREATE TRIGGER table_status_on_order_delete
AFTER DELETE ON orders
BEGIN
  UPDATE tables SET status = 'available', updated_at = datetime('now')
   WHERE id = OLD.table_id
     AND NOT EXISTS (
       SELECT 1 FROM orders
        WHERE table_id = OLD.table_id
          AND status IN ('open','sent_to_kitchen','served','billed')
          AND merged_into IS NULL
     );
END;

-- Al absorber una cuenta, la mesa vuelve a mirar quién queda vivo. Es el mismo
-- razonamiento que el borrado: la fila sigue ahí, pero ya no cuenta.
CREATE TRIGGER IF NOT EXISTS table_status_on_order_merge
AFTER UPDATE OF merged_into ON orders
WHEN NEW.merged_into IS NOT NULL AND OLD.merged_into IS NULL
BEGIN
  UPDATE tables SET
    status = CASE
      WHEN EXISTS (SELECT 1 FROM orders
                    WHERE table_id = NEW.table_id AND merged_into IS NULL
                      AND status = 'billed')                    THEN 'billed'
      WHEN EXISTS (SELECT 1 FROM orders
                    WHERE table_id = NEW.table_id AND merged_into IS NULL
                      AND status IN ('open','sent_to_kitchen','served')) THEN 'occupied'
      ELSE 'available'
    END,
    updated_at = datetime('now')
  WHERE id = NEW.table_id;
END;

-- Mover una línea de una cuenta a otra deja los totales de la que la pierde sin
-- recalcular: el trigger que ya había solo mira `NEW.order_id`. Sin esto, la
-- cuenta absorbida seguiría enseñando el importe de unas líneas que ya no
-- tiene, y la suma del día saldría el doble.
CREATE TRIGGER IF NOT EXISTS recalc_after_item_moved
AFTER UPDATE OF order_id ON order_items
WHEN NEW.order_id <> OLD.order_id
BEGIN
  UPDATE orders SET
    subtotal_cents = (SELECT COALESCE(SUM(quantity * unit_price_cents), 0)
                        FROM order_items WHERE order_id = OLD.order_id),
    tax_cents      = (SELECT COALESCE(SUM(CAST(ROUND(quantity * unit_price_cents * tax_bp / 10000.0) AS INTEGER)), 0)
                        FROM order_items WHERE order_id = OLD.order_id)
  WHERE id = OLD.order_id;
  UPDATE orders SET total_cents = subtotal_cents + tax_cents WHERE id = OLD.order_id;
END;
