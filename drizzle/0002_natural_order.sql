-- Sorts names the way people read them: digits count as numbers, so
-- "Kepler-12 b" comes before "Kepler-129 b" and "Kepler-1299 b".
-- Used by the planet list: ORDER BY name COLLATE "natural_name".
CREATE COLLATION IF NOT EXISTS natural_name (provider = icu, locale = 'en-u-kn');
