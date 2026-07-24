# 📊 Contexto General del Proyecto Gym CRM Backend

**Fecha de actualización:** 2026-07-19

## 🏗️ Estado del Proyecto: ✅ 99% Implementado (Etapa Inicial)

Todas las funcionalidades principales del roadmap están implementadas. Queda un detalle técnico de infraestructura.

---

## ✅ Lo que está IMPLEMENTADO (VERIFICADO)

### Configuración y Base

| Componente        | Estado      | Detalles                                                                                                      |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| **package.json**  | ✅ Completo | Dependencies: express, mongoose, jsonwebtoken, bcrypt, zod, redis, @anthropic-ai/sdk, openai, pdf-lib, bullmq |
| **Configuración** | ✅ Completo | `.env.example`, `env.ts` (validación con Zod), `database.ts`, `redis.ts`                                      |
| **App Express**   | ✅ Completo | `src/app.ts` con helmet, cors, cookie-parser, json body parser, error handler                                 |
| **Server**        | ✅ Completo | `src/server.ts` con graceful shutdown                                                                         |

### Domain Layer

| Archivo                                         | Estado                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| `src/domain/entities/User.ts`                   | ✅ Entidad + mapper + tipos                       |
| `src/domain/entities/Gym.ts`                    | ✅ Entidad + mapper + tipos (con afipConfig)      |
| `src/domain/entities/Client.ts`                 | ✅ Entidad + mapper + tipos                       |
| `src/domain/entities/Routine.ts`                | ✅ Entidad + mapper + tipos                       |
| `src/domain/entities/Invoice.ts`                | ✅ **NUEVO** Entidad + mapper facturación         |
| `src/domain/billing/types.ts`                   | ✅ **NUEVO** Tipos para AFIP SDK                  |
| `src/domain/repositories/IUserRepository.ts`    | ✅ Interface + Implementación                     |
| `src/domain/repositories/IGymRepository.ts`     | ✅ Interface + Implementación (con getAfipApiKey) |
| `src/domain/repositories/IClientRepository.ts`  | ✅ Interface + Implementación                     |
| `src/domain/repositories/IRoutineRepository.ts` | ✅ Interface + Implementación                     |
| `src/domain/repositories/IInvoiceRepository.ts` | ✅ **NUEVO** Interface completa                   |
| `src/domain/services/IAIProvider.ts`            | ✅ Interface + OpenAI + Anthropic + Factory       |
| `src/domain/services/IWhatsappProvider.ts`      | ✅ Interface + MetaCloudApiProvider               |
| `src/domain/services/IPdfGenerator.ts`          | ✅ Interface + PuppeteerPdfGenerator              |
| `src/domain/services/IFormsProvider.ts`         | ✅ Interface + GoogleFormsWebhookHandler          |
| `src/domain/services/IInvoiceProvider.ts`       | ✅ **NUEVO** Interface para facturación           |

### Infrastructure Layer

| Submódulo                     | Estado                                               |
| ----------------------------- | ---------------------------------------------------- |
| **Schemas Mongoose**          | ✅ User, Gym, Client, Routine, Invoice con índices   |
| **MongoUserRepository**       | ✅ Implementado (corregido findByEmail)              |
| **MongoGymRepository**        | ✅ Implementado con EnvGymSecretsRepository          |
| **MongoClientRepository**     | ✅ Implementado con search, getExpiringSoon          |
| **MongoRoutineRepository**    | ✅ Implementado con updateStatus, countExpiringByDay |
| **MongoInvoiceRepository**    | ✅ **NUEVO** Implementación real para facturación    |
| **Queues**                    | ✅ routineQueue, whatsappQueue, invoiceQueue         |
| **Workers**                   | ✅ routineWorker + whatsappWorker + invoiceWorker    |
| **OpenAIProvider**            | ✅ Implementado                                      |
| **AnthropicProvider**         | ✅ Implementado                                      |
| **AIProviderFactory**         | ✅ Implementado                                      |
| **PuppeteerPdfGenerator**     | ✅ Implementado                                      |
| **MetaCloudApiProvider**      | ✅ Implementado                                      |
| **GoogleFormsWebhookHandler** | ✅ Implementado                                      |
| **AfipSdkAdapter**            | ✅ **NUEVO** Integración completa con AFIP SDK       |

### Interfaces Layer

