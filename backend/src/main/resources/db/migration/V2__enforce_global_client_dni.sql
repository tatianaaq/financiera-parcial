DO $$
BEGIN
    IF EXISTS (
        SELECT dni
        FROM clients
        GROUP BY dni
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce global DNI uniqueness: duplicate DNI values exist in clients';
    END IF;
END $$;

CREATE UNIQUE INDEX uk_client_dni_global ON clients (dni);
