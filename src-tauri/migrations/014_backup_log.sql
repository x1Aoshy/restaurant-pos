-- =============================================================================
-- Registro de copias de seguridad.
--
-- Hasta ahora `backups` guardaba solo la última: `last_at`, `last_path` y
-- `last_error`. Sirve para el indicador, pero no para la pregunta que de verdad
-- se hace cuando algo va mal —«¿desde cuándo no se copia?»—, porque cada intento
-- pisaba al anterior. Un USB desenchufado el martes y vuelto a enchufar el
-- viernes dejaba exactamente el mismo rastro que si nunca hubiera fallado.
--
-- Aquí queda cada intento, con su motivo y su resultado. Es lo que permite mirar
-- la pantalla de copias y ver que las de las 6:00 entran y las del cierre no,
-- que es un problema distinto y con otra causa.
--
-- ## No se sincroniza
--
-- Igual que `backups`: la carpeta de destino es de este equipo, y el historial
-- de lo que copió este equipo no le sirve de nada al otro. Sin triggers de
-- buzón, esta tabla no viaja.
--
-- ## `reason` y no `trigger`
--
-- `TRIGGER` es palabra reservada en SQLite. Funciona entre comillas, pero una
-- columna que hay que citar en cada consulta es una trampa esperando a que
-- alguien escriba la que falta.
-- =============================================================================

CREATE TABLE IF NOT EXISTS backup_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  -- Qué lo disparó. `skipped` no es un fallo: es un intento que se decidió no
  -- hacer, y distinguirlo importa —si no, el historial del cierre parecería
  -- lleno de errores cuando en realidad no había nada nuevo que copiar.
  reason      TEXT    NOT NULL CHECK (reason IN ('scheduled','manual','shutdown')),
  outcome     TEXT    NOT NULL DEFAULT 'running'
                CHECK (outcome IN ('running','ok','error','skipped')),
  path        TEXT,
  bytes       INTEGER,
  pruned      INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

-- Se consulta siempre «lo último primero», y nunca por fecha ni por motivo.
CREATE INDEX IF NOT EXISTS backup_log_recent_idx ON backup_log (id DESC);

-- La última copia conocida se deduce del registro, pero `backups` sigue
-- llevándola aparte para que el indicador no tenga que recorrer el historial en
-- cada render. Esta fila siembra el registro con lo que ya se sabía, para que la
-- pantalla no aparezca vacía en un equipo que llevaba semanas copiando bien.
INSERT INTO backup_log (started_at, finished_at, reason, outcome, path)
SELECT last_at, last_at, 'scheduled', 'ok', last_path
  FROM backups
 WHERE id = 1 AND last_at IS NOT NULL;
