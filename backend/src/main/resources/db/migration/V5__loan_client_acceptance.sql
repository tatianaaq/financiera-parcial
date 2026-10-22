-- Registrar el momento en que el asesor documentó una aceptación expresa.
-- No representa firma electrónica ni acredita por sí sola la aceptación legal.
-- Préstamos existentes: campo nulo, sin alteraciones retroactivas.
ALTER TABLE loans ADD COLUMN acceptance_recorded_at TIMESTAMPTZ;
