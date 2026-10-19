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

4. Abre la dirección local que muestre Vite (por defecto `http://localhost:5173`). Vite reenvía `/api` al backend en `http://localhost:8081`.

También puedes compilar el frontend y empaquetar los archivos estáticos con Spring Boot:

```powershell
cd financiera-v2/frontend
npm run build
cd ../backend
mvn package
java -jar target/prestamos-1.0.0.jar
```

## PostgreSQL

V2 utiliza PostgreSQL en funcionamiento normal y Hibernate ejecuta `validate`; la aplicación no crea ni altera el esquema. Configura en IntelliJ (Run → Edit Configurations → Environment variables) `SPRING_PROFILES_ACTIVE=postgresql`, `FINANCIERA_V2_DATABASE_URL=jdbc:postgresql://localhost:5432/financiera_v2`, `FINANCIERA_V2_DATABASE_USERNAME` y `FINANCIERA_V2_DATABASE_PASSWORD`. No guardes la contraseña en el repositorio. `pgpass.conf` autentica herramientas libpq como `psql`, pero Spring JDBC no lo utiliza. H2 solo se activa en las pruebas y es una base en memoria efímera.

Las contraseñas de inicialización no tienen valores predeterminados en el código. Si habilitas el sembrado inicial de usuarios, configura también `FINANCIERA_V2_ADMIN_PASSWORD` y `FINANCIERA_V2_SEED_PASSWORD` en esa misma configuración de ejecución de IntelliJ. Estas variables se usan solo cuando se crean cuentas iniciales nuevas; no cambian contraseñas de cuentas que ya existen. El sembrado está desactivado por defecto.

El puerto predeterminado del backend V2 es 8081 (`FINANCIERA_V2_PORT` lo cambia). El backend original conserva su puerto y sus archivos. Las rutinas que sembraban usuarios y reescribían asignaciones de clientes están desactivadas por defecto; no actives `app.seed.enabled` ni `app.migrations.client-agency.enabled` contra una base con datos reales sin un procedimiento revisado.

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
