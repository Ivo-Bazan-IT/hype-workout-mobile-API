# Gym CRM — Documentación de Backend

**Stack:** MERN (MongoDB, Express, React, Node.js) — Backend en Node.js + TypeScript
**Arquitectura:** Hexagonal / Clean Architecture con enfoque Multi-Tenant
**Autor del diseño:** Documentación técnica generada para scaffolding inicial del proyecto

---

## 0. Supuestos técnicos declarados

Antes de arrancar, estas son las decisiones de stack que tomé para poder darte un documento accionable. Están marcadas para que las valides o cambies según tu criterio:

| Decisión                 | Elección                                                                                                                                | Alternativa considerada                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenancy            | Base de datos **compartida** (shared DB, shared collections) con `gymId` como discriminador en cada documento, inyectado por middleware | DB-per-tenant (descartado: overhead operativo innecesario para 2 roles y volumen esperado)                                                           |
| WhatsApp API             | **Meta WhatsApp Cloud API** (oficial)                                                                                                   | Twilio (más simple pero con costo por mensaje adicional), Baileys/whatsapp-web.js (no oficial, riesgo de baneo — **no recomendado para producción**) |
| Generación de PDF        | **pdf-lib** (overlay de texto sobre plantilla PDF existente)                                                                            | Puppeteer + HTML template (más flexible si la plantilla es un diseño gráfico, no un PDF con campos fijos)                                            |
| Proveedor de IA          | Patrón adaptador (`IAIProvider`) soportando **OpenAI y/o Anthropic** de forma intercambiable, configurable por gym                      | —                                                                                                                                                    |
| Integración Google Forms | **Google Apps Script** vinculado al Form/Sheet que dispara un webhook POST a nuestro backend                                            | Polling periódico a Google Sheets API (fallback si no se puede instalar el script)                                                                   |
| Colas asíncronas         | **BullMQ + Redis** para generación de IA, PDF y envío de WhatsApp                                                                       | Procesamiento síncrono (descartado: latencia de IA + WhatsApp puede superar timeouts HTTP)                                                           |
| Autenticación            | JWT access token (corta duración) + refresh token (httpOnly cookie)                                                                     | Sesiones en servidor (descartado: no es stateless, complica escalado horizontal)                                                                     |

Si alguno de estos puntos no coincide con lo que tenías en mente (por ejemplo, si ya tenés decidido usar Twilio, o si tu plantilla de rutina es una imagen/diseño y no un PDF con campos), avisame y ajusto la sección correspondiente.

---

## 1. Stack Tecnológico

- **Runtime:** Node.js 20 LTS
- **Lenguaje:** TypeScript 5.x
- **Framework HTTP:** Express 4.x
- **Base de datos:** MongoDB 7.x + Mongoose 8.x (ODM)
- **Cache / Colas:** Redis 7.x + BullMQ
- **Autenticación:** JWT (jsonwebtoken) + bcrypt
- **Validación:** Zod
- **Generación de PDF:** pdf-lib
- **Automatización navegador (alternativa PDF):** Puppeteer
- **IA:** OpenAI SDK / Anthropic SDK (patrón adaptador)
- **WhatsApp:** Meta WhatsApp Cloud API (vía Axios/fetch, sin SDK oficial de Node robusto)
- **Logging:** Pino
- **Testing:** Vitest + Supertest + mongodb-memory-server
- **Linting/Formato:** ESLint + Prettier
- **Contenedores (dev local):** Docker Compose (Mongo + Redis)

---

## 2. Arquitectura General

Se propone **Hexagonal Architecture** (Ports & Adapters) con 4 capas:

```
Domain (entidades, interfaces de repos, interfaces de servicios externos)
        ↑
Application (casos de uso — orquestan domain, no conocen Express ni Mongoose)
        ↑
Infrastructure (implementaciones concretas: Mongoose, OpenAI, Meta API, BullMQ)
        ↑
Interfaces/HTTP (controllers, rutas, middlewares — punto de entrada)
```

**Regla de dependencia:** las capas internas (domain, application) nunca importan de infrastructure ni de interfaces/http. Los casos de uso reciben las implementaciones por **inyección de dependencias** (constructor injection simple, sin necesidad de un contenedor DI pesado tipo InversifyJS, salvo que prefieras usarlo).

### 2.1 Estrategia Multi-Tenant

