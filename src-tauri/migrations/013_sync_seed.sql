-- =============================================================================
-- Siembra del buzón al encender la sincronización.
--
-- ## Qué estaba roto
--
-- Los veintiséis triggers del buzón están condicionados a `enabled = 1`. Eso es
-- correcto —quien use un solo equipo no paga nada por la sincronización— pero
-- tiene una consecuencia que no se veía: **las filas que ya existían cuando se
-- encendió no entran nunca**.
--
-- El caso real: un local lleva un año vendiendo con un PC. Se compra el
-- segundo, se enciende la sincronización, y el terminal nuevo arranca sin
-- carta, sin mesas y sin personal. No hay error en ningún sitio; simplemente no
-- llega nada, porque el buzón está vacío y no hay nada que subir.
--
-- Nadie lo detectó antes porque en las pruebas la base siempre se creaba con la
-- sincronización ya encendida, y entonces los triggers sí recogen todo.
--
-- ## Cómo se arregla
--
-- Al encender se vuelca al buzón lo que ya hay. La marca vive aquí para que
-- ocurra UNA sola vez: apagar y volver a encender no repite la siembra, que en
-- un local con historia son decenas de miles de filas.
--
-- Es de este equipo y no viaja: cada terminal siembra lo suyo, y el que se une
-- después no necesita sembrar nada porque lo recibe del registro del servidor.
-- =============================================================================

ALTER TABLE sync_context ADD COLUMN seeded_at TEXT;

-- Una base que se crea con la sincronización ya encendida no necesita siembra:
-- los triggers recogen todo desde la primera fila. Marcarla evita volcar por
-- duplicado lo que el buzón ya tiene.
UPDATE sync_context
   SET seeded_at = datetime('now')
 WHERE id = 1
   AND enabled = 1;