| Componente                | Estado                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| `authMiddleware.ts`       | ✅ JWT verification                                                            |
| `tenantMiddleware.ts`     | ✅ Multi-tenant con soporte admin/gym                                          |
| `roleMiddleware.ts`       | ✅ requireAdmin, requireGym, requireAuth                                       |
| `errorHandler.ts`         | ✅ Manejo centralizado de errores                                              |
| `AuthController.ts`       | ✅ login, refresh, me, logout                                                  |
| `GymController.ts`        | ✅ CRUD gimnasios + settings                                                   |
| `ClientController.ts`     | ✅ **NUEVO** CRUD clientes + renew + expiring                                  |
| `DashboardController.ts`  | ✅ **NUEVO** dashboard con métricas                                            |
| `OnboardingController.ts` | ✅ Webhook + status                                                            |
| `RoutineController.ts`    | ✅ generate, get, expiring, resend                                             |
| `Routes/index.ts`         | ✅ auth, admin/gyms, gyms (settings), onboarding, routines, clients, dashboard |

### Application Layer

| Use Cases                    | Estado          |
| ---------------------------- | --------------- |
| LoginUseCase                 | ✅ Implementado |
| RefreshTokenUseCase          | ✅ Implementado |
| CreateGymUseCase             | ✅ Implementado |
| UpdateGymUseCase             | ✅ Implementado |
| DeleteGymUseCase             | ✅ Implementado |
| ListGymsUseCase              | ✅ Implementado |
| GetGymSettingsUseCase        | ✅ Implementado |
| ProcessFormSubmissionUseCase | ✅ Implementado |
| GenerateRoutineUseCase       | ✅ Implementado |
| CreateClientUseCase          | ✅ **NUEVO**    |
| SearchClientsUseCase         | ✅ **NUEVO**    |
| UpdateClientUseCase          | ✅ **NUEVO**    |
| DeleteClientUseCase          | ✅ **NUEVO**    |
| RenewClientUseCase           | ✅ **NUEVO**    |
| GetGymDashboardUseCase       | ✅ **NUEVO**    |

---

## ✅ IMPLEMENTADO (2026-07-18 y 2026-07-19)

### Módulo AFIP SDK (Facturación Electrónica)

#### Domain

- `src/domain/billing/types.ts` - Tipos: `GymTaxCondition`, `TenantApiConfig`, `GymInvoicePayload`, `AfipSdkInvoiceResponse`
- `src/domain/entities/Invoice.ts` - Entidad de factura con mapper
- `src/domain/services/IInvoiceProvider.ts` - Interface del proveedor de facturación
- `src/domain/repositories/IInvoiceRepository.ts` - Interface del repositorio (actualizada)

#### Infrastructure

- `src/infrastructure/database/mongoose/schemas/InvoiceSchema.ts` - Schema Mongoose
- `src/infrastructure/database/mongoose/repositories/MongoInvoiceRepository.ts` - Repository con CRUD completo
- `src/infrastructure/external/billing/AfipSdkAdapter.ts` - Adaptador HTTP para AFIP SDK
- `src/infrastructure/queues/workers/invoiceWorker.ts` - Worker para procesamiento asíncrono
- `src/infrastructure/queues/routineQueue.ts` - Agregada `invoiceQueue` y `InvoiceJobData`

#### Configuration

- Variables de entorno agregadas: `AFIP_SDK_API_KEY`
- `Gym.afipConfig` agregado a entidad y schema
- `EnvGymSecretsRepository.getAfipApiKey()` agregado

### Integración Automática Facturas

- `RenewClientUseCase` actualizado: encola automáticamente factura en `invoiceQueue`
- Trigger: al renovar cliente → se genera factura electrónica automáticamente
- Payload incluye: gymId, clientId, amount, clientDocument (DNI), descripción mensual

### Seguridad AES-256-GCM (2026-07-19)

- `src/infrastructure/encryption/EncryptionService.ts` - Servicio de encriptación AES-256-GCM
- `Gym.afipConfig.encryptedApiKey` - Campo para almacenar credenciales encriptadas
- `UpdateAfipConfigUseCase` - Use case para configurar credenciales encriptadas
- `EnvGymSecretsRepository.getAfipApiKey()` - Soporta desencriptado automático de credenciales
- Estrategia de fallback: Secret Manager → Encriptado → Env Var

---

## ⚠️ PENDIENTE: Infraestructura de Testing (mongodb-memory-server)

### Error Detectado

```
Starting the MongoMemoryServer Instance failed: Md5CheckFailed
Binary MD5 is "2a499598acdd64021681276c8742c8d4"
Checkfile MD5 is "b794b99d839b73b3862972d2e170018f"
Hook timed out in 10000ms
ENOENT: no such file or directory al renombrar el archivo descargado
```