Con solo dos roles (`admin`, `gym`), el modelo es:

- **Admin:** un único tipo de usuario "superadmin" que gestiona la tabla de Gyms (tenants) y puede ver el dashboard de cualquier gym.
- **Gym:** cada usuario de este rol pertenece a **un** gym (`gymId` en el JWT). Todas sus queries quedan automáticamente filtradas por ese `gymId`.

**Middleware clave:** `tenantMiddleware` — lee el rol del JWT decodificado:

- Si `role === 'gym'`: inyecta `req.tenantId = decodedToken.gymId` (inmutable, no se puede pasar por query/body).
- Si `role === 'admin'`: permite `req.tenantId` opcional vía query param (`?gymId=...`) para consultar datos de un gym específico; si no se pasa, se listan/agregan todos los gyms según el endpoint.

Todos los repositorios (Client, Routine, Invoice) exponen métodos que **requieren** `gymId` como parámetro obligatorio — nunca hay una query "global" salvo las explícitamente admin-only.

---

## 3. Modelo de Datos (Mongoose Schemas)

### 3.1 User

```typescript
// infrastructure/database/mongoose/schemas/UserSchema.ts
import { Schema, model, Types } from "mongoose";

export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: "admin" | "gym";
  gymId?: Types.ObjectId; // null/undefined si role === 'admin'
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "gym"], required: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: function () {
        return this.role === "gym";
      },
    },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const UserModel = model<UserDocument>("User", userSchema);
```

### 3.2 Gym (Tenant)

```typescript
// infrastructure/database/mongoose/schemas/GymSchema.ts
import { Schema, model, Types } from "mongoose";

export interface GymDocument {
  _id: Types.ObjectId;
  name: string;
  businessName: string;
  cuit: string; // usado para integración con Arca
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;

  aiConfig: {
    provider: "openai" | "anthropic";
    promptTemplate: string; // plantilla editable por el gym, con placeholders {{respuestas_encuesta}}
    model?: string;
  };

  whatsappConfig: {
    phoneNumberId: string; // ID del número en Meta Cloud API
    // el access token NO se guarda en el documento del gym en texto plano,
    // se referencia un secretRef que apunta a un secret manager / var de entorno cifrada
    tokenSecretRef: string;
  };

  pdfTemplate: {
    storagePath: string; // ruta al PDF plantilla subido por el gym
    fieldsMap: Record<
      string,
      { x: number; y: number; page: number; fontSize: number }
    >; // coordenadas de overlay
  };

  googleFormConfig: {
    formId: string;
    webhookSecret: string; // usado para validar que el POST viene del Apps Script legítimo
  };

  createdAt: Date;
  updatedAt: Date;
}

const gymSchema = new Schema<GymDocument>(
  {
    name: { type: String, required: true },
    businessName: { type: String, required: true },
    cuit: { type: String, required: true, unique: true },
    contactEmail: { type: String, required: true },
    contactPhone: { type: String, required: true },
    isActive: { type: Boolean, default: true },

    aiConfig: {
      provider: {
        type: String,
        enum: ["openai", "anthropic"],
        default: "openai",
      },
      promptTemplate: { type: String, required: true },
      model: { type: String },
    },

    whatsappConfig: {
      phoneNumberId: { type: String, required: true },
      tokenSecretRef: { type: String, required: true },
    },

    pdfTemplate: {
      storagePath: { type: String },
      fieldsMap: { type: Schema.Types.Mixed },
    },

    googleFormConfig: {
      formId: { type: String },
      webhookSecret: { type: String },
    },
  },
  { timestamps: true },
);

export const GymModel = model<GymDocument>("Gym", gymSchema);
```

> **Nota de seguridad:** los tokens de WhatsApp/IA nunca se guardan en texto plano en Mongo. Usá un secret manager (AWS Secrets Manager, Doppler, Infisical, o como mínimo variables de entorno por gym si el volumen es bajo) y guardá solo la referencia (`tokenSecretRef`) en el documento.

### 3.3 Client (colección de documentos JSON por gym)

Tal como especificaste, los clientes se guardan como documentos flexibles (sin relaciones), ideal para el modelo de documentos de Mongo:

