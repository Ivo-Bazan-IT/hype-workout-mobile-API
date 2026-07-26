# API — gym-crm-backend

Documentación de todos los endpoints, agrupados por nivel de acceso.
Generada a partir del código real (`src/interfaces/http/`), no de un diseño previsto.

- **Base URL:** `http://localhost:4000` (configurable con `PORT`)
- **Prefijo de la API:** `/api` (excepto `/health`)
- **Endpoints documentados:** 44
- **Última actualización:** 2026-07-25

---

## Convenciones generales

### Autenticación

El token de acceso viaja en el header:

```
Authorization: Bearer <accessToken>
```

Dura 15 minutos (`JWT_ACCESS_EXPIRES_IN`). El **refresh token** viaja en una cookie
`httpOnly` llamada `refreshToken` (7 días) — el cliente no la manipula, solo hay que
enviar las peticiones con `credentials: 'include'`.

El JWT de acceso contiene `{ userId, email, role, gymId }`. El `gymId` del token es la
fuente de verdad del tenant: **nunca se toma del body**.

### Formato de respuesta

Éxito:

```json
{ "status": "success", "data": {} }
```

o, en operaciones sin cuerpo de retorno:

```json
{ "status": "success", "message": "..." }
```

Error:

```json
{ "status": "error", "message": "Client not found" }
```

### Códigos de estado

| Código | Cuándo                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | OK                                                                                                                                                                                           |
| `201`  | Recurso creado (`POST /api/clients`, `POST /api/admin/gyms`, `POST /api/admin/users`, webhook)                                                                                               |
| `400`  | Validación fallida. Los errores de Zod incluyen además un array `errors` con `{ path, message }` por campo. También cubre `_id` malformado (CastError de Mongoose) y **admin sin `?gymId=`** |
| `401`  | Token ausente, inválido o expirado; credenciales incorrectas; webhook secret inválido                                                                                                        |
| `403`  | Rol insuficiente (`requireAdmin`) o usuario `gym` sin `gymId` en el token                                                                                                                    |
| `404`  | Recurso inexistente **o perteneciente a otro tenant** (indistinguible a propósito)                                                                                                           |
| `409`  | Conflicto de unicidad (email, CUIT, o `documento` al actualizar un cliente)                                                                                                                  |
| `429`  | Rate limit superado, **incluido el del proveedor de IA**. Nada se rompió: el reintento tiene sentido                                                                                         |
| `500`  | Error inesperado **del backend**. Si aparece generando una rutina, es un bug nuestro, no del proveedor                                                                                       |
| `502`  | Un servicio externo (IA) falló por su cuenta: 5xx, timeout o conexión caída                                                                                                                  |

> **Errores del proveedor de IA.** `POST /api/routines/generate/:clientId` los traduce a un
> código honesto en vez de esconderlos en un `500`, y **propaga el mensaje del proveedor**
> para que se pueda actuar sin mirar el log del servidor:
>
> | Lo que pasó                          | Código | Qué hacer                                          |
> | ------------------------------------ | ------ | -------------------------------------------------- |
> | Cuota del modelo agotada             | `429`  | Reintentar, o cargar la API key propia del gym     |
> | API key rechazada por el proveedor   | `400`  | Corregirla en la configuración del gimnasio        |
> | Modelo inexistente o mal nombrado    | `400`  | Corregir `model` en la configuración               |
> | El proveedor se cayó o no respondió  | `502`  | Reintentar más tarde; no hay nada que configurar   |
>
> Una key rechazada da **`400` y no `401`** a propósito: un `401` se lee como "la sesión
> expiró" y mandaría al usuario al login, cuando su sesión está perfecta y lo que falla es
> una credencial del gimnasio.

> **Emails y caracteres no ASCII.** La validación de email de Zod rechaza acentos y `ñ` en
> la parte local: `dueño@gimnasio.com` devuelve `400`. Usar `dueno@gimnasio.com`.

### Roles y resolución del tenant

| Rol     | `gymId`        | Puede                                                                                                  |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `admin` | no tiene       | Gestionar gyms y usuarios dueños. Operar **cualquier** tenant —lectura y escritura— pasando `?gymId=`. |
| `gym`   | fijo en el JWT | Operar exclusivamente sobre su propio gym.                                                             |

**Una sola regla, aplicada por `tenantMiddleware` a todas las rutas de tenant**
(`/api/gyms`, `/api/clients`, `/api/routines`, `/api/invoices`, `/api/ai-usage`,
`GET /api/dashboard`):

- **Rol `gym`:** el tenant sale siempre del JWT. Mandar `?gymId=` de otro gym **no tiene
  efecto**: se ignora y se usa el propio. No hay forma de operar otro tenant.
- **Rol `admin`:** el tenant sale de `?gymId=`. **Sin ese parámetro responde `400`**
  (`gymId query parameter is required for admin users`), porque el super-admin no tiene
  gym propio y adivinar uno sería peor que fallar.

> **Cambio respecto de versiones anteriores.** Antes el admin podía _leer_ cualquier gym
> pero recibía `403` en toda escritura (crear clientes, renovar, generar rutinas), porque
> los handlers de escritura resolvían el tenant con `if (!user?.gymId) → 403` y un token de
> admin no lleva `gymId`. Esa asimetría era accidental, no una decisión: **hoy el admin
> escribe igual que lee, siempre con `?gymId=` explícito.**

La única excepción es `GET /api/dashboard/summary`, que es deliberadamente cross-gym y por
eso **no** lleva `tenantMiddleware` ni exige `?gymId=`.

---

# 1. Endpoints públicos (sin autenticación)

Se montan **antes** del middleware de autenticación, así que no requieren token.

## `GET /health`

Health check del servicio.

**Necesita:** nada.

```json
{ "status": "ok", "timestamp": "2026-07-25T12:00:00.000Z" }
```

---

## `POST /api/auth/login`

Inicia sesión y devuelve el access token. Sirve tanto para el super-admin como para los
dueños de gym: el rol y el `gymId` salen del usuario en base de datos.

**Necesita:** un usuario existente y **activo** (`isActive: true`). El super-admin se crea
por script (§7); los dueños de gym, con `POST /api/admin/gyms`.

**Rate limit:** 5 intentos por IP cada 15 minutos → `429`.

**Body**

| Campo      | Tipo   | Requerido | Reglas               |
| ---------- | ------ | --------- | -------------------- |
| `email`    | string | sí        | formato email válido |
| `password` | string | sí        | mínimo 1 carácter    |

```json
{ "email": "dueno@gimnasio.com", "password": "miPassword123" }
```

**Respuesta `200`** — además setea la cookie `refreshToken` (httpOnly, 7 días).

```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "66a1...",
      "email": "dueno@gimnasio.com",
      "name": "Dueño",
      "role": "gym",
      "gymId": "66a0..."
    }
  }
}
```

**Errores:** `401` credenciales inválidas o cuenta desactivada.

---

## `POST /api/auth/refresh`

Renueva el access token.

**Necesita:** la cookie `refreshToken` vigente, enviada automáticamente por el navegador
(requiere `credentials: 'include'`). **No lleva body.**

**Respuesta `200`**

```json
{ "status": "success", "data": { "accessToken": "eyJhbGciOi..." } }
```

**Errores:** `401` si no hay cookie, si el token expiró, o si el usuario fue desactivado.

---

## `POST /api/auth/logout`

Borra la cookie `refreshToken`.

**Necesita:** nada (sin body ni parámetros).

> Los JWT son stateless: el access token que ya emitiste **sigue siendo válido hasta que
> expire** (15 min). No hay revocación server-side.

---

## `POST /api/onboarding/webhook`

Punto de entrada de las respuestas de Google Forms. Crea el cliente en el gym o, si ya
existe (mismo `documento` dentro del mismo gym), **fusiona** las respuestas nuevas sobre
las previas y refresca sus datos de contacto.

Es el productor de `encuestaData`, el insumo obligatorio para generar rutinas.

**Necesita:**