### Causa Raíz

1. **mongodb-memory-server** intenta descargar automáticamente binarios de MongoDB durante el setup de tests
2. La descarga o el proceso de verificación MD5 falla en el entorno Windows
3. El archivo `.cache\mongodb-binaries\mongodb-windows-x86_64-8.2.6.zip` no se crea correctamente

### Solución Recomendada

1. **Opción A - Pre-instalar MongoDB:**
   - Instalar MongoDB 8.2.6+ localmente en Windows
   - Configurar `MONGOMS_SYSTEMHOME` apuntando al directorio de MongoDB instalado

2. **Opcion B - Usar MongoDB en Docker:**
   - Levantar MongoDB en Docker (aunque el proyecto no usa Docker-compose, se puede levantar solo MongoDB)
   - Modificar `tests/setup.ts` para conectarse a la instancia en lugar de mongodb-memory-server

3. **Opcion C - Configurar mongodb-memory-server:**

   ```bash
   # Instalar MongoDB binaries manualmente
   npm install mongodb-memory-server-core
   # O usar MONGOMS_DOWNLOAD_MIRROR=https://fastdl.mongodb.org
   ```

4. **Opcion D - Tests sin MongoDB en memoria:**
   - Eliminar mongodb-memory-server
   - Usar mocks estrictos para tests unitarios
   - Tests de integración contra BD real en otro script

### Workaround Temporal

Los tests pueden ejecutarse en un entorno Linux/WSL donde mongodb-memory-server funciona correctamente, o contra una instancia MongoDB local ejecutando:

```bash
# En otro terminal
mongod --port 27017
# Luego ejecutar tests
npm run test
```

---

## 🔧 Decisiones Técnicas Confirmadas

| Decisión          | Elección                                                     |
| ----------------- | ------------------------------------------------------------ |
| PDF Generation    | Puppeteer + HTML (diseño gráfico)                            |
| Delete Strategy   | Soft delete (estado: 'inactivo')                             |
| Invoice Contract  | Usar sumRevenueByMonth(gymId, year, month)                   |
| Admin Seed        | Variables de entorno (SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD) |
| Facturación AFIP  | API REST vía AFIP SDK con colas BullMQ                       |
| Secret Management | Env vars (temporal) - preparado para secret manager real     |

---

## 🚀 Para probar el sistema

1. **Instalar dependencias:** `npm install`
2. **Variables de entorno necesarias en `.env`:**
   ```bash
   MONGO_URI=mongodb://localhost:27017/gym-crm
   REDIS_HOST=localhost
   REDIS_PORT=6379

   JWT_ACCESS_SECRET=asdasd
   JWT_REFRESH_SECRET=asdasd

   SUPERADMIN_EMAIL=superadmin@gymcrm.com  # Opcional
   SUPERADMIN_PASSWORD=tu_password_seguro   # Opcional

   OPENAI_API_KEY=sk-xxx (opcional, para IA)
   AFIP_SDK_API_KEY=tu_token_afip_sdk     # Opcional
   ```
3. **Levantar MongoDB y Redis** (instalación local o servicios externos)
4. **Ejecutar seed de superadmin (opcional):** `npx ts-node src/scripts/seed-superadmin.ts`
5. **Ejecutar servidor:** `npm run dev`
6. **Ejecutar workers:** `npm run worker:dev` (en otra terminal)
7. **Ejecutar tests:** `npm run test`

---

## ⚠️ Error de arranque - Variables de entorno faltantes

### Error recibido al ejecutar `npm run dev`

```
ZodError: [
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": ["MONGO_URI"],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": ["JWT_ACCESS_SECRET"],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": ["JWT_REFRESH_SECRET"],
    "message": "Required"
  }
]
```

### Variables obligatorias para ejecutar el servidor

- `MONGO_URI` - Conexión a MongoDB (ej: `mongodb://localhost:27017/gym-crm`)
- `JWT_ACCESS_SECRET` - Secreto para firmar tokens de acceso (64 caracteres hex recomendado)
- `JWT_REFRESH_SECRET` - Secreto para firmar tokens de refresh (64 caracteres hex recomendado)

### Solución rápida

Ejecutar en PowerShell:

```powershell
Copy-Item .env.example .env
```

Luego editar `.env` si es necesario (las claves JWT ya vienen en el ejemplo).

### Generar nuevas claves seguras (opcional)

