# API — gym-crm-backend

Documentación de todos los endpoints, agrupados por nivel de acceso.
Generada a partir del código real (`src/interfaces/http/`), no de un diseño previsto.

- **Base URL:** `http://localhost:4000` (configurable con `PORT`)
- **Prefijo de la API:** `/api` (excepto `/health`)
- **Última actualización:** 2026-07-24

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
{ "status": "success", "data": { } }
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

| Código | Cuándo |
|---|---|
| `200` | OK |
| `201` | Recurso creado (`POST /api/clients`, `POST /api/admin/gyms`, `POST /api/admin/users`, webhook) |
| `400` | Validación fallida. Los errores de Zod incluyen además un array `errors` con `{ path, message }` por campo. También cubre `_id` malformado (CastError de Mongoose) |
| `401` | Token ausente, inválido o expirado; credenciales incorrectas; webhook secret inválido |
| `403` | Rol insuficiente (`requireAdmin`) o falta de `gymId` en el token |
| `404` | Recurso inexistente **o perteneciente a otro tenant** (indistinguible a propósito) |
| `409` | Conflicto de unicidad (email o CUIT ya existentes) |
| `429` | Rate limit superado |
| `500` | Error inesperado |

> **Emails y caracteres no ASCII.** La validación de email de Zod rechaza acentos y `ñ` en
> la parte local: `dueño@gimnasio.com` devuelve `400`. Usar `dueno@gimnasio.com`.

### Roles

| Rol | `gymId` | Puede |
|---|---|---|
| `admin` | no tiene | Gestionar gyms y usuarios dueños. **Leer** datos de cualquier tenant pasando `?gymId=`. No puede escribir datos de tenant (ver nota abajo). |
| `gym` | fijo en el JWT | Operar exclusivamente sobre su propio gym. |

> **Alcance del admin — dos categorías distintas, no confundir:**
>
> - **Cuentas (gyms y usuarios): CRUD completo.** El admin crea, lee, actualiza y
>   desactiva gimnasios y usuarios dueños sin restricción, vía `/api/admin/*`. Es la vía
>   de mantenimiento de los dueños de gimnasio.
> - **Datos de tenant (clientes, rutinas, dashboard): solo lectura.** Puede consultarlos
>   pasando `?gymId=`, pero las escrituras (crear/editar/borrar clientes, renovar, generar
>   rutinas) exigen `user.gymId` — que un token de admin no lleva — y responden `403`.
>
> El motivo es mecánico: los handlers de escritura resuelven el tenant con
> `if (!user?.gymId) → 403`, mientras que los de lectura aceptan `?gymId=`. Nunca se
> implementó la variante con `?gymId=` para las escrituras.

---

# 1. Endpoints públicos (sin autenticación)

Se montan **antes** del middleware de autenticación, así que no requieren token.

## `GET /health`

Health check del servicio. Sin parámetros.

```json
{ "status": "ok", "timestamp": "2026-07-24T12:00:00.000Z" }
```

---

## `POST /api/auth/login`

Inicia sesión y devuelve el access token. Sirve tanto para el super-admin como para los
dueños de gym: el rol y el `gymId` salen del usuario en base de datos.

**Rate limit:** 5 intentos por IP cada 15 minutos → `429`.

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `email` | string | sí | formato email válido |
| `password` | string | sí | mínimo 1 carácter |

```json
{ "email": "dueño@gimnasio.com", "password": "miPassword123" }
```

**Respuesta `200`** — además setea la cookie `refreshToken` (httpOnly, 7 días).

```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "66a1...",
      "email": "dueño@gimnasio.com",
      "name": "Dueño",
      "role": "gym",
      "gymId": "66a0..."
    }
  }
}
```

**Errores:** `401` credenciales inválidas o cuenta desactivada (`isActive: false`).

---

## `POST /api/auth/refresh`

Renueva el access token. **No lleva body**: usa la cookie `refreshToken` enviada
automáticamente por el navegador (requiere `credentials: 'include'`).

**Respuesta `200`**

```json
{ "status": "success", "data": { "accessToken": "eyJhbGciOi..." } }
```

**Errores:** `401` si no hay cookie, si el token expiró, o si el usuario fue desactivado.

---

## `POST /api/auth/logout`

Borra la cookie `refreshToken`. Sin body ni parámetros.

> Los JWT son stateless: el access token que ya emitiste **sigue siendo válido hasta que
> expire** (15 min). No hay revocación server-side.

