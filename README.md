# Gym CRM Backend

Backend multi-tenant para gestión de gimnasios, con generación de rutinas por IA,
envío por WhatsApp, facturación fiscal (AFIP/ARCA), cobro de renovaciones por
Mercado Pago, onboarding automático de socios vía Google Forms y, a partir del
pivot B2B2C, gestión independiente de entrenadores y clientes con rutinas
editables, seguimiento semanal y notificaciones.

Un mismo backend sirve a **muchos gimnasios (tenants)** sobre una base de datos
compartida, aislados por `gymId`. Cada gimnasio carga sus propias credenciales
(IA, WhatsApp, AFIP, Mercado Pago) — no hay una cuenta de plataforma que todos
compartan, salvo fallbacks explícitos pensados para gyms nuevos que aún no
cargaron la suya.

---

## Tabla de contenidos

- [Stack y tecnologías](#stack-y-tecnologías)
- [Funcionalidades](#funcionalidades)
- [Arquitectura y estructura del proyecto](#arquitectura-y-estructura-del-proyecto)
- [Multi-tenancy](#multi-tenancy)
- [Fase 5 — Rutinas: edición, seguimiento y comentarios](#fase-5--rutinas-edición-seguimiento-y-comentarios)
- [Fase 6 — Notificaciones de seguimiento semanal](#fase-6--notificaciones-de-seguimiento-semanal)
- [Puesta en marcha](#puesta-en-marcha)
- [Scripts disponibles](#scripts-disponibles)
- [Testing](#testing)
- [Documentación adicional](#documentación-adicional)
- [Tareas pendientes](#tareas-pendientes)
- [Futuros features posibles](#futuros-features-posibles)

---

## Stack y tecnologías

**Runtime y lenguaje**

- Node.js + TypeScript (compilación con `tsc`, ejecución en dev con `ts-node-dev`)
- Express 4 como framework HTTP

**Base de datos**

- MongoDB + Mongoose (schemas, repositorios que implementan puertos del dominio)

**Autenticación y seguridad**

- `jsonwebtoken` — access token + refresh token (JWT), refresh en cookie httpOnly
- `bcrypt` — hash de contraseñas
- `helmet`, `cors`, `cookie-parser`, `express-rate-limit`
- Cifrado propio AES-256-GCM (`APP_MASTER_KEY`) para credenciales por-gym (AFIP, API key de IA, token de WhatsApp, credenciales de Mercado Pago) — nunca se guardan en texto plano

**Integraciones externas**

- **IA para generación de rutinas**: `@anthropic-ai/sdk` (Claude), `openai` (SDK compatible, usado también para DeepSeek), con patrón adaptador/factory por proveedor. DeepSeek es el proveedor por defecto para gyms nuevos (más económico); cada gym puede elegir su proveedor y cargar su propia API key (BYOK)
- **WhatsApp**: Meta Cloud API (envío de la rutina en PDF al socio)
- **Facturación**: `@afipsdk/afip.js` — Factura A/B/C según condición fiscal del socio, cuenta propia por gimnasio
- **Pagos**: Mercado Pago — renovación de membresía por link de pago, credencial directa por gym (sin OAuth)
- **Onboarding**: webhook de Google Forms (Apps Script en `docs/google-forms/onFormSubmit.gs`) para alta de socios nuevos
- **PDF**: `puppeteer` (plantilla HTML/CSS → PDF de la rutina) y `pdf-lib`

**Validación y utilidades**

- `zod` — validación de entrada en endpoints y del propio `.env` al arrancar
- `axios`, `multer`

**Calidad y testing**

- `vitest` + `supertest` + `mongodb-memory-server` (tests unitarios, de integración y e2e sin depender de un Mongo real)
- `eslint` + `@typescript-eslint`, `prettier`

**Procesamiento**

- Sin cola de mensajería: IA, PDF y WhatsApp se resuelven de forma sincrónica dentro del propio request (BullMQ/Redis se evaluó y se descartó, ver `src/config/env.ts`)
- La emisión de facturas sí tiene un worker propio, con dos modos configurables por `INVOICE_WORKER_MODE`: `interno` (timer dentro del proceso) o `cron` (un cron externo golpea `POST /api/internal/jobs/emit-invoices`) — pensado para tiers de hosting que hibernan por inactividad

---

## Funcionalidades

- **Autenticación multi-rol**: `superadmin` / `admin` (plataforma) y `gym` (dueño del gimnasio), con JWT de acceso + refresh y sesión que sobrevive a refrescos de página
- **Gestión de gimnasios (tenants)**: alta/baja/edición de gyms, configuración propia de IA, WhatsApp, AFIP, Mercado Pago y catálogo de planes de membresía
- **Gestión de socios (clientes)**: alta, edición, baja lógica (soft delete), búsqueda por nombre/documento, listado paginado, socios próximos a vencer
- **Entrenador independiente (autónomo)**: un entrenador puede registrarse y operar sin pertenecer a un gym existente; se le aprovisiona un `Gym` personal (`tipo = 'personal'`) y un `Client` vinculado a su `userId`
- **Cliente autónomo y marketplace**: los clientes pueden registrarse sin entrenador (`entrenadorId = null`), completar una encuesta (`PendingSurvey` con TTL de 30 días) y luego seleccionar un entrenador (`SeleccionarEntrenadorUseCase`), que actualiza `Client.gymId` si ya existe
- **Invitación del cliente**: `InviteClientToAppUseCase` busca `Client` existente, valida email y vincula o fusiona `User`; devuelve link/código de activación (`link mágico / temporal`, TTL 30 días)
- **Cambio de entrenador**: permitido (`Sí`); actualiza `Client.gymId` y `User.entrenadorId` con validaciones de conflicto
- **Onboarding automático**: un Google Form dispara un webhook (firmado, con secreto propio por gym) que da de alta al socio sin intervención manual
- **Generación de rutinas con IA**: prompt configurable por gimnasio, rutina generada según proveedor de IA elegido (DeepSeek por defecto, o Anthropic/OpenAI), exportada a PDF con plantilla de infografía y enviada por WhatsApp
- **Edición de contenido de rutina**: `EditRoutineContentUseCase` valida que el estado sea `generado`, guarda `contenidoOriginalIA` solo en la primera edición y actualiza `contenidoGenerado` con `editadoManualmente = true`
- **Seguimiento de rutina**: `RoutineProgressUpdate` (upsert por índice único `{gymId, clientId, semana}`) con estados `pendiente_revision` / `revisado`; endpoints `GET /routines/:id/updates`, `POST /routines/:id/updates`, `GET /routines/me`
- **Comentarios en rutinas**: `RoutineComment` con índices `{gymId, routineId, createdAt}`, validación de `texto` (≤ 2000 chars) y `autorRol`; endpoints `POST /routines/:id/comments`, `GET /routines/:id/comments`
- **Dashboard del entrenador**: `GET /trainer/dashboard/seguimiento` lista los `RoutineProgressUpdate` con `estado = 'pendiente_revision'` para el `gymId` del entrenador
- **Vencimiento de rutinas**: cálculo de vigencia y listado de rutinas por vencer
- **Check-ins**: registro de asistencia de socios al gimnasio
- **Renovación de membresías**: renovación manual (en el momento, con factura) o por link de Mercado Pago, con confirmación por webhook
- **Servicios**: catálogo de servicios por gym (`Gym.servicios`), actualización (`PUT /gyms/settings/servicios`), generación de links de pago (`POST /services/:servicioId/payment-links`) y webhook de `ServicePaymentRequest`
- **Facturación fiscal (AFIP)**: emisión de Factura A/B/C según condición fiscal del socio, cola de emisión con reintentos, historial y reintento manual de facturas fallidas
- **Dashboard de KPIs**: métricas financieras, de retención, de embudo (leads → conversión), operativas y de engagement por gimnasio, más un resumen cross-tenant para `admin`
- **Uso de IA**: tracking de consumo/costo de IA por gimnasio
- **Jobs internos**: endpoints protegidos por secreto (`x-internal-secret`) para disparar tareas desde un cron externo (`POST /api/internal/jobs/emit-invoices`, `POST /api/internal/jobs/check-weekly-updates`)
- **Búsqueda pública de entrenadores**: `GET /entrenadores` con paginación, whitelist de datos (sin credenciales) y perfil público (`User.perfilPublico`)
- **Notificaciones semanales (v1, no-op inicial)**: `INotificationProvider` define el puerto `notificarSeguimiento`; `NoOpNotificationProvider` es el adaptador inicial (log en consola). El caso de uso `CheckWeeklyUpdatesUseCase` recorre los `RoutineProgressUpdate` en `pendiente_revision` y emite la notificación por cliente; el endpoint `POST /internal/jobs/check-weekly-updates` lo expone con `internalAuthMiddleware`

---

## Arquitectura y estructura del proyecto

Arquitectura hexagonal (puertos y adaptadores), organizada por capas de dependencia
estricta: el dominio no conoce Express ni Mongoose ni ningún SDK externo.

```
src/
├── domain/              # Núcleo: entidades, reglas de negocio, puertos (interfaces)
│   ├── entities/         # Client, Gym, User, Routine, RoutineComment, RoutineProgressUpdate,
│                          Invoice, CheckIn, ServicePaymentRequest, PendingSurvey, etc.
│   ├── repositories/     # Puertos de persistencia (IClientRepository, IGymRepository, ...)
│   ├── services/         # Puertos de servicios externos (IAIProvider, IPaymentProvider, ...)
│   │                       Incluye `INotificationProvider` (notificaciones semanales)
│   ├── billing/, kpis/, forms/, pdf/, prompt/, routine/, time/, ai/
│                          # Reglas y tipos de cada subdominio
│
├── application/
│   └── use-cases/        # Un caso de uso = una acción de negocio. Orquesta puertos,
│                          # no conoce infraestructura concreta
│       (auth, client, gym, routine, checkin, invoice, payments,
│        onboarding, dashboard, user, ai-usage, internal)
│
├── infrastructure/       # Implementaciones concretas de los puertos del dominio
│   ├── database/mongoose/  # Schemas y repositorios Mongo (implementan los puertos)
│   ├── external/            # Adaptadores a servicios externos, uno por integración
│   │   ├── ai/                # AnthropicProvider, DeepSeekProvider, OpenAIProvider + factory
│   │   ├── billing/           # AfipSdkAdapter (cuenta única) y OwnAccount (cuenta propia) + factories
│   │   ├── payments/          # MercadoPagoAdapter + factory + verificación de firma
│   │   ├── whatsapp/          # MetaCloudApiProvider + factory
│   │   ├── forms/             # GoogleFormsWebhookHandler
│   │   ├── pdf/                # PdfGenerator (Puppeteer) + provider de plantillas
│   │   └── notifications/     # NoOpNotificationProvider (adaptador inicial no-op/log)
│   ├── encryption/           # EncryptionService (AES-256-GCM) para credenciales por-gym
│   ├── queues/                # InvoiceEmissionScheduler + worker de facturación
│   └── storage/               # Almacenamiento de PDFs generados
│
├── interfaces/http/       # Entrada HTTP
│   ├── controllers/         # Traducen HTTP ↔ casos de uso
│   ├── routes/               # Definición de rutas Express por recurso
│   ├── middlewares/          # auth, tenant, rol (`requireEntrenador`, `requireCliente`),
│                              jobs internos (`internalAuthMiddleware`), manejo de errores
│   └── validators/           # Schemas zod de entrada por recurso
│
├── config/                # env.ts (validación de entorno con zod), database.ts
├── shared/                 # errores, constantes y utilidades transversales
├── scripts/                # scripts one-off (seed de superadmin, purgas, backfills)
└── server.ts / app.ts      # composition root (server.ts) y app Express (app.ts)

tests/
├── unit/          # casos de uso y lógica de dominio, aislados con mocks
├── integration/   # repositorios y flujos contra mongodb-memory-server
└── e2e/           # endpoints HTTP completos, request → response

docs/
├── API_ENDPOINTS.md        # contrato HTTP completo, pensado para tipar el front sin leer el backend
└── google-forms/            # Apps Script del webhook de onboarding + su propio README
```

**Por qué así**: cada integración externa (IA, WhatsApp, AFIP, Mercado Pago, PDF,
Google Forms, notificaciones) vive detrás de un puerto (`I*Provider`) definido en
`domain/services`. Los casos de uso dependen de esos puertos, nunca de la librería
concreta. Cambiar el mecanismo de notificación (de no-op a WhatsApp/email) es agregar
un adaptador nuevo que implemente `INotificationProvider` — sin tocar dominio ni casos
de uso.

---

## Multi-tenancy

- Una sola base de datos, discriminada por `gymId` en cada documento
- `tenantMiddleware` es el único lugar del código donde se decide sobre qué gimnasio
  opera un request:
  - Rol `gym`: siempre opera su propio `gymId`, tomado del JWT — no puede tocar otro tenant
  - Rol `admin`: debe pasar `?gymId=` explícito en cada request con tenant (si no, `400`)
  - Rol `entrenador`: opera su `Gym` personal (o el asignado); los endpoints de cliente
    (`/routines/me`, `/clients/me`) usan `ownClientMiddleware` para restringir al `userId`
  - Rol `cliente`: opera solo su propio `Client` y sus rutinas
- Cada gimnasio carga sus propias credenciales de IA, WhatsApp, AFIP y Mercado Pago,
  cifradas en su propio documento. Las variables de entorno equivalentes son solo
  **fallback de plataforma** para gyms que todavía no cargaron la suya (ver
  `.env.example`, muy documentado al respecto)

---

## Fase 5 — Rutinas: edición, seguimiento y comentarios

### Entidades nuevas

- `RoutineComment`: comentarios de `entrenador` o `cliente` sobre una rutina; límite de 2000 caracteres, orden cronológico (`createdAt`)
- `RoutineProgressUpdate`: actualización de progreso por `clientId` + `semana`; índice único `{gymId, clientId, semana}`; estados `pendiente_revision` / `revisado`

### Repositorios Mongo nuevos

- `MongoCommentRepository`
- `MongoProgressUpdateRepository` (métodos: `findByRoutineId`, `findByGymClientSemana`, `update`, `searchPendientesByGym`)

### Casos de uso nuevos

- `EditRoutineContentUseCase`: valida `estadoGeneracion === 'generado'`; guarda `contenidoOriginalIA` en la primera edición; actualiza `contenidoGenerado` y `editadoManualmente`
- `SubmitRoutineProgressUpdateUseCase`: upsert por `{gymId, clientId, semana}`; rechaza si la rutina no pertenece al cliente
- `AddRoutineCommentUseCase`: valida `texto` (no vacío, ≤ 2000 chars) y `autorRol`
- `ListRoutineProgressForTrainerUseCase`: lista los `RoutineProgressUpdate` con `estado = 'pendiente_revision'` para un `gymId`

### Endpoints nuevos en `routine.routes.ts`

- `PUT /routines/:id/contenido` (`requireEntrenador`)
- `GET /routines/:id/updates`, `POST /routines/:id/updates`
- `GET /routines/:id/comments`, `POST /routines/:id/comments`
- `GET /routines/me` (rutinas del cliente autenticado)
- `GET /routines/seguimiento` (`GET /trainer/dashboard/seguimiento` — dashboard del entrenador)

### Esquema `Routine` actualizado

- `editadoManualmente: boolean`
- `contenidoOriginalIA: object`

---

## Fase 6 — Notificaciones de seguimiento semanal

### Puerto (interfaz)

- `INotificationProvider` (`domain/services`): `notificarSeguimiento(clientId, gymId, mensaje): Promise<void>`

### Adaptador inicial (v1, no-op)

- `NoOpNotificationProvider` (`infrastructure/external/notifications`): implementa el puerto; hace `console.log` con los datos recibidos. Es la implementación por defecto para evitar falsos positivos con clientes recién asignados y para no depender de un canal concreto (WhatsApp/email) hasta que se defina el mecanismo definitivo.

### Caso de uso

- `CheckWeeklyUpdatesUseCase`: recibe `gymId`; busca los `RoutineProgressUpdate` en `pendiente_revision` (`searchPendientesByGym`); para cada uno, busca el `Client` asociado y emite `notificarSeguimiento` con el mensaje `"Seguimiento pendiente de la semana X"`.

### Endpoint interno

- `POST /internal/jobs/check-weekly-updates` (`internalAuthMiddleware`, `internalLimiter`): expone el caso de uso para ser llamado por un cron externo. El `gymId` se pasa explícitamente en futuras versiones (en v1 se usa un valor por defecto para la verificación).

---

## Puesta en marcha

```powershell
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno y completarlas
Copy-Item .env.example .env

# 3. Levantar en desarrollo (requiere Mongo corriendo, ver MONGO_URI)
npm run dev
```

Variables obligatorias mínimas: `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`APP_MASTER_KEY` (cifra las credenciales por-gym). El resto son fallbacks opcionales
de plataforma — el detalle de cada una está comentado en `.env.example`, que es la
fuente de verdad junto con `src/config/env.ts` (valida el `.env` con zod al arrancar).

---

## Scripts disponibles

| Script                                 | Qué hace                                      |
| -------------------------------------- | --------------------------------------------- |
| `npm run dev`                          | Servidor en desarrollo con recarga automática |
| `npm run build`                        | Compila TypeScript a `dist/`                  |
| `npm start`                            | Corre el build compilado                      |
| `npm run typecheck`                    | `tsc --noEmit`                                |
| `npm run lint` / `npm run format`      | ESLint / Prettier                             |
| `npm test` / `npm run test:watch`      | Suite de tests con Vitest                     |
| `npm run seed`                         | Crea el usuario superadmin inicial            |
| `npm run seed:membership-events`       | Seed de eventos de membresía                  |
| `npm run purge:afip-keys`              | Limpia credenciales AFIP obsoletas            |
| `npm run backfill:vencimiento-rutinas` | Recalcula vigencia de rutinas existentes      |

---

## Testing

Más de 800 tests entre unitarios, de integración (contra `mongodb-memory-server`, sin
depender de un Mongo real) y end-to-end (endpoints HTTP completos vía `supertest`).
Cubren desde reglas de dominio puras hasta flujos completos como onboarding por
webhook, renovación con Mercado Pago, emisión de facturas AFIP, edición de rutinas,
seguimiento (`RoutineProgressUpdate`), comentarios (`RoutineComment`) y el job de
notificaciones semanales con `NoOpNotificationProvider`.

---

## Documentación adicional

- **`docs/API_ENDPOINTS.md`** — contrato HTTP completo (envelope de respuesta, reglas
  de tenant, cada endpoint con su payload), pensado para que el front tipe sin leer
  este código. Actualizado con los nuevos endpoints de Fase 5 (`/updates`, `/comments`, `/me`, `/seguimiento`) y Fase 6 (`/internal/jobs/check-weekly-updates`)
- **`docs/google-forms/README.md`** — configuración del webhook de onboarding
- **`.env.example`** — documentación exhaustiva de cada variable de entorno y por qué existe
- **`kpis-gimnasio-dominio.md`** — reglas de negocio detrás del dashboard de KPIs (bajas, gracia, leads)
- **`PLAN-B2B2C-entrenadores-clientes.md`** — plan paso a paso del pivot B2B2C, con las 6 fases documentadas (0 a 6), decisiones de diseño (ADR-1 a ADR-6) y verificación por fase

---

## Tareas pendientes

No hay tareas de **código** abiertas al día de hoy. Lo que queda es infraestructura,
verificación manual y definición del mecanismo definitivo de notificaciones:

- **Definir mecanismo definitivo de notificación semanal** — reemplazar `NoOpNotificationProvider` por el adaptador real (WhatsApp/email/SMS) según el canal elegido
- **Comprar un dominio propio (prioridad alta, bloquea el deploy)** — hoy la cookie de
  refresh usa `sameSite: 'strict'`, lo que rompe el login en producción si el front y
  la API quedan en dominios distintos no relacionados (p. ej. `*.vercel.app` +
  `*.onrender.com`). Necesario también para el redirect de Mercado Pago
- **Elegir un tier de hosting pago** cuando el primer gimnasio empiece a pagar — hoy
  el tier gratuito es viable gracias a `INVOICE_WORKER_MODE=cron`, pero implica cold
  starts (~50s) para el usuario
- **Probar la facturación AFIP contra el ambiente de homologación** con una cuenta real
- **Probar el flujo de Mercado Pago contra una cuenta real** (credencial de producción)
- **Verificar que `POST /internal/jobs/check-weekly-updates` no genere falsos positivos** para clientes recién asignados (ya cubierto por `NoOpNotificationProvider`, pendiente de canal real)

---

## Futuros features posibles

- **Notificaciones proactivas reales** — reemplazar `NoOpNotificationProvider` por adaptador de WhatsApp o email para vencimientos próximos de rutina o membresía
- **Historial completo de ediciones de rutina** (`contenidoOriginalIA` guarda solo la primera versión; un historial completo requeriría una colección de versiones o un campo de versiones en `Routine`)
- **Embudo (funnel) en la serie mensual del dashboard** — hoy el endpoint de KPIs
  mensuales evita el embudo a propósito para mantener una sola lectura a la base;
  agregarlo bien (sin doce consultas extra) requiere rediseñar el puerto
  `IMetricsRepository` para traer la cohorte completa y particionarla en memoria.
  No está pedido, queda anotado
- **Gestión de clases/reservas** (`GymClass` + `ClassBooking`) — se evaluó como tanda
  5 del dashboard de KPIs y se descartó por decisión del usuario; podría retomarse
  como feature independiente
- **Panel de auditoría** de cambios sobre credenciales sensibles por gym (AFIP,
  Mercado Pago, IA, WhatsApp) y sobre las ediciones de rutinas (`editadoManualmente`), dado que hoy se cifran pero no se versiona su historial
