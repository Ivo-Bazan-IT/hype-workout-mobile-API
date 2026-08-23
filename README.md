# Gym CRM Backend

Backend multi-tenant para gestión de gimnasios, con generación de rutinas por IA,
envío por WhatsApp, facturación fiscal (AFIP/ARCA), cobro de renovaciones por
Mercado Pago y onboarding automático de socios vía Google Forms.

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
- **Onboarding automático**: un Google Form dispara un webhook (firmado, con secreto propio por gym) que da de alta al socio sin intervención manual
- **Generación de rutinas con IA**: prompt configurable por gimnasio, rutina generada según proveedor de IA elegido (DeepSeek por defecto, o Anthropic/OpenAI), exportada a PDF con plantilla de infografía y enviada por WhatsApp
- **Vencimiento de rutinas**: cálculo de vigencia y listado de rutinas por vencer
- **Check-ins**: registro de asistencia de socios al gimnasio
- **Renovación de membresías**: renovación manual (en el momento, con factura) o por link de Mercado Pago, con confirmación por webhook
- **Facturación fiscal (AFIP)**: emisión de Factura A/B/C según condición fiscal del socio, cola de emisión con reintentos, historial y reintento manual de facturas fallidas
- **Dashboard de KPIs**: métricas financieras, de retención, de embudo (leads → conversión), operativas y de engagement por gimnasio, más un resumen cross-tenant para `admin`
- **Uso de IA**: tracking de consumo/costo de IA por gimnasio
- **Jobs internos**: endpoints protegidos por secreto (`x-internal-secret`) para disparar tareas desde un cron externo

---

## Arquitectura y estructura del proyecto

Arquitectura hexagonal (puertos y adaptadores), organizada por capas de dependencia
estricta: el dominio no conoce Express ni Mongoose ni ningún SDK externo.