---

## `POST /api/onboarding/webhook`

Punto de entrada de las respuestas de Google Forms. Crea el cliente en el gym o, si ya
existe (mismo `documento` dentro del mismo gym), **fusiona** las respuestas nuevas sobre
las previas y refresca sus datos de contacto.

Es el productor de `encuestaData`, el insumo obligatorio para generar rutinas.

**Rate limit:** 100 requests por IP cada 15 minutos.

**Headers**

| Header | Requerido | Descripción |
|---|---|---|
| `x-webhook-secret` | sí | Se valida contra `googleFormConfig.webhookSecret` del gym; si el gym no tiene uno configurado, cae a `GOOGLE_FORMS_DEFAULT_WEBHOOK_SECRET` |

**Body**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `gymId` | string | sí | Tenant destino |
| `respuestas` | object | sí | JSON crudo del formulario, claves libres |

De `respuestas` se extraen por coincidencia difusa de clave (case-insensitive, admite
variantes de idioma) tres campos **obligatorios** y uno opcional:

| Campo del cliente | Claves que reconoce |
|---|---|
| `nombre` (obligatorio) | `nombre`, `Nombre`, `name` |
| `documento` (obligatorio) | `dni`, `DNI`, `documento`, `Documento` |
| `telefono` (obligatorio) | `telefono`, `Teléfono`, `phone` |
| `email` (opcional) | `email`, `Email`, `correo` |

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
  "data": { "clientId": "66b1...", "nombre": "Iván Bazán", "estado": "pendiente" }
}
```

**Errores:** `401` sin header o secret inválido · `400` si falta alguno de los tres
campos obligatorios o si el gym está inactivo.

---

## `GET /api/onboarding/status`

Devuelve un heartbeat del webhook. Sin parámetros.

```json
{ "status": "success", "data": { "lastSync": "2026-07-24T12:00:00.000Z", "message": "Webhook endpoint active" } }
```

> El comentario en el código dice que requiere auth, pero está montado en el bloque
> público: **hoy es accesible sin token**.

---

# 2. Endpoint autenticado (cualquier rol)

## `GET /api/auth/me`

Devuelve la identidad del token actual. Útil para rehidratar la sesión en el frontend.

**Requiere:** `Authorization: Bearer <token>`. Sin parámetros.

```json
{ "status": "success", "data": { "email": "dueño@gimnasio.com", "role": "gym", "gymId": "66a0..." } }
```

**Errores:** `401` sin token o token inválido.

---

# 3. Super-admin — `/api/admin/*`

Todos requieren `Authorization: Bearer <token>` **con rol `admin`**. Cualquier otro rol
recibe `403 Admin access required`.

## 3.1 Gestión de gimnasios (tenants)

### `GET /api/admin/gyms`

Lista todos los gyms **activos**. Sin parámetros.

```json
{
  "status": "success",
  "data": [
    { "id": "66a0...", "name": "Hype Workout", "businessName": "Hype SRL",
      "cuit": "30712345678", "contactEmail": "info@hype.com", "contactPhone": "5491122334455" }
  ]
}
```

### `POST /api/admin/gyms`

**Da de alta un tenant completo:** crea el gym **y su primer usuario dueño** en la misma
operación. Es la vía de creación de cuentas de tipo `gym` (ver §6).

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `name` | string | sí | mín. 1 carácter |
| `businessName` | string | sí | mín. 1 carácter |
| `cuit` | string | sí | mín. 11 caracteres, **único** |
| `contactEmail` | string | sí | email válido |
| `contactPhone` | string | sí | mín. 10 caracteres |
| `adminEmail` | string | sí | email válido, **único** entre usuarios |
| `adminPassword` | string | sí | mín. 6 caracteres (se hashea con bcrypt cost 12) |
| `adminName` | string | sí | mín. 1 carácter |
| `aiProvider` | `deepseek` \| `openai` \| `anthropic` | no | Proveedor de IA inicial (default `deepseek`) |
| `whatsappPhoneNumberId` | string | no | Phone Number ID de Meta. Se puede dejar para después |

Config por defecto que recibe el gym nuevo: `aiConfig.provider = 'openai'`,
`aiConfig.promptTemplate = '{{respuestas_encuesta}}'`, `whatsappConfig.tokenSecretRef =
'whatsapp-{cuit}'`. Se ajustan después desde `/api/gyms/settings/*` o con `PUT /api/admin/gyms/:id`.

```json
{
  "name": "Hype Workout", "businessName": "Hype SRL", "cuit": "30712345678",
  "contactEmail": "info@hype.com", "contactPhone": "5491122334455",
  "adminEmail": "dueño@hype.com", "adminPassword": "secret123", "adminName": "Dueño"
}
```

**Respuesta `201`**

```json
{
  "status": "success",
  "data": {
    "gym": { "id": "66a0...", "name": "Hype Workout", "businessName": "Hype SRL", "cuit": "30712345678" },
    "user": { "id": "66a1...", "email": "dueño@hype.com", "name": "Dueño" }
  }
}
```

**Errores:** `409` CUIT o email ya existentes · `400` validación.

### `GET /api/admin/gyms/:id`

⚠️ **Placeholder.** Hoy devuelve `{ "id": "<id>" }` sin consultar la base.

### `PUT /api/admin/gyms/:id`

Actualiza un gym. Todos los campos son **opcionales**; se aplican solo los enviados.

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | string | mín. 1 |
| `businessName` | string | mín. 1 |
| `cuit` | string | mín. 11 |
| `contactEmail` | string | email válido |
| `contactPhone` | string | mín. 10 |
| `aiConfig` | object | `{ provider: 'openai'\|'anthropic', promptTemplate: string, model?: string }` — objeto completo, reemplaza |
| `whatsappConfig` | object | `{ phoneNumberId: string, tokenSecretRef: string }` |
| `pdfTemplate` | object | `{ storagePath?: string, fieldsMap?: object }` |
| `googleFormConfig` | object | `{ formId?: string, webhookSecret?: string }` |

**Errores:** `404` gym inexistente.

### `DELETE /api/admin/gyms/:id`

**Soft delete:** marca `isActive = false`. El gym deja de aparecer en el listado.

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

**Query params** — todos opcionales:

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `q` | string | — | Busca parcial (case-insensitive) en nombre **o** email |
| `role` | `admin` \| `gym` | — | Filtra por rol |
| `gymId` | string | — | Usuarios de un gym concreto |
| `isActive` | `"true"` \| `"false"` | — | Filtra por estado |
| `page` | string numérico | `"1"` | Página |
| `limit` | string numérico | `"20"` | Tamaño de página |

```
GET /api/admin/users?role=gym&isActive=true&q=hype&page=1&limit=20
```

**Respuesta `200`** — `passwordHash` nunca se expone.

```json
{
  "status": "success",
  "data": {
    "data": [
      { "id": "66a1...", "email": "dueño@hype.com", "name": "Dueño", "role": "gym",
        "gymId": "66a0...", "isActive": true,
        "createdAt": "2026-07-01T10:00:00.000Z", "updatedAt": "2026-07-20T18:30:00.000Z" }
    ],
    "total": 1, "page": 1, "limit": 20, "totalPages": 1
  }
}
```

### `GET /api/admin/users/search`

Alias explícito del listado. Mismos query params y misma respuesta.

### `GET /api/admin/users/:id`

Devuelve un usuario. **Errores:** `404`.

### `POST /api/admin/users`

Crea un usuario dueño de gym adicional para un gym existente. El rol se fuerza a `gym`.

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `email` | string | sí | email válido, **único** |
| `password` | string | sí | mín. 6 caracteres (bcrypt cost 12) |
| `name` | string | sí | mín. 1 carácter |
| `gymId` | string | sí | El gym debe existir |

**Respuesta `201`:** el usuario creado (sin `passwordHash`).

**Errores:** `404` gym inexistente · `409` email ya usado · `400` validación.

### `PUT /api/admin/users/:id`

Edita un usuario. Todos los campos son opcionales, pero hay que enviar al menos uno útil.

| Campo | Tipo | Reglas |
|---|---|---|
| `email` | string | email válido, único |
| `name` | string | mín. 1 carácter |
| `isActive` | boolean | `false` bloquea el login inmediatamente |
| `gymId` | string | Reasigna el usuario a otro gym; debe existir |

**Errores:** `404` usuario o gym inexistente · `409` email tomado · `403` si el target es `admin`.

### `DELETE /api/admin/users/:id`

**Soft delete:** marca `isActive = false`. El usuario deja de poder iniciar sesión
(`LoginUseCase` rechaza cuentas inactivas). Se reactiva con `PUT .../:id` e `isActive: true`.

**Errores:** `404` · `403` si el target es `admin`.

### `PUT /api/admin/users/:id/password`

Resetea la contraseña sin pedir la anterior (el actor es el super-admin, no el dueño).

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `password` | string | sí | mín. 6 caracteres |

**Errores:** `404` · `403` si el target es `admin`.

---

# 4. Tenant (dueño de gym) — requiere rol `gym`

Requieren `Authorization: Bearer <token>`. El `gymId` sale del token; **no se envía nunca
en el body**. Un `admin` (sin `gymId`) recibe `403` en todo lo que sea escritura.

## 4.1 Configuración del gimnasio — `/api/gyms`

### `GET /api/gyms/settings`

Devuelve la configuración del gym del token. Sin parámetros.

La respuesta usa un **allowlist**: nunca expone `whatsappConfig.tokenSecretRef`,
`afipConfig.encryptedApiKey` ni `googleFormConfig.webhookSecret`.

```json
{
  "status": "success",
  "data": {
    "id": "66a0...", "name": "Hype Workout", "businessName": "Hype SRL",
    "cuit": "30712345678", "contactEmail": "info@hype.com", "contactPhone": "5491122334455",
    "isActive": true,
    "aiConfig": { "provider": "openai", "promptTemplate": "{{respuestas_encuesta}}" },
    "pdfTemplate": {},
    "whatsappPhoneNumberId": "1234567890",
    "googleFormConfig": { "formId": "1FAIpQL..." },
    "afipConfig": { "puntoVenta": 1, "taxCondition": "MONOTRIBUTO", "isActive": true },
    "createdAt": "...", "updatedAt": "..."
  }
}
```

### `PUT /api/gyms/settings/ai-prompt`

Configura la IA del tenant. Es **el endpoint donde cada dueño describe su gimnasio**:
equipamiento, espacios, restricciones y tono. Hace **merge** sobre la configuración
existente, así que enviar solo `promptTemplate` conserva `provider` y `model`.

**Body** — todos opcionales, pero **al menos uno es obligatorio**:

| Campo | Tipo | Reglas |
|---|---|---|
| `promptTemplate` | string | Texto libre + placeholders. Ver reglas abajo |
| `provider` | `deepseek` \| `openai` \| `anthropic` | Proveedor de IA de este gym. Default de gyms nuevos: `deepseek` |
| `model` | string | Modelo concreto. Si se omite, el adaptador usa su default |

Modelos por defecto de cada proveedor (se sobrescriben con `model`):

| `provider` | Modelo por defecto | API key que consume |
|---|---|---|
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `anthropic` | `claude-3-7-sonnet-20250219` | `ANTHROPIC_API_KEY` |

> `deepseek` usa una API **compatible con OpenAI** apuntada a otro host
> (`DEEPSEEK_BASE_URL`, default `https://api.deepseek.com/v1`). No es un `model` del
> proveedor `openai`: pedir `deepseek-chat` con `provider: "openai"` falla, porque la
> petición va a `api.openai.com`.

#### Placeholders disponibles

Se escriben `{{nombre}}` (admiten espacios internos: `{{ nombre }}`) y se reemplazan
**todas** las apariciones al generar la rutina.

| Placeholder | Se reemplaza por |
|---|---|
| `{{respuestas_encuesta}}` | JSON completo de `encuestaData` del cliente |
| `{{cliente_nombre}}` | Nombre del cliente |
| `{{cliente_documento}}` | Documento / DNI |
| `{{cliente_email}}` | Email, o `no informado` |
| `{{cliente_telefono}}` | Teléfono, o `no informado` |
| `{{cliente_fecha_inicio}}` | Inicio de la membresía (formato es-AR) |
| `{{cliente_fecha_vencimiento}}` | Vencimiento de la membresía |
| `{{gym_nombre}}` | Nombre del gimnasio |
| `{{fecha_actual}}` | Fecha del día de la generación |

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

**Respuesta `200`:** `{ "status": "success", "data": { "aiConfig": { ... } } }`

**Errores:** `400` body vacío, o template sin placeholders / con placeholders
desconocidos · `403` sin `gymId` · `404` gym inexistente.

> El prompt **ya renderizado** (con los datos reales inyectados) se guarda en la rutina
> generada, en el campo `promptUsado`. Sirve para auditar exactamente qué recibió el
> modelo cuando una rutina sale rara.
>
> La misma validación se aplica en `PUT /api/admin/gyms/:id` cuando el super-admin
> reemplaza `aiConfig` entero.

### `PUT /api/gyms/settings/afip`

Configura la facturación electrónica. La `apiKey` se guarda **cifrada** (AES-256-GCM con
`APP_MASTER_KEY`) y nunca se devuelve.

**Body** — todos opcionales:

| Campo | Tipo | Reglas |
|---|---|---|
| `apiKey` | string | mín. 1. Se cifra antes de persistir |
| `puntoVenta` | number | entero positivo |
| `taxCondition` | `MONOTRIBUTO` \| `RESPONSABLE_INSCRIPTO` \| `EXENTO` | Determina el tipo de comprobante |
| `isActive` | boolean | Si es `false`, la renovación no intenta facturar |

**Respuesta `200`:** solo los campos AFIP no sensibles.

---

## 4.2 Clientes — `/api/clients`

CRUD principal del tenant. Todas las consultas se filtran por `gymId`: un cliente de otro
gym devuelve `404`, no `403`.

### `GET /api/clients`

Lista clientes paginados.

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `query` | string | — | Busca por nombre (parcial) o documento (prefijo) |
| `estado` | `activo` \| `inactivo` \| `pendiente` | — | Filtra por estado |
| `page` | número | `1` | Página |
| `limit` | número | `20` | Tamaño de página |
| `gymId` | string | — | **Solo admin:** consultar otro tenant |

```json
{
  "status": "success",
  "data": { "data": [ { "id": "...", "nombre": "...", "encuestaData": { } } ],
            "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

### `GET /api/clients/search`

Igual que el anterior pero con validación estricta de los query params. **Ojo:** acá el
texto de búsqueda es `q`, no `query`.

| Query param | Tipo | Default |
|---|---|---|
| `q` | string | — |
| `estado` | `activo` \| `inactivo` \| `pendiente` | — |
| `page` | string numérico | `"1"` |
| `limit` | string numérico | `"20"` |

### `GET /api/clients/expiring`

Clientes cuya membresía vence **exactamente** dentro de `days` días (no es un rango
acumulado). Sirve para disparar recordatorios.

| Query param | Tipo | Default |
|---|---|---|
| `days` | número | `7` |

Excluye a los clientes en estado `inactivo`.

### `GET /api/clients/:id`

Devuelve un cliente completo, incluido `encuestaData`.
Acepta `?gymId=` si el rol es `admin`. **Errores:** `404`.

### `POST /api/clients`

Alta manual de cliente (la automática llega por el webhook de onboarding).
**Solo `nombre` y `documento` son obligatorios**: el resto se completa después con
`PATCH /api/clients/:id/encuesta`. El cliente se crea en estado `activo`.

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `nombre` | string | **sí** | mín. 1 carácter |
| `documento` | string | **sí** | mín. 1 carácter, **único dentro del gym** |
| `telefono` | string | no | mín. 10 caracteres |
| `email` | string | no | email válido |
| `fechaInicio` | string \| Date | no | Fecha ISO, con o sin hora. Default: hoy |
| `fechaVencimiento` | string \| Date | no | Default: `fechaInicio` + 30 días |
| `encuestaData` | object | no | Respuestas de la encuesta; claves libres |

Alta mínima:

```json
{ "nombre": "Iván Bazán", "documento": "40123456" }
```

**Respuesta `201`:** el cliente creado, con las fechas ya resueltas.
**Errores:** `400` validación o documento duplicado en el gym.

### `PATCH /api/clients/:id/encuesta`

Completa la encuesta de un cliente ya creado. **Fusiona** las respuestas nuevas sobre las
ya cargadas, así que la ficha se puede completar en varias tandas sin perder lo anterior
(a diferencia de `PUT /api/clients/:id`, que reemplaza el objeto entero).

Los datos de contacto que llegan en la encuesta se promueven a campos propios del
cliente, porque el resto del sistema los lee desde ahí: el envío de la rutina por
WhatsApp usa `client.telefono`, no `encuestaData`.

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `encuestaData` | object | **sí** | Claves libres. No puede estar vacío |
| `telefono` | string | no | mín. 10 caracteres. Actualiza el campo del cliente |
| `email` | string | no | email válido. Actualiza el campo del cliente |

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
gym** · `403` sin `gymId` en el token.

> Las claves de `encuestaData` son libres y **nada valida que la encuesta esté completa**.
> Lo que cargues es literalmente lo que recibe el modelo de IA al generar la rutina.

### `PUT /api/clients/:id`

Actualiza un cliente. Todos los campos opcionales.

| Campo | Tipo | Reglas |
|---|---|---|
| `nombre` | string | mín. 1 |
| `documento` | string | mín. 1 |
| `telefono` | string | mín. 10 |
| `email` | string | email válido |
| `estado` | `activo` \| `inactivo` \| `pendiente` | |
| `fechaVencimiento` | string \| Date | Fecha ISO, con o sin hora |
| `encuestaData` | object | **Reemplaza** el objeto entero. Para agregar respuestas sin perder las previas, usar `PATCH /api/clients/:id/encuesta` |

**Errores:** `404` cliente inexistente · `409` el nuevo `documento` ya existe en el gym.

### `DELETE /api/clients/:id`

**Soft delete:** pasa el cliente a `estado: 'inactivo'`. **Errores:** `404`.

### `POST /api/clients/:id/renew`

Renueva la membresía y, si el gym tiene AFIP activo, **emite la factura**.

Efectos: agrega la renovación al `historialRenovaciones`, marca `esRecurrente = true` a
partir de la segunda, pasa el estado a `activo` y extiende `fechaVencimiento`
**30 días desde hoy** (el plazo lo calcula el servidor; no se puede enviar una fecha).

**Body**

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `monto` | number | sí | positivo |

> **Facturación best-effort:** si AFIP falla, la renovación **igual se aplica** y queda
> una `Invoice` en estado `error` con el detalle. La respuesta sigue siendo `200`.
> El tipo de comprobante depende de `taxCondition`: `MONOTRIBUTO` → Factura C, resto → Factura B.

**Respuesta `200`:** el cliente actualizado.
**Errores:** `404` cliente inexistente · `400` monto no positivo.

---

## 4.3 Rutinas — `/api/routines`

### `POST /api/routines/generate/:clientId`

**Flujo central del sistema.** Genera la rutina personalizada del cliente y se la envía.

Encadena, de forma **sincrónica** dentro del request: valida que el cliente tenga
`encuestaData` no vacía → crea la rutina en estado `pendiente`/`generando` → **renderiza
el `promptTemplate` del gym** reemplazando los placeholders con los datos del cliente →
llama al proveedor y modelo de IA configurados por el gym → guarda el contenido junto con
el prompt renderizado en `promptUsado` → renderiza el PDF con Puppeteer → lo persiste en
storage → lo envía por WhatsApp si el gym tiene token y el cliente teléfono → marca
`generado`/`enviado`. Si algo falla, la rutina queda en estado `error`.

**Parámetros:** `clientId` en la URL. **Sin body.**

**Respuesta `200`** (no `202`: el trabajo ya está hecho cuando responde)

```json
{ "status": "success", "message": "Routine generated successfully", "data": { "routineId": "66c1..." } }
```

**Errores:**
- `400` — `Client has no survey data. Complete the onboarding form first.` El cliente no
  completó el formulario, o su `encuestaData` está vacía.
- `404` — cliente o gym inexistente.
- `500` — falla del proveedor de IA, de la generación del PDF o de WhatsApp.

> ⚠️ **Latencia alta.** Es el endpoint más lento de la API (LLM + Puppeteer + upload en
> serie). Conviene un timeout generoso en el cliente HTTP.

### `GET /api/routines/expiring`

Cuenta las rutinas que vencen dentro de `days` días.

| Query param | Tipo | Default |
|---|---|---|
| `days` | número | `7` |

```json
{ "status": "success", "data": { "count": 12, "days": 7 } }
```

### `GET /api/routines/client/:clientId`

Historial completo de rutinas de un cliente. Acepta `?gymId=` si el rol es `admin`.

### `GET /api/routines/:id`

Devuelve una rutina (contenido generado, `pdfUrl`, estado, `whatsappMessageId`).
**Errores:** `404`.

### `POST /api/routines/:id/resend`

Reenvía por WhatsApp el PDF **ya generado** (no vuelve a llamar a la IA). Actualiza el
`whatsappMessageId` y marca la rutina como `enviado`.

**Parámetros:** `id` en la URL. Sin body.

Si el gym no tiene token de WhatsApp, el cliente no tiene teléfono o la rutina no tiene
`pdfUrl`, responde `200` sin haber enviado nada. **Errores:** `404` rutina inexistente.

---

## 4.4 Dashboard — `/api/dashboard`

### `GET /api/dashboard`

Métricas agregadas del gym.

| Query param | Tipo | Descripción |
|---|---|---|
| `gymId` | string | **Solo admin:** métricas de otro tenant |

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

Los ingresos se calculan sumando las facturas **emitidas** del mes.

### `GET /api/dashboard/summary`

⚠️ **Placeholder.** Solo admin (`403` para otros roles), pero devuelve un mensaje fijo
sin agregación real.

---

# 5. Resumen por nivel de acceso

| Endpoint | Auth | Rol |
|---|---|---|
| `GET /health` | — | — |
| `POST /api/auth/login` | — | — |
| `POST /api/auth/refresh` | cookie | — |
| `POST /api/auth/logout` | — | — |
| `POST /api/onboarding/webhook` | `x-webhook-secret` | — |
| `GET /api/onboarding/status` | — | — |
| `GET /api/auth/me` | Bearer | cualquiera |
| `GET·POST /api/admin/gyms`, `GET·PUT·DELETE /api/admin/gyms/:id` | Bearer | `admin` |
| `GET·POST /api/admin/users`, `/search`, `GET·PUT·DELETE /:id`, `PUT /:id/password` | Bearer | `admin` |
| `GET /api/gyms/settings`, `PUT /api/gyms/settings/ai-prompt`, `PUT /api/gyms/settings/afip` | Bearer | `gym` |
| `/api/clients/*` | Bearer | `gym` (admin: solo lectura con `?gymId=`) |
| `/api/routines/*` | Bearer | `gym` |
| `GET /api/dashboard` | Bearer | `gym` (admin con `?gymId=`) |
| `GET /api/dashboard/summary` | Bearer | `admin` |

---

# 6. Cómo se crean las cuentas

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
   Crea el gym y su primer usuario `gym` en una sola operación.

3. **Usuarios adicionales para un gym existente** — `POST /api/admin/users` (rol `admin`).

4. **El dueño inicia sesión** con `POST /api/auth/login` y ya opera sobre su propio tenant.

Flujo completo de puesta en marcha de un tenant:

```
seed-superadmin.ts  →  POST /api/auth/login (admin)
                    →  POST /api/admin/gyms            (gym + usuario dueño)
                    →  POST /api/auth/login (dueño)
                    →  PUT  /api/gyms/settings/ai-prompt   (prompt y proveedor de IA)
                    →  PUT  /api/gyms/settings/afip        (facturación, opcional)
                    →  POST /api/onboarding/webhook        (entran los clientes)
                    →  POST /api/routines/generate/:clientId
```

---

# 7. Limitaciones conocidas

Comportamientos reales de esta versión, documentados para que no sorprendan:

- `GET /api/admin/gyms/:id` y `GET /api/dashboard/summary` son **placeholders**: responden
  `200` con datos ficticios en lugar de `501`.
- `DELETE /api/admin/gyms/:id` **no desactiva a los usuarios** del gym; hay que hacerlo a mano.
- El `admin` no puede escribir datos de tenant (crear clientes, renovar, generar rutinas): `403`.
- `GET /api/onboarding/status` es público pese al comentario del código.
- **No hay endpoints de facturas.** Se escriben en la renovación y se leen agregadas en el
  dashboard, pero las que quedan en estado `error` no son consultables ni reintentables por API.
- Las API keys de IA y WhatsApp son **globales**, no por tenant: `EnvGymSecretsRepository`
  ignora el `gymId` y lee las variables de entorno (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`). Solo AFIP tiene clave real por gym.
- Los gyms creados antes de este cambio conservan el `provider` que tenían (`openai`).
  El default `deepseek` aplica solo a los gyms nuevos; para migrar uno existente hay que
  llamar a `PUT /api/gyms/settings/ai-prompt` con `{ "provider": "deepseek" }`.
- El `logout` no revoca el access token ya emitido (JWT stateless, 15 min de ventana).
- Los clientes creados antes del 2026-07-24 pueden no tener `encuestaData` guardada (bug
  ya corregido); se resuelven reenviando el formulario o con
  `PATCH /api/clients/:id/encuesta`.
- Nada valida que una encuesta esté **completa**: `{"a": 1}` es válida. La única regla es
  que no esté vacía, así que se puede generar una rutina con datos insuficientes.