```typescript
// infrastructure/database/mongoose/schemas/ClientSchema.ts
import { Schema, model, Types } from "mongoose";

export interface ClientDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  nombre: string;
  documento: string; // DNI/CUIT del cliente — indexado para búsqueda
  telefono: string;
  email?: string;
  estado: "activo" | "inactivo" | "pendiente";
  fechaInicio: Date;
  fechaVencimiento: Date; // usado para el dashboard de renovaciones
  esRecurrente: boolean; // true si tiene más de una renovación histórica
  historialRenovaciones: { fecha: Date; monto: number }[];
  encuestaData: Record<string, any>; // respuestas crudas de Google Forms (schema-less)
  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<ClientDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    nombre: { type: String, required: true },
    documento: { type: String, required: true },
    telefono: { type: String, required: true },
    email: { type: String },
    estado: {
      type: String,
      enum: ["activo", "inactivo", "pendiente"],
      default: "pendiente",
    },
    fechaInicio: { type: Date, required: true },
    fechaVencimiento: { type: Date, required: true },
    esRecurrente: { type: Boolean, default: false },
    historialRenovaciones: [{ fecha: Date, monto: Number }],
    encuestaData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Índices clave para el buscador (nombre + documento)
clientSchema.index({ gymId: 1, documento: 1 });
clientSchema.index({ gymId: 1, nombre: "text" });
clientSchema.index({ gymId: 1, fechaVencimiento: 1 }); // para queries de dashboard (7/5/3 días)
clientSchema.index({ gymId: 1, estado: 1 });

export const ClientModel = model<ClientDocument>("Client", clientSchema);
```

> **Sobre la búsqueda por nombre y documento:** Mongo `text` index sirve bien para nombre (búsqueda difusa/parcial), pero para documento (DNI) conviene un índice normal + regex con prefijo anclado (`^12345`) para autocompletado, ya que un `text` index no maneja bien substrings numéricos. El endpoint de búsqueda combina ambas estrategias (ver sección 5.3).

### 3.4 Routine (rutina generada por IA)

```typescript
// infrastructure/database/mongoose/schemas/RoutineSchema.ts
import { Schema, model, Types } from "mongoose";

export interface RoutineDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  promptUsado: string; // snapshot del prompt + datos de encuesta al momento de generar
  contenidoGenerado: Record<string, any>; // JSON estructurado devuelto por la IA (días, ejercicios, series, etc.)
  pdfUrl?: string; // ubicación del PDF generado (storage local o bucket)
  estadoGeneracion: "pendiente" | "generando" | "generado" | "error";
  estadoEnvio: "pendiente" | "enviando" | "enviado" | "error";
  whatsappMessageId?: string;
  fechaGeneracion?: Date;
  fechaVencimiento: Date; // igual a la del cliente, usado para el dashboard
  createdAt: Date;
  updatedAt: Date;
}

const routineSchema = new Schema<RoutineDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    promptUsado: { type: String },
    contenidoGenerado: { type: Schema.Types.Mixed },
    pdfUrl: { type: String },
    estadoGeneracion: {
      type: String,
      enum: ["pendiente", "generando", "generado", "error"],
      default: "pendiente",
    },
    estadoEnvio: {
      type: String,
      enum: ["pendiente", "enviando", "enviado", "error"],
      default: "pendiente",
    },
    whatsappMessageId: { type: String },
    fechaGeneracion: { type: Date },
    fechaVencimiento: { type: Date, required: true },
  },
  { timestamps: true },
);

routineSchema.index({ gymId: 1, fechaVencimiento: 1 });
routineSchema.index({ gymId: 1, clientId: 1 });

export const RoutineModel = model<RoutineDocument>("Routine", routineSchema);
```

### 3.5 Invoice (referencia — el módulo de Arca ya está construido)

Como me comentaste que la facturación con Arca ya la tenés implementada, acá documento el **contrato de datos** que el resto del sistema espera de ese módulo, para que el dashboard y los demás módulos puedan integrarse sin fricción:

```typescript
export interface InvoiceDocument {
  _id: Types.ObjectId;
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  tipoComprobante: string; // ej: "Factura C"
  cae: string; // Código de Autorización Electrónico (Arca)
  monto: number;
  fechaEmision: Date;
  estado: "emitida" | "anulada" | "error";
}
```

**Requisito de integración para el Dashboard:** el módulo de Arca debe exponer (internamente, vía repositorio) un método:

```typescript
interface IInvoiceRepository {
  sumRevenueByMonth(
    gymId: string,
    year: number,
    month: number,
  ): Promise<number>;
}
```