- Header `x-webhook-secret` válido.
- Un gym **existente y activo** (`isActive: true`); si no, `400`.
- Que el gym tenga `googleFormConfig.webhookSecret` configurado, **o** que exista
  `GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET` en el entorno. Sin ninguno de los dos, todo
  request se rechaza con `401`.

**Rate limit:** 100 requests por IP cada 15 minutos.

**Body**

| Campo        | Tipo   | Requerido | Descripción                              |
| ------------ | ------ | --------- | ---------------------------------------- |
| `gymId`      | string | sí        | Tenant destino                           |
| `respuestas` | object | sí        | JSON crudo del formulario, claves libres |

De `respuestas` se extraen por coincidencia difusa de clave (case-insensitive, admite
variantes de idioma) tres campos **obligatorios** y uno opcional:

| Campo del cliente         | Claves que reconoce                    |
| ------------------------- | -------------------------------------- |
| `nombre` (obligatorio)    | `nombre`, `Nombre`, `name`             |
| `documento` (obligatorio) | `dni`, `DNI`, `documento`, `Documento` |
| `telefono` (obligatorio)  | `telefono`, `Teléfono`, `phone`        |
| `email` (opcional)        | `email`, `Email`, `correo`             |

El objeto completo se guarda además tal cual en `encuestaData`.

```json
{
  "gymId": "66a0...",
  "respuestas": {
    "Nombre completo": "Iván Bazán",
    "DNI": "40123456",
    "Teléfono": "5491122334455",
    "Email": "ivan@example.com",
    "¿Cuál es tu objetivo?": ["Ganar masa muscular"],
    "¿Cuántos días podés entrenar?": "4"
  }
}
```

**Respuesta `201`**

```json
{
  "status": "success",
  "data": {
    "clientId": "66b1...",
    "nombre": "Iván Bazán",
    "estado": "pendiente"
  }
}
```

**Errores:** `401` sin header o secret inválido · `400` si falta alguno de los tres
campos obligatorios o si el gym está inactivo.

---

## `GET /api/onboarding/status`

Devuelve un heartbeat del webhook.

**Necesita:** nada.

```json
{
  "status": "success",
  "data": {
    "lastSync": "2026-07-25T12:00:00.000Z",
    "message": "Webhook endpoint active"
  }
}
```

> El comentario en el código dice que requiere auth, pero está montado en el bloque
> público: **hoy es accesible sin token**.

---

# 2. Endpoint autenticado (cualquier rol)

## `GET /api/auth/me`

Devuelve la identidad del token actual. Útil para rehidratar la sesión en el frontend.

**Necesita:** `Authorization: Bearer <token>`. Sin parámetros.

```json
{
  "status": "success",
  "data": { "email": "dueno@gimnasio.com", "role": "gym", "gymId": "66a0..." }
}
```

**Errores:** `401` sin token o token inválido.

---

# 3. Super-admin — `/api/admin/*`

Todos requieren `Authorization: Bearer <token>` **con rol `admin`**. Cualquier otro rol
recibe `403 Admin access required`.

Estos endpoints gestionan **cuentas**, no datos de tenant, así que **no** usan
`tenantMiddleware` y **no** necesitan `?gymId=`.

## 3.1 Gestión de gimnasios (tenants)

### `GET /api/admin/gyms`

Lista todos los gyms **activos**.

**Necesita:** token de admin. Sin parámetros.

```json
{
  "status": "success",
  "data": [
    {
      "id": "66a0...",
      "name": "Hype Workout",
      "businessName": "Hype SRL",
      "cuit": "30712345678",
      "contactEmail": "info@hype.com",
      "contactPhone": "5491122334455"
    }
  ]
}
```

### `POST /api/admin/gyms`

**Da de alta un tenant completo:** crea el gym **y su primer usuario dueño** en la misma
operación. Es la vía de creación de cuentas de tipo `gym` (ver §7).

**Necesita:** token de admin, un `cuit` no usado por otro gym y un `adminEmail` no usado
por otro usuario.

**Body**

| Campo                   | Tipo                                  | Requerido | Reglas                                               |
| ----------------------- | ------------------------------------- | --------- | ---------------------------------------------------- |
| `name`                  | string                                | sí        | mín. 1 carácter                                      |
| `businessName`          | string                                | sí        | mín. 1 carácter                                      |
| `cuit`                  | string                                | sí        | mín. 11 caracteres, **único**                        |
| `contactEmail`          | string                                | sí        | email válido                                         |
| `contactPhone`          | string                                | sí        | mín. 10 caracteres                                   |
| `adminEmail`            | string                                | sí        | email válido, **único** entre usuarios               |
| `adminPassword`         | string                                | sí        | mín. 6 caracteres (se hashea con bcrypt cost 12)     |
| `adminName`             | string                                | sí        | mín. 1 carácter                                      |
| `aiProvider`            | `deepseek` \| `openai` \| `anthropic` | no        | Proveedor de IA inicial (default `deepseek`)         |
| `whatsappPhoneNumberId` | string                                | no        | Phone Number ID de Meta. Se puede dejar para después |

Config por defecto del gym nuevo: `aiConfig.provider = 'deepseek'`,
`aiConfig.promptTemplate = '{{respuestas_encuesta}}'`, `whatsappConfig.tokenSecretRef =
'whatsapp-{cuit}'`. Se ajusta después desde `/api/gyms/settings/*`.

**Respuesta `201`**

```json
{
  "status": "success",
  "data": {
    "gym": {
      "id": "66a0...",
      "name": "Hype Workout",
      "businessName": "Hype SRL",
      "cuit": "30712345678"
    },
    "user": { "id": "66a1...", "email": "dueno@hype.com", "name": "Dueño" }
  }
}
```

**Errores:** `409` CUIT o email ya existentes · `400` validación.

### `GET /api/admin/gyms/:id`

⚠️ **Placeholder.** Hoy devuelve `{ "id": "<id>" }` sin consultar la base.
Para leer la configuración real de un gym, usar `GET /api/gyms/settings?gymId=<id>`.

### `PUT /api/admin/gyms/:id`

Actualiza un gym. Todos los campos son **opcionales**; se aplican solo los enviados.

**Necesita:** token de admin y un gym existente.

| Campo              | Tipo   | Reglas                                                                  |
| ------------------ | ------ | ----------------------------------------------------------------------- |
| `name`             | string | mín. 1                                                                  |
| `businessName`     | string | mín. 1                                                                  |
| `cuit`             | string | mín. 11                                                                 |
| `contactEmail`     | string | email válido                                                            |
| `contactPhone`     | string | mín. 10                                                                 |
| `aiConfig`         | object | `{ provider, promptTemplate, model? }` — **reemplaza el objeto entero** |
| `whatsappConfig`   | object | `{ phoneNumberId, tokenSecretRef }` — reemplaza el objeto entero        |
| `pdfTemplate`      | object | `{ htmlTemplate?, cssStyles?, storagePath? }` — ver 4.1.1               |
| `googleFormConfig` | object | `{ formId?, webhookSecret? }`                                           |

> ⚠️ **Cuidado con `aiConfig` y `whatsappConfig` acá:** reemplazan el objeto completo, y eso
> **borra las credenciales cifradas del gym** (`encryptedApiKey`, `encryptedAccessToken`),
> que no son parte del body. Para cambios parciales que las preserven, usar los endpoints
> de `/api/gyms/settings/*`, que hacen merge.

**Errores:** `404` gym inexistente.

### `DELETE /api/admin/gyms/:id`

**Soft delete:** marca `isActive = false`. El gym deja de aparecer en el listado y sus
webhooks de onboarding pasan a rechazarse.

**Necesita:** token de admin y un gym existente.

> ⚠️ **No desactiva a los usuarios del gym**: sus dueños siguen pudiendo iniciar sesión.
> Para cortarles el acceso hay que desactivarlos con `DELETE /api/admin/users/:id`.

---

## 3.2 Gestión de usuarios dueños de gym

Estos endpoints operan **solo sobre usuarios con rol `gym`**. Intentar modificar,
desactivar o resetear la contraseña de un usuario `admin` devuelve `403`, para que el
super-admin no pueda bloquearse a sí mismo ni dejar la plataforma sin dueño.
El **rol nunca es modificable** por API.

