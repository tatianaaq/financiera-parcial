# Financiera V2

Esta carpeta contiene una copia independiente del sistema. El proyecto original que IntelliJ ya tenía abierto no se modifica. El backend conserva las mismas entidades, API, autenticación y reglas de negocio; el frontend presenta esas operaciones con React, TypeScript y CSS organizado por pantalla.

## Dónde editar

```text
financiera-v2/
├── backend/
│   ├── src/main/java/pe/financiera/prestamos/  # API, entidades, repositorios y seguridad
│   ├── src/main/resources/                     # Perfiles de base de datos y configuración
│   └── pom.xml                                  # Dependencias y empaquetado Spring Boot
└── frontend/
    ├── src/api/                                # Cliente HTTP y autenticación Basic
    ├── src/auth/                               # Espacio para componentes de acceso
    ├── src/components/                         # Login y diálogo reutilizable
    ├── src/pages/
    │   ├── admin/                              # Usuarios.tsx y Usuarios.css
    │   ├── clientes/                           # Clientes.tsx y Clientes.css
    │   ├── dashboard/                          # Dashboard.tsx y Dashboard.css
    │   └── prestamos/                          # Prestamos.tsx y Prestamos.css
    ├── src/styles/legacy.css                   # Reglas del diseño activo del proyecto original
    ├── src/styles/global.css                   # Estilos globales y de componentes
    └── package.json                            # Dependencias y comandos del frontend
```

Cada pantalla tiene sus archivos `.tsx` y `.css` dentro de su carpeta. `legacy.css` mantiene las reglas visuales que estaban activas en la aplicación original de IntelliJ. Las reglas comunes y los estilos de pago se centralizan en `src/styles/global.css`.

## Abrir y ejecutar localmente

Requisitos: Java 21, Maven 3.9 o posterior, Node.js 20.19 o posterior y npm.

1. Abre `financiera-v2` como proyecto en IntelliJ. Para el backend, selecciona `backend/pom.xml` como proyecto Maven.
2. Inicia `pe.financiera.prestamos.PrestamosApplication` o ejecuta desde `financiera-v2/backend`:

   ```powershell
   mvn spring-boot:run
   ```

3. En otra terminal, ejecuta el frontend:

   ```powershell
   cd financiera-v2/frontend
   npm install
   npm run dev
   ```

4. Copia `frontend/.env.example` a `frontend/.env` (el valor inicial apunta al puerto 8082, configurado en `backend/.env`) y abre la dirección local que muestre Vite (por defecto `http://localhost:5173`). Vite reenvía `/api` al backend según `VITE_API_PROXY_TARGET`. Si cambias el puerto del backend, actualiza también esta variable y reinicia Vite.

También puedes compilar el frontend y empaquetar los archivos estáticos con Spring Boot:

```powershell
cd financiera-v2/frontend
npm run build
cd ../backend
mvn package
java -jar target/prestamos-1.0.0.jar
```

## PostgreSQL, Supabase y Render

El backend aplica el esquema con Flyway al iniciar y Hibernate ejecuta `validate`. Las migraciones están en `backend/src/main/resources/db/migration`. La primera ejecución está pensada para una base o esquema vacío; si Supabase ya contiene tablas o datos, respáldalos y prepara una línea base/importación antes de habilitar Flyway para evitar aplicar `V1` sobre tablas existentes. `V2` comprueba que no haya DNI duplicados antes de crear el índice global; elimina o consolida esos duplicados según corresponda antes de desplegar.

Para desarrollo local, copia `backend/.env.example` a `backend/.env` y completa las credenciales. Spring Boot carga ese archivo tanto al iniciar desde la carpeta del backend como desde la raíz; el `.env` real está ignorado por Git. El URL JDBC de Supabase debe incluir `sslmode=require`. En Render usa el Session pooler de Supabase (host, puerto 5432 y usuario indicados en el panel Connect), que funciona sobre IPv4. La contraseña va en `FINANCIERA_V2_DATABASE_PASSWORD`; no la incluyas en el URL. Render no recibe el archivo `.env`: al crear el Blueprint, carga estos mismos valores en Environment como secretos.

En una base nueva no existen cuentas de acceso. Para el primer arranque, configura en `.env` (o en los secretos de Render) `APP_SEED_ENABLED=true`, `FINANCIERA_V2_ADMIN_PASSWORD` y `FINANCIERA_V2_SEED_PASSWORD`, usando contraseñas fuertes y únicas; esto crea el administrador y los asesores iniciales. Cuando confirmes que se puede iniciar sesión, cambia `APP_SEED_ENABLED=false` y vuelve a desplegar. El sembrado no cambia las contraseñas de usuarios existentes.

El puerto local predeterminado es 8082; Render establece `PORT` automáticamente. Para ejecutar el contenedor local: `docker compose -f backend/compose.yaml up --build` desde `financiera-v2`, después de crear `backend/.env`. El Dockerfile está en `backend/Dockerfile` y compila el frontend y el backend desde la raíz del repositorio. El Blueprint está en `backend/render.yaml`; al configurarlo en Render, selecciona ese archivo y deja el Root Directory en `.` para que el contexto incluya también `frontend`. Completa allí `FINANCIERA_V2_DATABASE_URL`, `FINANCIERA_V2_DATABASE_USERNAME`, `FINANCIERA_V2_DATABASE_PASSWORD` y, si aplica, `DNI_API_KEY`. No actives `app.migrations.client-agency.enabled` contra una base con datos reales sin un procedimiento revisado.

## Reglas que se conservan

- Directorio de clientes independiente por sede; la búsqueda y el registro se limitan a la sede del asesor.
- El límite de S/ 10,000 de capital original activo y la validación de cuotas vencidas se evalúan globalmente por DNI.
- Los nuevos préstamos no incluyen seguro. Los campos y registros históricos de seguro, pagos y asignaciones permanecen conservados para no alterar saldos anteriores; la interfaz y los endpoints del módulo independiente de Pagos fueron retirados.
- Nuevos préstamos con TEA 30%, cuotas de 30 días y método francés.
- Roles ADMIN y ADVISOR y las mismas rutas `/api` del backend original.

## Comprobaciones

```powershell
cd financiera-v2/frontend
npm run build
npm run lint
cd ../backend
mvn test
```

El backend original no incluía una suite de pruebas automatizadas. La ejecución de Maven en esta copia debe completarse en un equipo con Java 21 y Maven disponibles. Comprueba también las operaciones con una base local de desarrollo antes de desplegar.