Esto es lo único que el módulo de Dashboard necesita consumir de tu módulo de facturación existente.

---

## 4. Módulos y Endpoints REST

### 4.1 Auth

| Método | Endpoint            | Rol                       | Descripción                                                           |
| ------ | ------------------- | ------------------------- | --------------------------------------------------------------------- |
| POST   | `/api/auth/login`   | público                   | Login, devuelve access token + setea refresh token en cookie httpOnly |
| POST   | `/api/auth/refresh` | público (requiere cookie) | Renueva access token                                                  |
| POST   | `/api/auth/logout`  | autenticado               | Invalida refresh token                                                |
| GET    | `/api/auth/me`      | autenticado               | Devuelve datos del usuario logueado + rol + gymId si aplica           |

### 4.2 Admin — Gestión de Gyms (CRUD)

| Método | Endpoint              | Rol   | Descripción                                                              |
| ------ | --------------------- | ----- | ------------------------------------------------------------------------ |
| GET    | `/api/admin/gyms`     | admin | Lista todos los gyms                                                     |
| GET    | `/api/admin/gyms/:id` | admin | Detalle de un gym                                                        |
| POST   | `/api/admin/gyms`     | admin | Crea gym + usuario inicial de tipo `gym`                                 |
| PUT    | `/api/admin/gyms/:id` | admin | Edita datos del gym                                                      |
| DELETE | `/api/admin/gyms/:id` | admin | Baja lógica (isActive = false) — **no** borrado físico, por trazabilidad |

### 4.3 Clientes

| Método | Endpoint                 | Rol        | Descripción                                                                                       |
| ------ | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/clients`           | gym, admin | Lista paginada de clientes del gym (o del gym indicado por admin vía `?gymId=`)                   |
| GET    | `/api/clients/search?q=` | gym, admin | Búsqueda por nombre (texto parcial) o documento (prefijo)                                         |
| GET    | `/api/clients/:id`       | gym, admin | Detalle                                                                                           |
| POST   | `/api/clients`           | gym, admin | Alta manual (fuera del flujo de onboarding automático)                                            |
| PUT    | `/api/clients/:id`       | gym, admin | Edición                                                                                           |
| POST   | `/api/clients/:id/renew` | gym, admin | Renovación — actualiza `fechaVencimiento`, agrega a `historialRenovaciones`, marca `esRecurrente` |
| DELETE | `/api/clients/:id`       | gym, admin | Borrado (soft delete recomendado, ver nota abajo)                                                 |

> **Nota sobre borrado:** para no perder trazabilidad de facturación/rutinas asociadas, se recomienda soft-delete (`estado: 'inactivo'` + flag `eliminado: true`) en vez de borrado físico. Si preferís borrado físico real, es un cambio menor en el use case `DeleteClientUseCase`.

### 4.4 Onboarding (Google Forms)

| Método | Endpoint                  | Rol                                            | Descripción                                                                                                     |
| ------ | ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/onboarding/webhook` | público (validado por `webhookSecret` del gym) | Recibe el POST del Google Apps Script con las respuestas del formulario, crea el `Client` en estado `pendiente` |
| GET    | `/api/onboarding/status`  | gym                                            | Ve el estado de sincronización de las últimas respuestas recibidas                                              |

**Flujo Google Forms → Backend (detallado en sección 5.1).**

### 4.5 Rutinas (generación IA + envío WhatsApp)

| Método | Endpoint                           | Rol        | Descripción                                                 |
| ------ | ---------------------------------- | ---------- | ----------------------------------------------------------- |
| POST   | `/api/routines/generate/:clientId` | gym        | Encola job de generación de rutina con IA                   |
| GET    | `/api/routines/:id`                | gym, admin | Detalle de una rutina (incluye estado de generación/envío)  |
| GET    | `/api/routines/client/:clientId`   | gym        | Historial de rutinas de un cliente                          |
| POST   | `/api/routines/:id/resend`         | gym        | Reintenta el envío por WhatsApp si falló                    |
| GET    | `/api/routines/expiring?days=7`    | gym, admin | Rutinas a X días de vencer (usado también por el dashboard) |

### 4.6 Configuración del Gym (IA, WhatsApp, plantilla PDF)

