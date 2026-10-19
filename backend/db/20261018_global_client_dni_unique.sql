-- Adds national DNI uniqueness without altering or deleting existing client rows.
-- Precondition checked before application: no duplicate DNI values in public.clients.
CREATE UNIQUE INDEX IF NOT EXISTS uk_client_dni_global ON public.clients (dni);