```
src/
├── domain/              # Núcleo: entidades, reglas de negocio, puertos (interfaces)
│   ├── entities/         # Client, Gym, User, Routine, Invoice, CheckIn, etc.
│   ├── repositories/     # Puertos de persistencia (IClientRepository, IGymRepository, ...)
│   ├── services/         # Puertos de servicios externos (IAIProvider, IPaymentProvider, ...)
│   ├── billing/, kpis/, forms/, pdf/, prompt/, routine/, time/, ai/
│                          # Reglas y tipos de cada subdominio
│
├── application/
│   └── use-cases/        # Un caso de uso = una acción de negocio. Orquesta puertos,
│                          # no conoce infraestructura concreta
│       (auth, client, gym, routine, checkin, invoice, payments,
│        onboarding, dashboard, user, ai-usage)
│
├── infrastructure/       # Implementaciones concretas de los puertos del dominio
│   ├── database/mongoose/  # Schemas y repositorios Mongo (implementan los puertos)
│   ├── external/            # Adaptadores a servicios externos, uno por integración
│   │   ├── ai/                # AnthropicProvider, DeepSeekProvider, OpenAIProvider + factory
│   │   ├── billing/           # AfipSdkAdapter (cuenta única) y OwnAccount (cuenta propia) + factories
│   │   ├── payments/          # MercadoPagoAdapter + factory + verificación de firma
│   │   ├── whatsapp/          # MetaCloudApiProvider + factory
│   │   ├── forms/             # GoogleFormsWebhookHandler
│   │   └── pdf/                # PdfGenerator (Puppeteer) + provider de plantillas
│   ├── encryption/           # EncryptionService (AES-256-GCM) para credenciales por-gym
│   ├── queues/                # InvoiceEmissionScheduler + worker de facturación
│   └── storage/               # Almacenamiento de PDFs generados
│
├── interfaces/http/       # Entrada HTTP
│   ├── controllers/         # Traducen HTTP ↔ casos de uso
│   ├── routes/               # Definición de rutas Express por recurso
│   ├── middlewares/          # auth, tenant, rol, jobs internos, manejo de errores
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
Google Forms) vive detrás de un puerto (`I*Provider`) definido en `domain/services`.
Los casos de uso dependen de esos puertos, nunca de la librería concreta. Cambiar de
proveedor de IA, o pasar de "cuenta única" a "cuenta propia" en AFIP, es agregar un
adaptador nuevo y una factory — no tocar el dominio ni los casos de uso existentes.
Esto ya pasó dos veces en la vida del proyecto (AFIP y Mercado Pago migraron de
cuenta de plataforma a credencial propia por gimnasio) sin romper el resto del
sistema.

---

## Multi-tenancy

- Una sola base de datos, discriminada por `gymId` en cada documento
- `tenantMiddleware` es el único lugar del código donde se decide sobre qué gimnasio
  opera un request:
  - Rol `gym`: siempre opera su propio `gymId`, tomado del JWT — no puede tocar otro tenant
  - Rol `admin`: debe pasar `?gymId=` explícito en cada request con tenant (si no, `400`)
  - Excepción deliberada: `GET /dashboard/summary` es cross-gym, para el resumen global de `admin`
- Cada gimnasio carga sus propias credenciales de IA, WhatsApp, AFIP y Mercado Pago,
  cifradas en su propio documento. Las variables de entorno equivalentes son solo
  **fallback de plataforma** para gyms que todavía no cargaron la suya (ver
  `.env.example`, muy documentado al respecto)

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
webhook, renovación con Mercado Pago y emisión de facturas AFIP.

---

## Documentación adicional

- **`docs/API_ENDPOINTS.md`** — contrato HTTP completo (envelope de respuesta, reglas
  de tenant, cada endpoint con su payload), pensado para que el front tipe sin leer
  este código
- **`docs/google-forms/README.md`** — configuración del webhook de onboarding
- **`.env.example`** — documentación exhaustiva de cada variable de entorno y por qué existe
- **`kpis-gimnasio-dominio.md`** — reglas de negocio detrás del dashboard de KPIs (bajas, gracia, leads)
- **`BACKEND-requerimientos-dashboard.md`** — historial de decisiones y estado de las últimas features

---

## Tareas pendientes

No hay tareas de **código** abiertas al día de hoy. Lo que queda es infraestructura y verificación manual:

- **Comprar un dominio propio (prioridad alta, bloquea el deploy)** — hoy la cookie de
  refresh usa `sameSite: 'strict'`, lo que rompe el login en producción si el front y
  la API quedan en dominios distintos no relacionados (p. ej. `*.vercel.app` +
  `*.onrender.com`). Necesario también para el redirect de Mercado Pago
- **Elegir un tier de hosting pago** cuando el primer gimnasio empiece a pagar — hoy
  el tier gratuito es viable gracias a `INVOICE_WORKER_MODE=cron`, pero implica cold
  starts (~50s) para el usuario
- **Probar la facturación AFIP contra el ambiente de homologación** con una cuenta real
- **Probar el flujo de Mercado Pago contra una cuenta real** (credencial de producción)

---

## Futuros features posibles

- **Embudo (funnel) en la serie mensual del dashboard** — hoy el endpoint de KPIs
  mensuales evita el embudo a propósito para mantener una sola lectura a la base;
  agregarlo bien (sin doce consultas extra) requiere rediseñar el puerto
  `IMetricsRepository` para traer la cohorte completa y particionarla en memoria.
  No está pedido, queda anotado
- **Gestión de clases/reservas** (`GymClass` + `ClassBooking`) — se evaluó como tanda
  5 del dashboard de KPIs y se descartó por decisión del usuario; podría retomarse
  como feature independiente
- **Notificaciones proactivas** (WhatsApp o email) para vencimientos próximos de
  rutina o membresía, más allá de los endpoints de consulta que ya existen
- **Panel de auditoría** de cambios sobre credenciales sensibles por gym (AFIP,
  Mercado Pago, IA, WhatsApp), dado que hoy se cifran pero no se versiona su historial