| Método | Endpoint                         | Rol | Descripción                                                       |
| ------ | -------------------------------- | --- | ----------------------------------------------------------------- |
| GET    | `/api/gym/settings`              | gym | Devuelve `aiConfig`, `whatsappConfig` (sin tokens), `pdfTemplate` |
| PUT    | `/api/gym/settings/ai-prompt`    | gym | Actualiza el prompt template propio del gym                       |
| POST   | `/api/gym/settings/pdf-template` | gym | Sube la plantilla PDF (multipart/form-data) + define `fieldsMap`  |

### 4.7 Dashboard

| Método | Endpoint                 | Rol   | Descripción                                                                      |
| ------ | ------------------------ | ----- | -------------------------------------------------------------------------------- |
| GET    | `/api/dashboard`         | gym   | Métricas del gym logueado                                                        |
| GET    | `/api/dashboard?gymId=`  | admin | Métricas de un gym específico                                                    |
| GET    | `/api/dashboard/summary` | admin | Métricas agregadas de todos los gyms (opcional, útil para vista global de admin) |

**Respuesta de `/api/dashboard`:**

```json
{
  "clientesActivos": 128,
  "clientesRecurrentes": 74,
  "rutinasPorVencer": { "en7Dias": 12, "en5Dias": 6, "en3Dias": 3 },
  "ingresos": { "mesActual": 450000, "mesPrevio": 398000 }
}
```

**Implementación de la query (aggregation pipeline, ejemplo simplificado):**

```typescript
// application/use-cases/dashboard/GetGymDashboardUseCase.ts
async function getRoutinesExpiringByDay(gymId: string, days: number) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  const startOfDay = new Date(target.setHours(0, 0, 0, 0));
  const endOfDay = new Date(target.setHours(23, 59, 59, 999));

  return RoutineModel.countDocuments({
    gymId,
    fechaVencimiento: { $gte: startOfDay, $lte: endOfDay },
  });
}
```

---

## 5. Integraciones Externas — Detalle de Implementación

### 5.1 Google Forms → Onboarding

Google Forms no tiene webhooks nativos, así que la integración recomendada es:

1. En el Google Form (o su Sheet de respuestas vinculada), instalar un **Google Apps Script** con un trigger `onFormSubmit`.
2. El script arma un JSON con las respuestas y hace un `UrlFetchApp.fetch()` tipo POST a `https://tu-dominio.com/api/onboarding/webhook`, incluyendo un header `x-webhook-secret` que coincide con el `googleFormConfig.webhookSecret` del gym.
3. El backend valida el secret, mapea las respuestas del form a `encuestaData` y crea el `Client` en estado `pendiente`.

```javascript
// Apps Script (se instala en el lado de Google, no en tu backend)
function onFormSubmit(e) {
  const responses = e.namedValues;
  const payload = {
    gymId: "GYM_ID_AQUI",
    respuestas: responses,
  };

  UrlFetchApp.fetch("https://tu-dominio.com/api/onboarding/webhook", {
    method: "post",
    contentType: "application/json",
    headers: { "x-webhook-secret": "SECRET_DEL_GYM" },
    payload: JSON.stringify(payload),
  });
}
```

**Alternativa sin Apps Script:** si no querés depender de instalar un script por cada gym, se puede hacer polling con la **Google Forms API** o **Google Sheets API** (leer filas nuevas cada N minutos vía cron/BullMQ repeatable job). Es más simple de desplegar pero no es en tiempo real.

### 5.2 Generación de Rutinas con IA

Patrón adaptador para poder cambiar de proveedor sin tocar el caso de uso:

```typescript
// domain/services/IAIProvider.ts
export interface IAIProvider {
  generateRoutine(params: {
    promptTemplate: string;
    encuestaData: Record<string, any>;
  }): Promise<{ contenidoGenerado: Record<string, any> }>;
}
```

```typescript
// infrastructure/external/ai/OpenAIProvider.ts
import OpenAI from "openai";
import { IAIProvider } from "../../../domain/services/IAIProvider";

export class OpenAIProvider implements IAIProvider {
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateRoutine({
    promptTemplate,
    encuestaData,
  }: {
    promptTemplate: string;
    encuestaData: Record<string, any>;
  }) {
    const finalPrompt = promptTemplate.replace(
      "{{respuestas_encuesta}}",
      JSON.stringify(encuestaData),
    );

    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Devolvé únicamente un JSON válido con la estructura de rutina solicitada, sin texto adicional.",
        },
        { role: "user", content: finalPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const contenidoGenerado = JSON.parse(
      response.choices[0].message.content ?? "{}",
    );
    return { contenidoGenerado };
  }
}
```

