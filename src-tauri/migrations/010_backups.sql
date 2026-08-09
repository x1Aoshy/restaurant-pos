-- =============================================================================
-- Copias de seguridad automáticas.
--
-- Es el riesgo más probable de todo el sistema, y hasta ahora la única
-- respuesta era «cópialo tú a mano». Nadie copia nada a mano durante un año.
--
-- La configuración es DE ESTE EQUIPO y no se sincroniza: la carpeta de destino
-- —un disco externo, una memoria, una carpeta que sube a la nube— es distinta
-- en cada máquina, y mandar la de un terminal a otro solo serviría para que el
-- segundo escribiera donde no debe.
--
-- Por eso tampoco lleva triggers de buzón: esta tabla no viaja.
-- =============================================================================

CREATE TABLE IF NOT EXISTS backups (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  -- Carpeta de destino. Vacía mientras no se elija ninguna.
  folder       TEXT    NOT NULL DEFAULT '',
  -- Cada cuántas horas. Seis cubre un servicio de mediodía y otro de noche.
  every_hours  INTEGER NOT NULL DEFAULT 6 CHECK (every_hours BETWEEN 1 AND 168),
  -- Cuántas copias se conservan. Catorce a seis horas son casi cuatro días de
  -- historia, que es margen de sobra para notar que algo se estropeó.
  keep         INTEGER NOT NULL DEFAULT 14 CHECK (keep BETWEEN 1 AND 200),
  last_at      TEXT,
  last_path    TEXT,
  -- Último fallo, para poder decir POR QUÉ no se está copiando en vez de
  -- limitarse a callar.
  last_error   TEXT
);

INSERT OR IGNORE INTO backups (id) VALUES (1);