### `GET /api/admin/users`

Lista usuarios con paginación y filtros.

**Necesita:** token de admin.

**Query params** — todos opcionales:

| Param      | Tipo                  | Default | Descripción                                            |
| ---------- | --------------------- | ------- | ------------------------------------------------------ |
| `q`        | string                | —       | Busca parcial (case-insensitive) en nombre **o** email |
| `role`     | `admin` \| `gym`      | —       | Filtra por rol                                         |
| `gymId`    | string                | —       | Usuarios de un gym concreto                            |
| `isActive` | `"true"` \| `"false"` | —       | Filtra por estado                                      |
| `page`     | string numérico       | `"1"`   | Página                                                 |
| `limit`    | string numérico       | `"20"`  | Tamaño de página                                       |

**Respuesta `200`** — `passwordHash` nunca se expone.

```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": "66a1...",
        "email": "dueno@hype.com",
        "name": "Dueño",
        "role": "gym",
        "gymId": "66a0...",
        "isActive": true,
        "createdAt": "2026-07-01T10:00:00.000Z",
        "updatedAt": "2026-07-20T18:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### `GET /api/admin/users/search`

Alias explícito del listado. Mismos query params, misma respuesta, misma implementación.

**Necesita:** token de admin.

### `GET /api/admin/users/:id`

Devuelve un usuario.

**Necesita:** token de admin y un usuario existente. **Errores:** `404`.

### `POST /api/admin/users`

Crea un usuario dueño adicional para un gym existente. El rol se fuerza a `gym`.

**Necesita:** token de admin, un `gymId` de un gym **existente** y un email libre.

| Campo      | Tipo   | Requerido | Reglas                             |
| ---------- | ------ | --------- | ---------------------------------- |
| `email`    | string | sí        | email válido, **único**            |
| `password` | string | sí        | mín. 6 caracteres (bcrypt cost 12) |
| `name`     | string | sí        | mín. 1 carácter                    |
| `gymId`    | string | sí        | El gym debe existir                |

**Respuesta `201`:** el usuario creado (sin `passwordHash`).

**Errores:** `404` gym inexistente · `409` email ya usado · `400` validación.

### `PUT /api/admin/users/:id`

Edita un usuario. Todos los campos son opcionales, pero hay que enviar al menos uno.

**Necesita:** token de admin y un usuario **de rol `gym`** existente.

| Campo      | Tipo    | Reglas                                       |
| ---------- | ------- | -------------------------------------------- |
| `email`    | string  | email válido, único                          |
| `name`     | string  | mín. 1 carácter                              |
| `isActive` | boolean | `false` bloquea el login inmediatamente      |
| `gymId`    | string  | Reasigna el usuario a otro gym; debe existir |

**Errores:** `404` usuario o gym inexistente · `409` email tomado · `403` si el target es `admin`.

### `DELETE /api/admin/users/:id`

**Soft delete:** marca `isActive = false`. El usuario deja de poder iniciar sesión.
Se reactiva con `PUT .../:id` e `isActive: true`.

**Necesita:** token de admin y un usuario de rol `gym`.

**Errores:** `404` · `403` si el target es `admin`.

### `PUT /api/admin/users/:id/password`

Resetea la contraseña sin pedir la anterior (el actor es el super-admin, no el dueño).

**Necesita:** token de admin y un usuario de rol `gym`.

| Campo      | Tipo   | Requerido | Reglas            |
| ---------- | ------ | --------- | ----------------- |
| `password` | string | sí        | mín. 6 caracteres |

**Errores:** `404` · `403` si el target es `admin`.

---

# 4. Tenant — rol `gym`, o `admin` con `?gymId=`

Todos requieren `Authorization: Bearer <token>` y pasan por `tenantMiddleware`.
El `gymId` **nunca se envía en el body**: sale del token (rol `gym`) o de `?gymId=`
(rol `admin`, obligatorio).

Para no repetirlo en cada endpoint: **todos aceptan `?gymId=` y todos responden `400` si
el que llama es admin y lo omite.**

## 4.1 Configuración del gimnasio — `/api/gyms`

### `GET /api/gyms/settings`

Devuelve la configuración del gym.

**Necesita:** token con tenant resoluble y un gym existente.

La respuesta usa un **allowlist**: nunca expone `whatsappConfig.tokenSecretRef`,
`googleFormConfig.webhookSecret` ni ninguna credencial cifrada
(`aiConfig.encryptedApiKey`, `whatsappConfig.encryptedAccessToken`,
`afipConfig.encryptedApiKey`). En su lugar informa **booleanos** `hasApiKey` /
`hasAccessToken`, para que el front pueda mostrar "configurado ✓" sin ver el secreto.

```json
{
  "status": "success",
  "data": {
    "id": "66a0...",
    "name": "Hype Workout",
    "businessName": "Hype SRL",
    "cuit": "30712345678",
    "contactEmail": "info@hype.com",
    "contactPhone": "5491122334455",
    "isActive": true,
    "aiConfig": {
      "provider": "deepseek",
      "promptTemplate": "Sos el entrenador personal de {{gym_nombre}}...",
      "usaPromptStandard": true,
      "model": "deepseek-chat",
      "hasApiKey": true
    },
    "pdfTemplate": {},
    "whatsappConfig": { "phoneNumberId": "1234567890", "hasAccessToken": true },
    "whatsappPhoneNumberId": "1234567890",
    "googleFormConfig": { "formId": "1FAIpQL..." },
    "afipConfig": {
      "puntoVenta": 1,
      "taxCondition": "MONOTRIBUTO",
      "isActive": true
    },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

> Dos detalles de la forma de la respuesta:
>
> - `whatsappPhoneNumberId` (campo plano, en la raíz) se mantiene por compatibilidad con
>   el front actual; duplica `whatsappConfig.phoneNumberId`.
> - Si el gym **no** fijó un `model`, la clave `aiConfig.model` viene **ausente** (no
>   `null`): significa que se usa el modelo por defecto del proveedor, listado más abajo.
> - `aiConfig.promptTemplate` es el prompt **efectivo**, no el campo crudo de la base: si
>   el gym nunca escribió el suyo, devuelve el **prompt standard de la plataforma** y
>   `usaPromptStandard: true`. Así la pantalla de configuración arranca con un prompt
>   funcional ya cargado para editar, en vez de un textarea vacío. Cuando el dueño guarda
>   el suyo, `usaPromptStandard` pasa a `false`.

### `PUT /api/gyms/settings/ai-prompt`

Configura la IA del tenant: **el endpoint donde cada dueño describe su gimnasio**
(equipamiento, espacios, restricciones, tono) y carga su propia API key.

Hace **merge** sobre la configuración existente, así que enviar solo `promptTemplate`
conserva `provider`, `model` y la API key ya cargada.

> **El prompt controla el CONTENIDO, no el formato.** La estructura JSON que devuelve el
> modelo la fija la plataforma en una instrucción de sistema que el gym no edita
> (`domain/prompt/promptStandard.ts`), porque es el contrato que el renderer del PDF tiene
> que poder maquetar. Por eso un dueño puede reescribir su prompt entero sin riesgo de
> romper el PDF: no es él quien define la forma de la respuesta.
>
> Si el gym nunca guarda un `promptTemplate`, se usa el **prompt standard**: da pautas de
> entrenador (respetar lesiones declaradas, ajustar los días a la disponibilidad, adecuar
> volumen al nivel, escribir en español rioplatense) y genera rutinas usables sin
> configurar nada.

**Necesita:** un gym existente. Para cargar `apiKey`, además `APP_MASTER_KEY` en el
entorno (sin ella el cifrado falla con `500`).

**Body** — todos opcionales, pero **al menos uno es obligatorio**:

| Campo            | Tipo                                  | Reglas                                                                                                 |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `promptTemplate` | string                                | Texto libre + placeholders. Ver reglas abajo                                                           |
| `provider`       | `deepseek` \| `openai` \| `anthropic` | Proveedor de IA de este gym                                                                            |
| `model`          | string                                | Modelo concreto. Si se omite, el adaptador usa su default                                              |
| `apiKey`         | string                                | **API key propia del gym (BYOK).** Se cifra con AES-256-GCM antes de persistir y **nunca se devuelve** |

Modelos por defecto de cada proveedor (se sobrescriben con `model`):

| `provider`  | Modelo por defecto           | Fallback de plataforma si el gym no cargó su key |
| ----------- | ---------------------------- | ------------------------------------------------ |
| `deepseek`  | `deepseek-chat`              | `DEEPSEEK_API_KEY`                               |
| `openai`    | `gpt-4o-mini`                | `OPENAI_API_KEY`                                 |
| `anthropic` | `claude-3-7-sonnet-20250219` | `ANTHROPIC_API_KEY`                              |

> Si tampoco existe la variable de entorno del `provider` elegido, la generación **no
> falla**: se degrada a `deepseek`. Ver el tercer escalón en §6.
>
> El modelo por defecto de `deepseek` sale de `DEEPSEEK_DEFAULT_MODEL` y **va de la mano
> de `DEEPSEEK_BASE_URL`**: si se apunta a otro gateway compatible con la API de OpenAI
> (OpenRouter, por ejemplo), los IDs de modelo se nombran distinto y `deepseek-chat` a
> secas se rechaza con `400`. Definir uno sin el otro deja una config que falla recién al
> generar una rutina; la app avisa al arrancar si detecta ese caso.

> `deepseek` usa una API **compatible con OpenAI** apuntada a otro host
> (`DEEPSEEK_BASE_URL`, default `https://api.deepseek.com/v1`). No es un `model` del
> proveedor `openai`: pedir `deepseek-chat` con `provider: "openai"` falla, porque la
> petición va a `api.openai.com`.

#### Placeholders disponibles

Se escriben `{{nombre}}` (admiten espacios internos: `{{ nombre }}`) y se reemplazan
**todas** las apariciones al generar la rutina.

| Placeholder                     | Se reemplaza por                            |
| ------------------------------- | ------------------------------------------- |
| `{{respuestas_encuesta}}`       | JSON completo de `encuestaData` del cliente |
| `{{cliente_nombre}}`            | Nombre del cliente                          |
| `{{cliente_documento}}`         | Documento / DNI                             |
| `{{cliente_email}}`             | Email, o `no informado`                     |
| `{{cliente_telefono}}`          | Teléfono, o `no informado`                  |
| `{{cliente_fecha_inicio}}`      | Inicio de la membresía (formato es-AR)      |
| `{{cliente_fecha_vencimiento}}` | Vencimiento de la membresía                 |
| `{{gym_nombre}}`                | Nombre del gimnasio                         |
| `{{fecha_actual}}`              | Fecha del día de la generación              |

#### Reglas de validación del template

Se rechaza con `400`:

1. **Un template sin ningún placeholder.** Sin ellos, el modelo recibiría un prompt sin
   datos del cliente y devolvería una rutina genérica **sin que nadie se enterara**. El
   error se produce al guardar, no al generar.
2. **Un placeholder desconocido** (típicamente un typo, como `{{maquinaria}}`). Se
   enviaría literal al modelo en vez de reemplazarse. El mensaje de error lista los
   nombres válidos.

Ejemplo real, describiendo el equipamiento del gimnasio:

```json
{
  "promptTemplate": "Sos el entrenador de {{gym_nombre}}. EQUIPAMIENTO DISPONIBLE: 4 racks de sentadilla, 2 prensas 45°, poleas alta y baja, mancuernas de 2 a 40kg, 3 cintas, 2 bicicletas. ESPACIOS: sala de musculación 200m², zona funcional 80m². NO tenemos piscina ni máquina de remo. Diseñá la rutina de {{cliente_nombre}} usando SOLO ese equipamiento, vigente hasta {{cliente_fecha_vencimiento}}. Datos del cliente: {{respuestas_encuesta}}"
}
```

**Respuesta `200`** — proyección segura, sin el ciphertext:

```json
{
  "status": "success",
  "data": {
    "aiConfig": {
      "provider": "deepseek",
      "promptTemplate": "...",
      "model": "deepseek-chat",
      "hasApiKey": true
    }
  }
}
```

**Errores:** `400` body vacío, o template sin placeholders / con placeholders
desconocidos · `404` gym inexistente.

> El prompt **ya renderizado** (con los datos reales inyectados) se guarda en la rutina
> generada, en el campo `promptUsado`. Sirve para auditar exactamente qué recibió el
> modelo cuando una rutina sale rara.

### `PUT /api/gyms/settings/whatsapp`

Configura el WhatsApp propio del gym (Meta Cloud API), para que el PDF de la rutina salga
**desde el número del gimnasio** y no desde uno compartido. Hace **merge**: se puede
cambiar el número sin re-enviar el token, y viceversa.

**Necesita:** un gym existente y `APP_MASTER_KEY` para cifrar el token.

**Body** — todos opcionales, pero **al menos uno es obligatorio**:

| Campo           | Tipo   | Reglas                                                                 |
| --------------- | ------ | ---------------------------------------------------------------------- |
| `phoneNumberId` | string | Phone Number ID de Meta. mín. 1 carácter                               |
| `accessToken`   | string | Access token de Meta. Se cifra con AES-256-GCM y **nunca se devuelve** |

**Respuesta `200`**

```json
{
  "status": "success",
  "data": {
    "whatsappConfig": { "phoneNumberId": "1234567890", "hasAccessToken": true }
  }
}
```

> **Para que el envío funcione hacen falta las tres cosas:** `phoneNumberId`,
> `accessToken` y que el cliente tenga `telefono`. Si falta alguna, la rutina se genera
> igual pero queda con `estadoEnvio: 'pendiente'` (ver §4.3).

**Errores:** `400` body vacío · `404` gym inexistente.

### `PUT /api/gyms/settings/afip`

Configura la facturación electrónica. La `apiKey` se guarda **cifrada** y nunca se devuelve.

**Necesita:** un gym existente y `APP_MASTER_KEY`. Para que la renovación llegue a
facturar, además `isActive: true` y un `cuit` numérico válido en el gym.

**Body** — todos opcionales:

| Campo          | Tipo                                                 | Reglas                                           |
| -------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `apiKey`       | string                                               | mín. 1. Se cifra antes de persistir              |
| `puntoVenta`   | number                                               | entero positivo                                  |
| `taxCondition` | `MONOTRIBUTO` \| `RESPONSABLE_INSCRIPTO` \| `EXENTO` | Determina el tipo de comprobante                 |
| `isActive`     | boolean                                              | Si es `false`, la renovación no intenta facturar |

**Respuesta `200`:** solo los campos AFIP no sensibles.

### 4.1.1 Plantilla del PDF de la rutina

**No hay endpoint todavía.** Se documenta acá porque el modelo de datos ya lo contempla y
`GET /api/gyms/settings` devuelve `pdfTemplate`.

El PDF se arma en **dos capas**:

```
fondo  (PDF diseñado, con el arte)  +  contenido  (HTML renderizado encima)
```

Se eligió HTML y no estampar texto en coordenadas fijas sobre el fondo porque una rutina
es de **largo variable** —3 días o 6, 4 ejercicios o 12— y con posiciones absolutas el
contenido se desborda de la página apenas el socio tiene un plan más largo.

**Hoy todos los gyms usan la plantilla standard de la plataforma**, versionada en el repo
bajo `PDF_TEMPLATE_STORAGE_PATH` (default `./storage/templates`):

| Archivo                | Rol                        | Si falta                                       |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| `rutina-standard.html` | contenido + estilos        | error: sin esto no hay PDF                     |
| `rutina-standard.pdf`  | arte de fondo (**opcional**) | la rutina se genera igual, sin diseño |

Que el fondo sea opcional es deliberado: perder el arte es molesto, perder la rutina del
socio por un archivo ausente sería mucho peor.

**Placeholders de la plantilla** (distintos de los del prompt): `{{clienteNombre}}`,
`{{gymNombre}}`, `{{fechaGeneracion}}`, `{{fechaVencimiento}}` y `{{rutina}}`, este último
obligatorio. `{{rutina}}` se reemplaza por el HTML maquetado a partir del JSON del modelo.

**Márgenes:** el área segura va en `@page` dentro de la plantilla, **no** como `padding`
del `body`. El padding del body se aplica una sola vez al flujo entero, así que la primera
hoja queda bien y de la segunda en adelante el texto arranca en el borde, encima del
encabezado del arte. Las variables CSS no funcionan dentro de `@page`: los valores van
literales.

**Campos de `pdfTemplate` en el gym:**

| Campo          | Estado                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| `htmlTemplate` | HTML propio del gym. Si está, reemplaza al standard                     |
| `cssStyles`    | CSS extra, se inyecta como `<style>`                                    |
| `storagePath`  | **Reservado.** Ruta a un fondo propio; sin endpoint de subida todavía   |

La lógica de resolución (`resolverPlantillaPdf`) ya contempla los tres casos, así que
sumar la subida no exige rehacerla. Mientras tanto, un gym con `htmlTemplate` propio se
estampa igual sobre el **fondo standard**.

> **Tope de tamaño: 200 KB.** El HTML se guarda como string en el documento del gym (igual
> que `aiConfig.promptTemplate`) y un documento de Mongo no puede pasar los 16 MB. Lo que
> no entra son imágenes embebidas en base64: **el logo va por URL**.

---

## 4.2 Clientes — `/api/clients`

CRUD principal del tenant. Todas las consultas se filtran por `gymId`: un cliente de otro
gym devuelve `404`, no `403`.

### `GET /api/clients`

Lista clientes paginados.

**Necesita:** tenant resoluble.

| Query param | Tipo                                  | Default | Descripción                                      |
| ----------- | ------------------------------------- | ------- | ------------------------------------------------ |
| `query`     | string                                | —       | Busca por nombre (parcial) o documento (prefijo) |
| `estado`    | `activo` \| `inactivo` \| `pendiente` | —       | Filtra por estado                                |
| `page`      | número                                | `1`     | Página                                           |
| `limit`     | número                                | `20`    | Tamaño de página                                 |

```json
{
  "status": "success",
  "data": {
    "data": [{ "id": "...", "nombre": "...", "encuestaData": {} }],
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

### `GET /api/clients/search`

Igual que el anterior pero con validación estricta de los query params. **Ojo:** acá el
texto de búsqueda es `q`, no `query`.

**Necesita:** tenant resoluble.

| Query param | Tipo                                  | Default |
| ----------- | ------------------------------------- | ------- |
| `q`         | string                                | —       |
| `estado`    | `activo` \| `inactivo` \| `pendiente` | —       |
| `page`      | string numérico                       | `"1"`   |
| `limit`     | string numérico                       | `"20"`  |

### `GET /api/clients/expiring`

Clientes cuya membresía vence **exactamente** dentro de `days` días (es ese día
calendario, no un rango acumulado). Sirve para disparar recordatorios.

**Necesita:** tenant resoluble.

| Query param | Tipo   | Default |
| ----------- | ------ | ------- |
| `days`      | número | `7`     |

Excluye a los clientes en estado `inactivo`.

### `GET /api/clients/:id`

Devuelve un cliente completo, incluido `encuestaData`.

**Necesita:** tenant resoluble y que el cliente pertenezca a ese gym. **Errores:** `404`.

### `POST /api/clients`

Alta manual de cliente (la automática llega por el webhook de onboarding).
**Solo `nombre` y `documento` son obligatorios**: el resto se completa después con
`PATCH /api/clients/:id/encuesta`. El cliente se crea en estado `activo`.

**Necesita:** tenant resoluble y un `documento` no usado dentro de ese gym.

| Campo              | Tipo           | Requerido | Reglas                                    |
| ------------------ | -------------- | --------- | ----------------------------------------- |
| `nombre`           | string         | **sí**    | mín. 1 carácter                           |
| `documento`        | string         | **sí**    | mín. 1 carácter, **único dentro del gym** |
| `telefono`         | string         | no        | mín. 10 caracteres                        |
| `email`            | string         | no        | email válido                              |
| `fechaInicio`      | string \| Date | no        | Fecha ISO, con o sin hora. Default: hoy   |
| `fechaVencimiento` | string \| Date | no        | Default: `fechaInicio` + 30 días          |
| `encuestaData`     | object         | no        | Respuestas de la encuesta; claves libres  |

Alta mínima:

```json
{ "nombre": "Iván Bazán", "documento": "40123456" }
```

**Respuesta `201`:** el cliente creado, con las fechas ya resueltas.
**Errores:** `400` validación **o documento duplicado en el gym**.

### `PATCH /api/clients/:id/encuesta`

Completa la encuesta de un cliente ya creado. **Fusiona** las respuestas nuevas sobre las
ya cargadas, así que la ficha se puede completar en varias tandas sin perder lo anterior
(a diferencia de `PUT /api/clients/:id`, que reemplaza el objeto entero).

Los datos de contacto que llegan en la encuesta se promueven a campos propios del
cliente, porque el resto del sistema los lee desde ahí: el envío de la rutina por
WhatsApp usa `client.telefono`, no `encuestaData`.

**Necesita:** tenant resoluble, un cliente de ese gym, y `encuestaData` no vacío.

| Campo          | Tipo   | Requerido | Reglas                                             |
| -------------- | ------ | --------- | -------------------------------------------------- |
| `encuestaData` | object | **sí**    | Claves libres. No puede estar vacío                |
| `telefono`     | string | no        | mín. 10 caracteres. Actualiza el campo del cliente |
| `email`        | string | no        | email válido. Actualiza el campo del cliente       |

```json
{
  "telefono": "5491122334455",
  "email": "ivan@example.com",
  "encuestaData": {
    "objetivo": "Ganar masa muscular",
    "entrenamientos_por_semana": 4,
    "lesiones": "Hombro derecho",
    "experiencia": "2 años"
  }
}
```

**Respuesta `200`:** el cliente completo, con `encuestaData` ya fusionada.

**Errores:** `400` `encuestaData` vacío o inválido · `404` cliente inexistente **o de otro
gym**.

> Las claves de `encuestaData` son libres y **nada valida que la encuesta esté completa**.
> Lo que cargues es literalmente lo que recibe el modelo de IA al generar la rutina.

### `PUT /api/clients/:id`

Actualiza un cliente. Todos los campos opcionales.

**Necesita:** tenant resoluble y un cliente de ese gym.

| Campo              | Tipo                                  | Reglas                                                                                                                 |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `nombre`           | string                                | mín. 1                                                                                                                 |
| `documento`        | string                                | mín. 1. Si cambia, debe seguir siendo único en el gym                                                                  |
| `telefono`         | string                                | mín. 10                                                                                                                |
| `email`            | string                                | email válido                                                                                                           |
| `estado`           | `activo` \| `inactivo` \| `pendiente` |                                                                                                                        |
| `fechaVencimiento` | string \| Date                        | Fecha ISO, con o sin hora                                                                                              |
| `encuestaData`     | object                                | **Reemplaza** el objeto entero. Para agregar respuestas sin perder las previas, usar `PATCH /api/clients/:id/encuesta` |

**Errores:** `404` cliente inexistente · `409` el nuevo `documento` ya existe en el gym.

### `DELETE /api/clients/:id`

**Soft delete:** pasa el cliente a `estado: 'inactivo'`.

**Necesita:** tenant resoluble y un cliente de ese gym. **Errores:** `404`.

### `POST /api/clients/:id/renew`

Renueva la membresía y, si el gym tiene AFIP activo, **emite la factura**.

Efectos: agrega la renovación al `historialRenovaciones`, marca `esRecurrente = true` a
partir de la segunda, pasa el estado a `activo` y extiende `fechaVencimiento`
**30 días desde hoy** (el plazo lo calcula el servidor; no se puede enviar una fecha).

**Necesita:** tenant resoluble y un cliente de ese gym. Para que además facture:
`afipConfig.isActive = true`, una API key de AFIP (propia del gym o `AFIP_SDK_API_KEY`),
y un `cuit` parseable a número.

| Campo   | Tipo   | Requerido | Reglas   |
| ------- | ------ | --------- | -------- |
| `monto` | number | sí        | positivo |

> **Facturación best-effort:** si AFIP falla, la renovación **igual se aplica** y queda
> una `Invoice` en estado `error` con el detalle, consultable en `/api/invoices`.
> La respuesta sigue siendo `200`. El tipo de comprobante depende de `taxCondition`:
> `MONOTRIBUTO` → Factura C, resto → Factura B.

**Respuesta `200`:** el cliente actualizado.
**Errores:** `404` cliente inexistente · `400` monto no positivo.

---

## 4.3 Rutinas — `/api/routines`

### `POST /api/routines/generate/:clientId`

**Flujo central del sistema.** Genera la rutina personalizada del cliente y se la envía.

Encadena, de forma **sincrónica** dentro del request: valida que el cliente tenga
`encuestaData` no vacía → crea la rutina en `pendiente`/`generando` → **renderiza el
prompt de contenido** (el del gym, o el standard si no configuró ninguno) reemplazando los
placeholders → llama al proveedor y modelo de IA resueltos (§6) → guarda el contenido y el
prompt renderizado en `promptUsado` → **registra el consumo de tokens** (§4.5) → renderiza
el PDF con Puppeteer **sobre el fondo de la plantilla** (4.1.1) → lo persiste en storage →
lo envía por WhatsApp → marca el estado final. Si algo falla **hasta el PDF inclusive**, la
rutina queda en `estadoGeneracion: 'error'`.

> **El envío por WhatsApp es best-effort y NO tira abajo la generación.** Para cuando se
> llega a enviar, el modelo ya se cobró y el PDF ya está guardado: perder todo eso porque
> Meta devolvió un error obligaría al gimnasio a pagar otra generación para recuperarlo.
> La respuesta sigue siendo `200` y el resultado queda en `estadoEnvio`:
>
> | `estadoEnvio` | Qué pasó                                                    | Cómo se resuelve                      |
> | ------------- | ----------------------------------------------------------- | ------------------------------------- |
> | `enviado`     | El socio lo recibió                                         | —                                     |
> | `pendiente`   | **No se pudo ni intentar**: falta el número del gym, su token o el teléfono del socio | Completando esa configuración |
> | `error`       | **Se intentó y falló**                                      | `POST /api/routines/:id/resend`       |
>
> La diferencia entre `pendiente` y `error` importa para la UI: en el primer caso reintentar
> no sirve de nada hasta que se complete la configuración.

**Necesita:**

- Tenant resoluble y un cliente de ese gym.
- **`encuestaData` no vacía** en el cliente. Es el requisito más común de fallo.
- Una **API key de IA** resoluble por alguno de los tres escalones de §6. Si ni siquiera
  hay key para el proveedor de respaldo → `400` con mensaje accionable.
- Para que además se envíe: `phoneNumberId` + `accessToken` del gym y `telefono` del cliente.

**Parámetros:** `clientId` en la URL. **Sin body.**

**Respuesta `200`** (no `202`: el trabajo ya está hecho cuando responde)

```json
{
  "status": "success",
  "message": "Routine generated successfully",
  "data": { "routineId": "66c1...", "fuenteCredencial": "gym" }
}
```

`fuenteCredencial` dice **con qué credencial se generó** (ver §6): `gym` (la del propio
gimnasio), `plataforma` (la del entorno, mismo proveedor) o `respaldo` (se degradó a otro
proveedor). Cuando vale `respaldo`, el `message` cambia a
`"Routine generated with the platform fallback AI provider"`: la rutina **sí** se generó,
pero con un modelo que el dueño no eligió y que paga la plataforma. Es el momento
indicado para pedirle que cargue su propia API key.

**Errores:**

- `400` — `Client has no survey data. Complete the onboarding form first.`
- `400` — `No AI API key configured for provider "deepseek". Add it in the gym settings.`
- `404` — cliente o gym inexistente.
- `500` — falla del proveedor de IA, de la generación del PDF o de WhatsApp.

> **El `estadoEnvio` es honesto.** Si faltó el número del gym, su token o el teléfono del
> cliente, la rutina se genera y queda en `estadoEnvio: 'pendiente'` — **no** `'enviado'`.
> Así se pueden encontrar las rutinas que nadie recibió y reenviarlas con `/resend`.

> ⚠️ **Latencia alta.** Es el endpoint más lento de la API (LLM + Puppeteer + upload en
> serie). Conviene un timeout generoso en el cliente HTTP.

### `GET /api/routines/expiring`

Cuenta las rutinas que vencen dentro de `days` días.

**Necesita:** tenant resoluble.

| Query param | Tipo   | Default |
| ----------- | ------ | ------- |
| `days`      | número | `7`     |

```json
{ "status": "success", "data": { "count": 12, "days": 7 } }
```

### `GET /api/routines/client/:clientId`

Historial completo de rutinas de un cliente.

**Necesita:** tenant resoluble.

### `GET /api/routines/:id`

Devuelve una rutina (contenido generado, `pdfUrl`, estados, `whatsappMessageId`,
`promptUsado`).

**Necesita:** tenant resoluble y que la rutina pertenezca a ese gym. **Errores:** `404`.

### `GET /api/routines/:id/pdf`

**Devuelve el PDF en binario**, no JSON. Es la única forma de obtener el archivo desde el
front: `routine.pdfUrl` es una ruta del filesystem **del servidor**
(`./storage/generated/...`), no una URL pública, y no hay archivos servidos estáticamente.

**Necesita:** tenant resoluble y que la rutina pertenezca a ese gym.

| Cabecera de la respuesta | Valor                                     |
| ------------------------ | ----------------------------------------- |
| `Content-Type`           | `application/pdf`                         |
| `Content-Disposition`    | `inline; filename="rutina-Ivan-Bazan.pdf"` |
| `Content-Length`         | tamaño en bytes                           |

Va como `inline` y no como `attachment` porque el caso principal es previsualizarlo dentro
del CRM (`<iframe>` / `<embed>`); el visor del navegador igual permite descargarlo. El
nombre del socio se sanea antes de entrar en la cabecera: sin tildes, sin espacios y sin
caracteres que permitirían inyectar headers.

**Errores:**

- `404` — la rutina no existe, **o es de otro gym** (no `403`: no se confirma que exista).
- `404` — la rutina existe pero **todavía no tiene PDF**: quedó en `error` o se está
  generando. Conviene distinguir estos dos casos en la UI mirando `estadoGeneracion`
  (`GET /api/routines/:id`) antes de ofrecer el botón de descarga.

### `POST /api/routines/:id/resend`

Reenvía por WhatsApp el PDF **ya generado** (no vuelve a llamar a la IA, así que no
consume tokens ni genera costo). Actualiza `whatsappMessageId` y marca `enviado`.

**Necesita:** tenant resoluble, una rutina de ese gym **con `pdfUrl`**, el cliente con
`telefono`, y el gym con `phoneNumberId` + `accessToken`.

**Parámetros:** `id` en la URL. Sin body.

**Respuesta `200`:** `{ "status": "success", "message": "Routine resent",
"data": { "whatsappMessageId": "wamid..." } }`

Cada condición que impide enviar devuelve un error **accionable**, en vez del `200`
silencioso que devolvía antes (el dueño apretaba reenviar, veía un éxito y el socio nunca
recibía nada):

| Situación                          | Código | Mensaje                                        |
| ---------------------------------- | ------ | ---------------------------------------------- |
| Rutina inexistente o de otro gym   | `404`  | `Routine not found`                            |
| La rutina no tiene PDF             | `400`  | Hay que **regenerarla**, no reenviarla         |
| El socio no tiene `telefono`       | `400`  | Cargarlo en la ficha del socio                 |
| El gym no configuró `phoneNumberId`| `400`  | Configurarlo en `/api/gyms/settings/whatsapp`  |
| El gym no tiene access token       | `400`  | Ídem                                           |
| WhatsApp rechazó el mensaje        | `502`  | Incluye el motivo que devolvió Meta            |

Si el envío falla, la rutina queda en `estadoEnvio: 'error'` — **reintentable**, no colgada
en `enviando`.

---

## 4.4 Facturas — `/api/invoices`

Historial de facturación del gimnasio. Las facturas **no se crean por esta API**: las
produce `POST /api/clients/:id/renew`. Estos endpoints son de consulta.

### `GET /api/invoices`

Listado paginado del historial, con filtros. Ordenado por fecha de emisión descendente.

**Necesita:** tenant resoluble.

| Query param       | Tipo                                             | Default | Descripción                              |
| ----------------- | ------------------------------------------------ | ------- | ---------------------------------------- |
| `clientId`        | ObjectId                                         | —       | Facturas de un socio concreto            |
| `estado`          | `emitida` \| `anulada` \| `error` \| `pendiente` | —       | Filtra por estado                        |
| `tipoComprobante` | string                                           | —       | Ej. `"Factura C"`                        |
| `cae`             | string                                           | —       | Buscar un comprobante puntual por su CAE |
| `emitidaDesde`    | fecha ISO                                        | —       | Inicio del rango                         |
| `emitidaHasta`    | fecha ISO                                        | —       | Fin del rango                            |
| `page`            | número                                           | `1`     | Página                                   |
| `limit`           | número                                           | `20`    | Máximo `100`                             |

```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": "66d1...",
        "gymId": "66a0...",
        "clientId": "66b1...",
        "tipoComprobante": "Factura C",
        "cae": "75123456789012",
        "monto": 15000,
        "fechaEmision": "2026-07-10T14:00:00.000Z",
        "estado": "emitida",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

**Errores:** `400` fecha inválida o `clientId` malformado.

### `GET /api/invoices/revenue`

Reporte de ingresos de un período, con desglose mensual para graficar.

**Solo suma las facturas en estado `emitida`:** una en `error` quedó registrada para
auditoría pero no es plata cobrada.

**Necesita:** tenant resoluble.

| Query param | Tipo      | Default       |
| ----------- | --------- | ------------- |
| `desde`     | fecha ISO | hace 12 meses |
| `hasta`     | fecha ISO | hoy           |

```json
{
  "status": "success",
  "data": {
    "desde": "2026-01-01T00:00:00.000Z",
    "hasta": "2026-02-28T00:00:00.000Z",
    "total": 3500,
    "cantidad": 3,
    "porMes": [
      { "year": 2026, "month": 1, "total": 1500, "cantidad": 2 },
      { "year": 2026, "month": 2, "total": 2000, "cantidad": 1 }
    ]
  }
}
```

**Errores:** `400` si `desde > hasta`.

### `GET /api/invoices/:id`

Detalle de un comprobante.

**Necesita:** tenant resoluble y que la factura pertenezca a ese gym. **Errores:** `404`.

---

## 4.5 Consumo de IA — `/api/ai-usage`

Cuánto consume de IA cada gimnasio. Se alimenta solo: cada
`POST /api/routines/generate/:clientId` deja un registro con tokens y costo estimado.
No hay endpoint de escritura.

Es la base para tarifar: permite responder "cuánto me cuesta atender a este gym".

### `GET /api/ai-usage`

Detalle del consumo, rutina por rutina. Ordenado por fecha descendente.

**Necesita:** tenant resoluble.

| Query param | Tipo                                  | Default | Descripción                   |
| ----------- | ------------------------------------- | ------- | ----------------------------- |
| `clientId`  | ObjectId                              | —       | Consumo generado por un socio |
| `routineId` | ObjectId                              | —       | Consumo de una rutina puntual |
| `provider`  | `deepseek` \| `openai` \| `anthropic` | —       | Filtra por proveedor          |
| `model`     | string                                | —       | Filtra por modelo exacto      |
| `desde`     | fecha ISO                             | —       | Inicio del rango              |
| `hasta`     | fecha ISO                             | —       | Fin del rango                 |
| `page`      | número                                | `1`     | Página                        |
| `limit`     | número                                | `20`    | Máximo `100`                  |

```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": "66e1...",
        "gymId": "66a0...",
        "clientId": "66b1...",
        "routineId": "66c1...",
        "provider": "deepseek",
        "model": "deepseek-chat",
        "tokensPrompt": 1200,
        "tokensRespuesta": 2400,
        "tokensTotal": 3600,
        "costoEstimado": 0.002964,
        "fuenteCredencial": "gym",
        "createdAt": "..."
      }
    ],
    "total": 128,
    "page": 1,
    "limit": 20,
    "totalPages": 7
  }
}
```

**Errores:** `400` proveedor desconocido o fecha inválida.

### `GET /api/ai-usage/report`

Consumo agregado del período, con desglose **por mes** y **por modelo** (este último
ordenado por costo descendente, para ver qué modelo sale caro).

**Necesita:** tenant resoluble.

| Query param | Tipo      | Default       |
| ----------- | --------- | ------------- |
| `desde`     | fecha ISO | hace 12 meses |
| `hasta`     | fecha ISO | hoy           |

```json
{
  "status": "success",
  "data": {
    "desde": "2026-01-01T00:00:00.000Z",
    "hasta": "2026-07-25T00:00:00.000Z",
    "tokensTotal": 6000,
    "costoEstimado": 0.035,
    "rutinas": 3,
    "rutinasSinPrecio": 0,
    "porMes": [
      {
        "year": 2026,
        "month": 7,
        "tokensTotal": 6000,
        "costoEstimado": 0.035,
        "rutinas": 3
      }
    ],
    "porModelo": [
      {
        "provider": "openai",
        "model": "gpt-4o",
        "tokensTotal": 2000,
        "costoEstimado": 0.02,
        "rutinas": 1
      },
      {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "tokensTotal": 4000,
        "costoEstimado": 0.015,
        "rutinas": 2
      }
    ]
  }
}
```

> **Leer `rutinasSinPrecio` antes de usar `costoEstimado`.** Si un modelo no está en la
> tabla de precios (`src/domain/ai/pricing.ts`), su consumo se registra con
> `costoEstimado: null` y **no suma al total**. Sin ese contador, un costo bajo sería
> indistinguible entre "este gym gastó poco" y "faltan precios cargados".

**Errores:** `400` si `desde > hasta`.

---

## 4.6 Dashboard — `/api/dashboard`

### `GET /api/dashboard`

Métricas agregadas del gym.

**Necesita:** tenant resoluble.

```json
{
  "status": "success",
  "data": {
    "clientesActivos": 128,
    "clientesRecurrentes": 74,
    "rutinasPorVencer": { "en7Dias": 12, "en5Dias": 8, "en3Dias": 3 },
    "ingresos": { "mesActual": 480000, "mesPrevio": 415000 }
  }
}
```

Los ingresos suman las facturas **emitidas** del mes. Para períodos arbitrarios o
desglose mensual, usar `GET /api/invoices/revenue`.

> `clientesRecurrentes` se calcula trayendo hasta **1000** clientes activos y filtrando en
> memoria: un gym con más de 1000 activos vería el número subestimado.

### `GET /api/dashboard/summary`

⚠️ **Placeholder.** Devuelve un mensaje fijo sin agregación real.

**Necesita:** token con rol `admin`. Es el único endpoint bajo `/api/dashboard` que **no**
exige `?gymId=`, porque su propósito es ser cross-gym. Rol `gym` → `403`.

---

# 5. Resumen por nivel de acceso

| Endpoint                       | Auth               | Rol              | ¿`?gymId=` para admin? |
| ------------------------------ | ------------------ | ---------------- | ---------------------- |
| `GET /health`                  | —                  | —                | —                      |
| `POST /api/auth/login`         | —                  | —                | —                      |
| `POST /api/auth/refresh`       | cookie             | —                | —                      |
| `POST /api/auth/logout`        | —                  | —                | —                      |
| `POST /api/onboarding/webhook` | `x-webhook-secret` | —                | —                      |
| `GET /api/onboarding/status`   | —                  | —                | —                      |
| `GET /api/auth/me`             | Bearer             | cualquiera       | —                      |
| `/api/admin/gyms/*`            | Bearer             | `admin`          | no aplica              |
| `/api/admin/users/*`           | Bearer             | `admin`          | no aplica              |
| `/api/gyms/settings*`          | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `/api/clients/*`               | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `/api/routines/*`              | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `/api/invoices/*`              | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `/api/ai-usage/*`              | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `GET /api/dashboard`           | Bearer             | `gym` \| `admin` | **obligatorio**        |
| `GET /api/dashboard/summary`   | Bearer             | `admin`          | no                     |

---

# 6. Credenciales y secretos (BYOK)

Cada gimnasio usa **sus propias credenciales**, cifradas con AES-256-GCM en su documento
y nunca devueltas por la API. Las variables de entorno quedaron como **fallback de
plataforma** para los gyms que todavía no cargaron las suyas.

| Credencial               | Se carga con                                      | Fallback de plataforma                                                          |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| API key de IA            | `PUT /api/gyms/settings/ai-prompt` → `apiKey`     | `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` según el `provider` |
| Access token de WhatsApp | `PUT /api/gyms/settings/whatsapp` → `accessToken` | `WHATSAPP_DEFAULT_ACCESS_TOKEN`                                                 |
| API key de AFIP          | `PUT /api/gyms/settings/afip` → `apiKey`          | `AFIP_SDK_API_KEY`                                                              |

**Regla de resolución, igual para las tres:**

1. Si el gym tiene su credencial cargada, se usa esa. **Si no se puede descifrar, la
   operación falla** — no cae al fallback, porque eso haría que el gym consuma la cuota de
   la plataforma o mande el PDF desde otro número sin que nadie se entere.
2. Si el gym no cargó ninguna, se usa la del entorno.

**La API key de IA agrega un tercer escalón**, porque es la única credencial que otro
proveedor puede sustituir:

3. Si tampoco hay variable de entorno para el `provider` que el gym eligió, se degrada al
   **proveedor de respaldo** (`deepseek`, con `DEEPSEEK_API_KEY`) en vez de dejar al gym
   sin poder generar rutinas. Al degradar **se descarta el `model` configurado**: pedirle
   `gpt-4o` a DeepSeek falla, así que se usa el default del adaptador (`deepseek-chat`).

Cada generación registra en qué escalón cayó, tanto en la respuesta del endpoint como en
el registro de consumo (`fuenteCredencial`: `gym` \| `plataforma` \| `respaldo`). Eso
permite separar lo que paga cada gimnasio de lo que paga la plataforma, y detectar quién
está generando rutinas con un modelo que no es el que configuró.

> **`APP_MASTER_KEY` es crítica.** Cifra las tres credenciales de todos los gyms. Sin ella
> no se pueden guardar (`500` al intentarlo). **No la rotes sin volver a cargar las
> credenciales de cada gym:** lo ya cifrado deja de poder descifrarse.

> **Mientras un gym use el fallback**, comparte cuota y costo con el resto y el PDF sale
> desde el número compartido. El consumo se sigue midiendo por gym (§4.5), así que se
> puede ver quién todavía no migró.

---

# 7. Cómo se crean las cuentas

**No hay registro público.** No existe un endpoint abierto de signup: crear una cuenta de
tipo `gym` es siempre una acción del super-admin.

1. **Bootstrap del super-admin** — fuera de la API, por script:

   ```bash
   npx ts-node src/scripts/seed-superadmin.ts
   ```

   Lee `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` y `SUPERADMIN_NAME` del `.env`. Es
   idempotente: si el email ya existe, no hace nada. Los usuarios con rol `admin` **solo**
   se crean por esta vía, nunca por API.

2. **Alta de un gimnasio con su dueño** — `POST /api/admin/gyms` (rol `admin`).

3. **Usuarios adicionales para un gym existente** — `POST /api/admin/users` (rol `admin`).

4. **El dueño inicia sesión** con `POST /api/auth/login` y ya opera sobre su propio tenant.

Flujo completo de puesta en marcha de un tenant:

```
seed-superadmin.ts  →  POST /api/auth/login (admin)
                    →  POST /api/admin/gyms                (gym + usuario dueño)
                    →  POST /api/auth/login (dueño)
                    →  PUT  /api/gyms/settings/ai-prompt   (prompt, proveedor y API key propia)
                    →  PUT  /api/gyms/settings/whatsapp    (número y token propios)
                    →  PUT  /api/gyms/settings/afip        (facturación, opcional)
                    →  POST /api/onboarding/webhook        (entran los clientes)
                    →  POST /api/routines/generate/:clientId
                    →  GET  /api/invoices/revenue          (ingresos del gym)
                    →  GET  /api/ai-usage/report           (costo de atenderlo)
```

---

# 8. Limitaciones conocidas

Comportamientos reales de esta versión, documentados para que no sorprendan:

- `GET /api/admin/gyms/:id` y `GET /api/dashboard/summary` son **placeholders**: responden
  `200` con datos ficticios en lugar de `501`.
- `DELETE /api/admin/gyms/:id` **no desactiva a los usuarios** del gym; hay que hacerlo a mano.
- `PUT /api/admin/gyms/:id` reemplaza `aiConfig`/`whatsappConfig` enteros, lo que **borra
  las credenciales cifradas** del gym. Usar `/api/gyms/settings/*` para cambios parciales.
- `GET /api/onboarding/status` es público pese al comentario del código.
- **No se pueden anular facturas por API.** Anular ante AFIP exige emitir una nota de
  crédito real, no cambiar el estado en la base. Las facturas en `error` se consultan pero
  **no son reintentables**: hay que renovar de nuevo.
- **La tabla de precios de IA (`src/domain/ai/pricing.ts`) son valores de referencia.** Los
  precios de los proveedores cambian; verificalos antes de usar `costoEstimado` para
  tarifarle a un gimnasio. Un modelo sin precio cargado registra el consumo con
  `costoEstimado: null` y aparece en `rutinasSinPrecio`.
- **No se puede subir una plantilla de PDF propia por API** (4.1.1). El modelo de datos y
  la resolución ya lo contemplan, pero no hay endpoint: todos los gyms usan la standard.
- **El prompt `{{respuestas_encuesta}}` se trata como "sin configurar".** Era el default
  que ponía el alta antes de que existiera el prompt standard, y nunca lo escribió un
  dueño. Un gym que lo tenga guardado pasa a generar con el standard.
- **La medición de consumo arranca desde su implementación (2026-07-25).** Las rutinas
  generadas antes no tienen registro: ese dato se descartaba y no es recuperable.
- **`fuenteCredencial` arranca desde 2026-07-26.** Los registros de consumo anteriores lo
  tienen en `null`: no se puede saber retroactivamente quién pagó esas generaciones.
- **El respaldo de IA comparte cuota y costo entre todos los gyms que caigan en él.** No
  hay tope por gimnasio: un gym sin API key propia puede consumir la key de plataforma sin
  límite. Se detecta filtrando el consumo por `fuenteCredencial: "respaldo"`.
- Si el proveedor de IA no informa `usage`, la generación **no se mide** (queda un warning
  en el log) en vez de registrar ceros que se leerían como consumo real.
- El registro de consumo es **best-effort**: si falla su escritura, la rutina se entrega
  igual y solo queda el error en el log.
- El `logout` no revoca el access token ya emitido (JWT stateless, 15 min de ventana).
- `clientesRecurrentes` del dashboard se calcula sobre un tope de 1000 clientes activos.
- Nada valida que una encuesta esté **completa**: `{"a": 1}` es válida. La única regla es
  que no esté vacía, así que se puede generar una rutina con datos insuficientes.
- Los gyms creados antes del cambio de default conservan el `provider` que tenían. El
  default `deepseek` aplica solo a los gyms nuevos; para migrar uno existente, llamar a
  `PUT /api/gyms/settings/ai-prompt` con `{ "provider": "deepseek" }`.