El `promptTemplate` es 100% editable por cada gym desde `/api/gym/settings/ai-prompt`, y se le inyecta `encuestaData` (las respuestas de Google Forms) en el placeholder `{{respuestas_encuesta}}`.

### 5.3 Generación de PDF sobre plantilla

```typescript
// infrastructure/external/pdf/PdfLibGenerator.ts
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs/promises";

export class PdfLibGenerator {
  async generateFromTemplate(
    templatePath: string,
    fieldsMap: Record<
      string,
      { x: number; y: number; page: number; fontSize: number }
    >,
    data: Record<string, string>,
  ): Promise<Buffer> {
    const templateBytes = await fs.readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const [key, coords] of Object.entries(fieldsMap)) {
      const page = pages[coords.page];
      page.drawText(data[key] ?? "", {
        x: coords.x,
        y: coords.y,
        size: coords.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
```

> Si tu plantilla es más un **diseño gráfico** (con colores, íconos, layout tipo infografía) y no un PDF con texto fijo a rellenar, la alternativa mejor es armar la plantilla en HTML/CSS y usar **Puppeteer** para renderizarla a PDF — te lo puedo detallar aparte si es el caso.

### 5.4 Envío por WhatsApp (Meta Cloud API)

Requiere subir el PDF como media antes de enviarlo como documento:

```typescript
// infrastructure/external/whatsapp/MetaCloudApiProvider.ts
import axios from "axios";

export class MetaCloudApiProvider {
  constructor(
    private phoneNumberId: string,
    private accessToken: string,
  ) {}

  async sendPdfDocument(to: string, pdfBuffer: Buffer, filename: string) {
    // 1. Subir el media
    const form = new FormData();
    form.append(
      "file",
      new Blob([pdfBuffer], { type: "application/pdf" }),
      filename,
    );
    form.append("messaging_product", "whatsapp");

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v20.0/${this.phoneNumberId}/media`,
      form,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    const mediaId = uploadRes.data.id;

    // 2. Enviar el mensaje con el documento adjunto
    const sendRes = await axios.post(
      `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: { id: mediaId, filename },
      },
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    return sendRes.data.messages[0].id;
  }
}
```

**Requisito previo:** cuenta de WhatsApp Business API verificada en Meta for Developers, con el número de teléfono del gym registrado. Esto tiene un proceso de aprobación de Meta que conviene arrancar en paralelo al desarrollo, ya que puede demorar días.

### 5.5 Colas asíncronas (BullMQ)

Tanto la generación con IA como el envío por WhatsApp son operaciones lentas y potencialmente fallidas (rate limits, timeouts) — no deben bloquear el request HTTP:

```typescript
// infrastructure/queues/routineQueue.ts
import { Queue } from "bullmq";
import { redisConnection } from "../../config/redis";

export const routineQueue = new Queue("routine-generation", {
  connection: redisConnection,
});
export const whatsappQueue = new Queue("whatsapp-send", {
  connection: redisConnection,
});
```

```typescript
// infrastructure/queues/workers/routineWorker.ts
import { Worker } from "bullmq";
import { redisConnection } from "../../../config/redis";
import { whatsappQueue } from "../routineQueue";

export const routineWorker = new Worker(
  "routine-generation",
  async (job) => {
    const { routineId } = job.data;
    // 1. Generar contenido con IA (GenerateRoutineUseCase)
    // 2. Generar PDF con pdf-lib (GeneratePdfUseCase)
    // 3. Guardar pdfUrl, marcar estadoGeneracion = 'generado'
    // 4. Encolar en whatsappQueue para el envío
    await whatsappQueue.add("send-routine", { routineId });
  },
  { connection: redisConnection, concurrency: 3 },
);
```

Flujo completo: `POST /api/routines/generate/:clientId` → encola en `routineQueue` → responde `202 Accepted` inmediatamente → worker procesa en background → al terminar, encola en `whatsappQueue` → segundo worker envía el PDF.

---

## 6. Seguridad

- **Hashing de contraseñas:** bcrypt, salt rounds = 12.
- **JWT:** access token 15 min, refresh token 7 días en cookie `httpOnly`, `secure`, `sameSite: strict`.
- **Rate limiting:** `express-rate-limit` en `/api/auth/*` (prevenir fuerza bruta) y en `/api/onboarding/webhook` (prevenir spam).
- **Helmet:** headers de seguridad por defecto.
- **CORS:** whitelist estricta del origen del frontend (`CORS_ORIGIN` en `.env`).
- **Validación de entrada:** Zod en cada endpoint, antes de llegar al use case.
- **Aislamiento de tenant:** middleware `tenantMiddleware` obligatorio en todas las rutas de `gym`; ningún repositorio acepta queries sin `gymId`.
- **Secrets de terceros (IA, WhatsApp):** nunca en el documento de Mongo en texto plano — referencia a variable de entorno o secret manager.

---

## 7. Estructura de Carpetas (Scaffolding Completo)

```
gym-crm-backend/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── database.ts
│   │   └── redis.ts
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── User.ts
│   │   │   ├── Gym.ts
│   │   │   ├── Client.ts
│   │   │   └── Routine.ts
│   │   ├── repositories/
│   │   │   ├── IUserRepository.ts
│   │   │   ├── IGymRepository.ts
│   │   │   ├── IClientRepository.ts
│   │   │   ├── IRoutineRepository.ts
│   │   │   └── IInvoiceRepository.ts
│   │   └── services/
│   │       ├── IAIProvider.ts
│   │       ├── IWhatsappProvider.ts
│   │       ├── IPdfGenerator.ts
│   │       └── IFormsProvider.ts
│   ├── application/
│   │   └── use-cases/
│   │       ├── auth/
│   │       │   ├── LoginUseCase.ts
│   │       │   └── RefreshTokenUseCase.ts
│   │       ├── gym/
│   │       │   ├── CreateGymUseCase.ts
│   │       │   ├── UpdateGymUseCase.ts
│   │       │   ├── DeleteGymUseCase.ts
│   │       │   └── ListGymsUseCase.ts
│   │       ├── client/
│   │       │   ├── CreateClientUseCase.ts
│   │       │   ├── SearchClientsUseCase.ts
│   │       │   ├── RenewClientUseCase.ts
│   │       │   └── DeleteClientUseCase.ts
│   │       ├── onboarding/
│   │       │   └── ProcessFormSubmissionUseCase.ts
│   │       ├── routine/
│   │       │   ├── GenerateRoutineUseCase.ts
│   │       │   ├── GeneratePdfUseCase.ts
│   │       │   └── SendRoutineWhatsappUseCase.ts
│   │       └── dashboard/
│   │           └── GetGymDashboardUseCase.ts
│   ├── infrastructure/
│   │   ├── database/
│   │   │   └── mongoose/
│   │   │       ├── schemas/
│   │   │       │   ├── UserSchema.ts
│   │   │       │   ├── GymSchema.ts
│   │   │       │   ├── ClientSchema.ts
│   │   │       │   └── RoutineSchema.ts
│   │   │       └── repositories/
│   │   │           ├── MongoUserRepository.ts
│   │   │           ├── MongoGymRepository.ts
│   │   │           ├── MongoClientRepository.ts
│   │   │           └── MongoRoutineRepository.ts
│   │   ├── external/
│   │   │   ├── ai/
│   │   │   │   ├── OpenAIProvider.ts
│   │   │   │   └── AnthropicProvider.ts
│   │   │   ├── whatsapp/
│   │   │   │   └── MetaCloudApiProvider.ts
│   │   │   ├── pdf/
│   │   │   │   └── PdfLibGenerator.ts
│   │   │   └── forms/
│   │   │       └── GoogleFormsWebhookHandler.ts
│   │   └── queues/
│   │       ├── routineQueue.ts
│   │       ├── whatsappQueue.ts
│   │       └── workers/
│   │           ├── routineWorker.ts
│   │           └── whatsappWorker.ts
│   ├── interfaces/
│   │   └── http/
│   │       ├── controllers/
│   │       │   ├── AuthController.ts
│   │       │   ├── GymController.ts
│   │       │   ├── ClientController.ts
│   │       │   ├── OnboardingController.ts
│   │       │   ├── RoutineController.ts
│   │       │   └── DashboardController.ts
│   │       ├── routes/
│   │       │   ├── auth.routes.ts
│   │       │   ├── gym.routes.ts
│   │       │   ├── client.routes.ts
│   │       │   ├── onboarding.routes.ts
│   │       │   ├── routine.routes.ts
│   │       │   ├── dashboard.routes.ts
│   │       │   └── index.ts
│   │       ├── middlewares/
│   │       │   ├── authMiddleware.ts
│   │       │   ├── roleMiddleware.ts
│   │       │   ├── tenantMiddleware.ts
│   │       │   └── errorHandler.ts
│   │       └── validators/
│   │           ├── gym.validator.ts
│   │           └── client.validator.ts
│   ├── shared/
│   │   ├── errors/
│   │   │   └── AppError.ts
│   │   ├── utils/
│   │   └── constants/
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── unit/
│   └── integration/
├── storage/
│   └── templates/
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── vitest.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. Variables de Entorno (`.env.example`)

```bash
# Servidor
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:5173

# Base de datos
MONGO_URI=mongodb://localhost:27017/gym-crm

# Redis / Colas
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_ACCESS_SECRET=cambiar_por_secreto_seguro
JWT_REFRESH_SECRET=cambiar_por_otro_secreto_seguro
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# IA (se puede tener ambas configuradas y elegir por gym)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# WhatsApp Cloud API (Meta)
WHATSAPP_API_VERSION=v20.0
# Los tokens/phoneNumberId específicos de cada gym se resuelven vía tokenSecretRef,
# pero se puede tener un default para desarrollo/testing:
WHATSAPP_DEFAULT_PHONE_NUMBER_ID=
WHATSAPP_DEFAULT_ACCESS_TOKEN=

# Google Forms
GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET=

# Almacenamiento de PDFs / plantillas
PDF_TEMPLATE_STORAGE_PATH=./storage/templates
PDF_OUTPUT_STORAGE_PATH=./storage/generated

# Integración Arca (módulo ya existente — completar según tu implementación actual)
ARCA_API_BASE_URL=
ARCA_API_KEY=

# AFIP SDK (facturación electrónica)
AFIP_SDK_API_KEY=
```

---

## 9. Dependencias a Instalar

### Dependencias ya instaladas
El proyecto ya incluye todas las dependencias necesarias desde el package.json.
> Nota: El módulo Arca/Facturación se implementó usando AFIP SDK API REST, no requiere dependencias adicionales.

```bash
# Dependencias de producción
npm install express mongoose jsonwebtoken bcrypt zod dotenv cors helmet \
  express-rate-limit bullmq ioredis pdf-lib axios openai @anthropic-ai/sdk \
  multer pino pino-http cookie-parser

# Dependencias de desarrollo
npm install -D typescript ts-node ts-node-dev @types/node @types/express \
  @types/jsonwebtoken @types/bcrypt @types/cors @types/multer @types/cookie-parser \
  eslint prettier eslint-config-prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  vitest supertest @types/supertest mongodb-memory-server
```

**Nota:** si tu integración Arca ya usa alguna librería específica (SOAP client, certificados, etc.), agregala a esta lista — no la incluí porque el módulo ya está implementado de tu lado.

---

## 10. Scripts NPM (`package.json`)

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "worker:dev": "ts-node-dev --respawn --transpile-only src/infrastructure/queues/workers/index.ts",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write \"src/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

> Los workers de BullMQ corren como **proceso separado** del servidor HTTP (`worker:dev` / un `dist/worker.js` en producción), para que la generación de IA/PDF/WhatsApp no compita por recursos con las requests HTTP entrantes.

---

## 11. Docker Compose (entorno local)

```yaml
version: "3.8"
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  mongo_data:
```

---

## 12. Próximos Pasos Sugeridos

1. Confirmar si la plantilla de rutina es un **PDF con campos fijos** (pdf-lib) o un **diseño gráfico tipo infografía** (Puppeteer + HTML) — esto define el enfoque de la sección 5.3.
2. Iniciar el proceso de verificación de **WhatsApp Business API** en Meta for Developers (puede tardar días en aprobarse).
3. Definir si el borrado de clientes es soft-delete o físico (afecta `DeleteClientUseCase` y reportes históricos del dashboard).
4. Confirmar el contrato exacto (`IInvoiceRepository`) contra tu módulo de Arca ya implementado.
5. Decidir si además del webhook de Apps Script querés un fallback por polling para gyms que no puedan instalar el script en su cuenta de Google.
