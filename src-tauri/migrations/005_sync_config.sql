-- =============================================================================
-- Dónde vive la configuración del servidor.
--
-- En `sync_context` y no en `settings` por dos motivos:
--
--   1. `settings` sí se sincroniza. Meter ahí la clave del local significaría
--      mandarla por el mismo canal que protege, y además pisaría la de cada
--      terminal con la del último que la tocara.
--   2. Es configuración DE ESTE EQUIPO, no del negocio. Igual que el tema o la
--      impresora.
--
-- Tampoco va en un `.env`: Vite incrusta esos valores al compilar, así que
-- cambiar de servidor obligaría a recompilar y reinstalar en cada terminal.
-- =============================================================================

ALTER TABLE sync_context ADD COLUMN server_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_context ADD COLUMN server_key  TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_context ADD COLUMN venue_token TEXT NOT NULL DEFAULT '';
-- Última sincronización correcta, para poder decir «hace 3 min» sin inventar.
ALTER TABLE sync_context ADD COLUMN last_sync_at TEXT;
