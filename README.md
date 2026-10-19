# Sistema de préstamos financieros · V2

Versión independiente con frontend React + TypeScript (TSX) y backend Spring Boot. El proyecto original queda separado y conserva sus archivos y base de datos.

Consulta [GUIA_DEL_PROYECTO.md](GUIA_DEL_PROYECTO.md) para abrirlo en IntelliJ y configurar su conexión PostgreSQL local.

## Carpetas principales

- `backend/`: API, reglas de negocio, persistencia y seguridad.
- `frontend/src/pages/`: pantallas, con un `.tsx` y `.css` por módulo.
- `frontend/src/styles/`: hoja de estilos activa copiada del diseño original y reglas comunes.

El acceso normal requiere PostgreSQL. H2 se utiliza exclusivamente en pruebas automatizadas aisladas. Para ejecutar las pruebas: `cd backend; mvn test`.
