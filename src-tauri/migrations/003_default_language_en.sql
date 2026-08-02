-- =============================================================================
-- El idioma de partida pasa a ser inglés.
--
-- SQLite no permite cambiar el DEFAULT de una columna con ALTER TABLE, así que
-- se cambia el valor de la fila —la tabla `settings` tiene una sola— y el
-- DEFAULT del esquema queda como referencia histórica de instalaciones
-- anteriores. En una instalación nueva ambas migraciones corren seguidas y el
-- resultado es el mismo.
--
-- El idioma se cambia en Ajustes › Apariencia en dos clics.
-- =============================================================================

UPDATE settings SET language = 'en' WHERE id = 1;
