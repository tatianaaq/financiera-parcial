-- Additive nullable address fields; keeps all existing client rows and addresses intact.
-- Run manually only after backing up the database. This script is not run by the application.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS department varchar(80);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS province varchar(80);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS district varchar(80);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ubigeo varchar(6);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address_reference varchar(200);
