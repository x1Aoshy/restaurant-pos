-- =============================================================================
-- Se quita la clave foránea de `merged_into`.
--
-- ## Por qué no se corrigió la 006 en su sitio
--
-- Porque ya se había aplicado. El motor guarda un resumen de cada migración
-- ejecutada y se niega a seguir si el archivo cambia después: es lo que impide
-- que dos equipos con el mismo número de versión acaben con esquemas distintos.
-- Una migración aplicada es historia, y la historia se corrige añadiendo, no
-- reescribiendo.
--
-- ## Por qué sobra la clave foránea
--
-- Al fusionar dos comandas hay que dejar de estar viva la cuenta local ANTES de
-- insertar la que gana —el índice de una cuenta viva por mesa no admite las dos
-- ni un instante—, pero la clave foránea exige justo lo contrario: que la
-- ganadora ya exista para poder apuntarla. Las dos condiciones no se pueden
-- cumplir a la vez.
--
-- Y aun sin ese choque sobraría. En un sistema que se pone al día por partes,
-- apuntar a una fila que todavía no ha llegado es lo normal, no un error.
--
-- ## Cómo
--
-- SQLite no sabe quitar una restricción de una columna, así que se tira la
-- columna y se rehace. Antes hay que retirar lo que depende de ella —dos
-- índices y dos triggers—, o `DROP COLUMN` se niega. El valor se guarda en una
-- columna de paso: hoy no hay ninguna fila fusionada, pero esto tiene que ser
-- correcto también dentro de un año.
-- =============================================================================

ALTER TABLE orders ADD COLUMN merged_keep TEXT;
UPDATE orders SET merged_keep = merged_into WHERE merged_into IS NOT NULL;

DROP INDEX IF EXISTS one_live_order_per_table;
DROP INDEX IF EXISTS orders_merged_idx;
DROP TRIGGER IF EXISTS table_status_on_order_merge;
DROP TRIGGER IF EXISTS table_status_on_order_delete;

ALTER TABLE orders DROP COLUMN merged_into;
ALTER TABLE orders ADD COLUMN merged_into TEXT;

UPDATE orders SET merged_into = merged_keep WHERE merged_keep IS NOT NULL;
ALTER TABLE orders DROP COLUMN merged_keep;

-- -----------------------------------------------------------------------------
-- Y se rehace lo que dependía de la columna, igual que estaba.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX one_live_order_per_table
  ON orders (table_id)
  WHERE status IN ('open','sent_to_kitchen','served','billed')
    AND merged_into IS NULL;

CREATE INDEX orders_merged_idx
  ON orders (merged_into) WHERE merged_into IS NOT NULL;

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

CREATE TRIGGER table_status_on_order_merge
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