```powershell
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🗂️ Endpoints disponibles

| Método        | Endpoint                           | Auth          | Descripción                       |
| ------------- | ---------------------------------- | ------------- | --------------------------------- |
| POST          | `/api/auth/login`                  | ❌            | Login con JWT                     |
| POST          | `/api/auth/refresh`                | ❌            | Refresca access token             |
| POST          | `/api/auth/logout`                 | ✅            | Cierra sesión                     |
| GET           | `/api/auth/me`                     | ✅            | Usuario actual                    |
| POST          | `/api/admin/gyms`                  | ✅ admin      | Crear gimnasio                    |
| GET           | `/api/admin/gyms`                  | ✅ admin      | Listar gimnasios                  |
| PUT           | `/api/admin/gyms/:id`              | ✅ admin      | Actualizar gimnasio               |
| DELETE        | `/api/admin/gyms/:id`              | ✅ admin      | Desactivar gimnasio               |
| GET           | `/api/gyms/settings`               | ✅ gym        | Configuración del gym             |
| PUT           | `/api/gyms/settings/ai-prompt`     | ✅ gym        | Actualizar prompt IA              |
| POST          | `/api/onboarding/webhook`          | ❌            | Webhook Google Forms              |
| GET           | `/api/onboarding/status`           | ✅            | Estado onboarding                 |
| POST          | `/api/routines/generate/:clientId` | ✅ gym        | Generar rutina                    |
| GET           | `/api/routines/:id`                | ✅ gym        | Obtener rutina                    |
| GET           | `/api/routines/client/:clientId`   | ✅ gym        | Rutinas por cliente               |
| GET           | `/api/routines/expiring?days=7`    | ✅ gym        | Rutinas por vencer                |
| **CLIENTS**   |
| GET           | `/api/clients`                     | ✅ gym, admin | Listar clientes (paginado)        |
| GET           | `/api/clients/search?q=`           | ✅ gym, admin | Búsqueda por nombre o documento   |
| GET           | `/api/clients/expiring`            | ✅ gym, admin | Clientes próximos a vencer        |
| GET           | `/api/clients/:id`                 | ✅ gym, admin | Detalle de cliente                |
| POST          | `/api/clients`                     | ✅ gym, admin | Crear cliente                     |
| PUT           | `/api/clients/:id`                 | ✅ gym, admin | Actualizar cliente                |
| DELETE        | `/api/clients/:id`                 | ✅ gym, admin | Eliminar cliente (soft delete)    |
| POST          | `/api/clients/:id/renew`           | ✅ gym, admin | Renovar cliente + generar factura |
| **DASHBOARD** |
| GET           | `/api/dashboard`                   | ✅ gym, admin | Métricas del gym                  |
| GET           | `/api/dashboard?gymId=`            | ✅ admin      | Métricas de gym específico        |
| GET           | `/api/dashboard/summary`           | ✅ admin      | Resumen global de todos los gyms  |

---

## 📁 Estructura de archivos clave

```
gym-crm-backend/
├── src/
│   ├── domain/
│   │   ├── billing/
│   │   │   └── types.ts           # Tipos AFIP SDK
│   │   ├── entities/
│   │   │   ├── Invoice.ts         # Entidad factura
│   │   │   └── Gym.ts             # Actualizado con afipConfig
│   │   └── services/
│   │       └── IInvoiceProvider.ts # Nueva interface
│   ├── application/
│   │   └── use-cases/
│   │       ├── client/
│   │       │   ├── CreateClientUseCase.ts
│   │       │   ├── SearchClientsUseCase.ts
│   │       │   ├── UpdateClientUseCase.ts
│   │       │   ├── DeleteClientUseCase.ts
│   │       │   └── RenewClientUseCase.ts
│   │       └── dashboard/
│   │           └── GetGymDashboardUseCase.ts
│   ├── infrastructure/
│   │   ├── database/
│   │   │   └── mongoose/
│   │   │       ├── schemas/
│   │   │       │   └── InvoiceSchema.ts
│   │   │       └── repositories/
│   │   │           └── MongoInvoiceRepository.ts
│   │   ├── external/
│   │   │   └── billing/
│   │   │       └── AfipSdkAdapter.ts
│   │   └── queues/
│   │       ├── routineQueue.ts    # Agregada invoiceQueue
│   │       └── workers/
│   │           └── invoiceWorker.ts
│   └── scripts/
│       └── seed-superadmin.ts
└── tests/
    └── unit/
        ├── client/
        │   ├── SearchClientsUseCase.test.ts
        │   └── RenewClientUseCase.test.ts
        └── dashboard/
            └── GetGymDashboardUseCase.test.ts
```
