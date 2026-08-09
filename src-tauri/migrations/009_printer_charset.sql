-- =============================================================================
-- Codificación y corte de papel por impresora.
--
-- ESC/POS no manda texto en UTF-8: manda bytes de una tabla de códigos que hay
-- que seleccionar antes. Si no se elige la correcta, «jamón» sale «jamn» o
-- «jam¾n» — y eso no se ve hasta que hay papel de por medio.
--
-- Por defecto **CP850**. No es la más completa, pero es la que entienden todas:
-- las Epson de referencia, las XPrinter y las clónicas chinas que es lo que se
-- vende aquí. CP858 solo añade el símbolo del euro, que en Nicaragua no hace
-- falta, y varias clónicas no la traen.
--
-- El corte también varía: casi todas hacen corte parcial, unas pocas solo total
-- y las de 58 mm más baratas no llevan cuchilla. Se elige por impresora en vez
-- de adivinar, que es lo que acaba dejando el papel sin cortar en producción.
-- =============================================================================

-- Valor de `ESC t n`. 2 = CP850, 19 = CP858, 16 = CP1252, 0 = PC437.
ALTER TABLE printers ADD COLUMN codepage INTEGER NOT NULL DEFAULT 2;

ALTER TABLE printers ADD COLUMN cut_mode TEXT NOT NULL DEFAULT 'partial'
  CHECK (cut_mode IN ('partial', 'full', 'none'));

DROP TRIGGER IF EXISTS outbox_printers_insert;
DROP TRIGGER IF EXISTS outbox_printers_update;

CREATE TRIGGER outbox_printers_insert
AFTER INSERT ON printers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'connection', NEW.connection,
    'address', NEW.address, 'port', NEW.port, 'width_chars', NEW.width_chars,
    'opens_drawer', NEW.opens_drawer, 'active', NEW.active,
    'codepage', NEW.codepage, 'cut_mode', NEW.cut_mode,
    'created_at', NEW.created_at));
END;

CREATE TRIGGER outbox_printers_update
AFTER UPDATE ON printers
WHEN (SELECT enabled = 1 AND applying = 0 FROM sync_context)
BEGIN
  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES ('printers', NEW.id, 'upsert', json_object(
    'id', NEW.id, 'name', NEW.name, 'connection', NEW.connection,
    'address', NEW.address, 'port', NEW.port, 'width_chars', NEW.width_chars,
    'opens_drawer', NEW.opens_drawer, 'active', NEW.active,
    'codepage', NEW.codepage, 'cut_mode', NEW.cut_mode,
    'created_at', NEW.created_at));
END;
