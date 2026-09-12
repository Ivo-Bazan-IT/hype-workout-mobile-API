# SCREENS_FRONT.md

Contratos de pantallas del front para el backend CRM Hype Workout (B2B2C).
Derivado de `README.md` y `docs/API_ENDPOINTS.md` (verificado al 2026-09-12).
Cada pantalla indica: endpoints que consume, contratos JSON, botones que los disparan,
y notificaciones asociadas (incluido el mecanismo definitivo: pop-up en dispositivos móviles,
trabajado en el front; el backend mantiene `INotificationProvider` con `NoOpNotificationProvider`
como adaptador inicial — `POST /internal/jobs/check-weekly-updates` expone el caso de uso).

---

## 1. Login (`/auth`)

**Endpoint:** `POST /auth/login` (`public`)  
**Contrato request:**

```json
{ "email": "string", "password": "string" }
```

**Contrato response:**

```json
{
  "status": "success",
  "data": {
    "accessToken": "string",
    "user": {
      "id": "string",
      "email": "string",
      "role": "admin | gym | entrenador | cliente",
      "gymId": "string | null"
    }
  }
}
```

**Botones:**

- `Iniciar sesión` → envía `POST /auth/login`
- `Recordar sesión` → cookie `refreshToken` (httpOnly, 7 días)
  **Notificaciones:** ninguna (autenticación). Si el rol es `entrenador` con `Gym` personal, el front debe redirigir al dashboard del entrenador.

---

## 2. Registro Entrenador (`/auth` o `/users`)

**Endpoint:** `POST /auth/register/entrenador` (`public`, si existe) / `POST /users` con `role: 'entrenador'`  
**Contrato:**

```json
{
  "email": "string",
  "password": "string",
  "nombre": "string",
  "perfilPublico": { "biografia": "string", "especialidad": "string" }
}
```

**Botones:**

- `Crear cuenta de entrenador` → crea `User` (`entrenador`) y aprovisiona `Gym.personal` (`tipo = 'personal'`)
- `Actualizar perfil` (`PUT /users/me/perfil`) → actualiza `perfilPublico`
  **Notificaciones:** ninguna en esta fase.

---

## 3. Registro Cliente Autónomo (`/users` + `/survey` + `/entrenadores`)

**Flujo:**

1. `POST /auth/register/cliente` (o `POST /users` con `role: 'cliente'`, `entrenadorId: null`) → crea `User`
2. `PATCH /survey/pending` → guarda `PendingSurvey` (TTL 30 días por defecto)
3. `GET /entrenadores` → busca entrenadores disponibles (paginación, whitelist sin credenciales)
4. `PUT /users/:id/entrenador` (o `POST /users/:id/entrenador`) → `SeleccionarEntrenadorUseCase` (actualiza `Client.gymId` si existe, crea `Client`)
5. `GET /clients/me` → ficha del cliente vinculado

**Botones:**

- `Completar encuesta` (`PATCH /survey/pending`)
- `Buscar entrenadores` (`GET /entrenadores`)
- `Seleccionar entrenador` (`PUT /users/:id/entrenador`)
- `Ver mi ficha` (`GET /clients/me`)
  **Notificaciones:** ninguna directa; si se implementa el mecanismo definitivo (pop-up), el front recibiría la señal de `POST /internal/jobs/check-weekly-updates` (no-op hoy).

---

## 4. Perfil Usuario (`/users`)

**Endpoints:**

- `GET /users/me` → `User` (email, role, gymId, entrenadorId)
- `PUT /users/me/perfil` → `perfilPublico`
- `GET /users/me` también devuelve `entrenadorId` (si es cliente) o `gymId` (si es entrenador con gym personal)

**Botones:**

- `Actualizar perfil` → `PUT /users/me/perfil`
- `Ver datos` → `GET /users/me`
  **Notificaciones:** ninguna.

---

## 5. Gimnasios — Admin (`/admin/gyms`)

**Endpoints (JWT + `admin`):**

- `GET /admin/gyms` → lista liviana
- `GET /admin/gyms/:id` → completa (`aiConfig`, `whatsappConfig`, `timezone`, etc.)
- `POST /admin/gyms` → alta con `name`, `businessName`, `cuit`, `adminEmail`, `aiProvider` opcional
- `PUT /admin/gyms/:id` → edición (todos opcionales)
- `DELETE /admin/gyms/:id` → soft delete

**Contratos:** ver `docs/API_ENDPOINTS.md` §3 para las tres proyecciones (liviana, completa, reducida).  
**Botones:**

- `Crear gimnasio` (`POST /admin/gyms`)
- `Editar` (`PUT /admin/gyms/:id`)
- `Eliminar` (`DELETE /admin/gyms/:id`)
- `Configurar AI` (`PUT /gyms/settings/ai-prompt` con `?gymId=`)
- `Configurar WhatsApp` (`PUT /gyms/settings/whatsapp`)
- `Configurar AFIP` (`PUT /gyms/settings/afip` + `multipart/form-data` para `PUT /gyms/settings/afip/credenciales`)
- `Configurar Google Form` (`PUT /gyms/settings/google-form` + `POST /gyms/settings/google-form/rotate-secret`)
- `Configurar Mercado Pago` (`PUT /gyms/settings/mercadopago/credenciales` + `DELETE /gyms/settings/mercadopago`)
- `Configurar planes de membresía` (`PUT /gyms/settings/membership-plans` — reemplaza completo)

**Notificaciones:** ninguna en esta pantalla. El mecanismo definitivo (pop-up) se activa a nivel global o por evento externo.

---

## 6. Clientes (`/clients`)

**Endpoints (JWT + tenant):**

- `GET /clients` / `GET /clients/search` → paginado (`clientId?`, `query?`, `estado?`)
- `GET /clients/expiring?days=7`
- `GET /clients/:id`
- `POST /clients` (mínimo: `nombre`, `documento`)
- `PUT /clients/:id`
- `PATCH /clients/:id/encuesta`
- `POST /clients/:id/contacto` (idempotente)
- `POST /clients/:id/formulario-enviado`
- `POST /clients/:id/renew` (cobro efectivo, con `tipoPlan` o `monto`)
- `POST /clients/:id/renewal-requests` (link MP)
- `GET /clients/:id/renewal-requests`
- `DELETE /clients/:id`

**Botones:**

- `Buscar` (`GET /clients/search`)
- `Crear socio` (`POST /clients`)
- `Editar` (`PUT /clients/:id`)
- `Enviar formulario` (`POST /clients/:id/formulario-enviado`)
- `Renovar en efectivo` (`POST /clients/:id/renew`)
- `Pedir link MP` (`POST /clients/:id/renewal-requests`)
- `Eliminar` (`DELETE /clients/:id`)
  **Notificaciones:** ninguna directa; si se activa el mecanismo definitivo (pop-up/mobile), podría notificarse al socio o al operador sobre renovaciones pendientes.

---

## 7. Rutinas (`/routines`) — Fase 5

**Pantalla: Listado (`GET /routines`)**

- Query: `gymId?` (admin), `clientId?`, `estadoEnvio?`, `estadoGeneracion?`, `vencimientoDesde?`, `vencimientoHasta?`
- Botón: `Generar rutina` (`POST /routines/generate/:clientId`)
- Botón: `Ver PDF` (`GET /routines/:id/pdf`)
- Botón: `Reenviar WhatsApp` (`POST /routines/:id/resend`)
- Botón: `Eliminar` (`DELETE /routines/:id`)

**Pantalla: Detalle (`GET /routines/:id`)**

- Botón: `Editar contenido` (`PUT /routines/:id/contenido`) → requiere `estadoGeneracion: 'generado'`
- Botón: `Ver actualizaciones` (`GET /routines/:id/updates`)
- Botón: `Enviar actualización` (`POST /routines/:id/updates` — `semana`, `datos`)
- Botón: `Ver comentarios` (`GET /routines/:id/comments`)
- Botón: `Comentar` (`POST /routines/:id/comments` — `texto` ≤ 2000 chars)

**Pantalla: Mi Rutina (`GET /routines/me`)** — cliente

- Muestra las rutinas del cliente autenticado (`ownClientMiddleware`)
- Botones: `Ver PDF`, `Enviar actualización` (`POST /routines/:id/updates`), `Comentar` (`POST /routines/:id/comments`)

**Pantalla: Seguimiento del Entrenador (`GET /routines/seguimiento`)**

- Equivale a `GET /trainer/dashboard/seguimiento`
- Muestra `RoutineProgressUpdate` con `estado: 'pendiente_revision'`
- Botón: no hay acción directa; es un dashboard de lectura

**Contratos nuevos (`RoutineComment`, `RoutineProgressUpdate`):**

- `RoutineComment`: `{ id, gymId, routineId, clientId, autorUserId, autorRol: 'entrenador | cliente', texto, createdAt }`
- `RoutineProgressUpdate`: `{ id, gymId, routineId, clientId, semana, datos, estado: 'pendiente_revision | revisado', createdAt, updatedAt }`
- Índices Mongo únicos: `{ gymId, routineId, createdAt }` (comment) y `{ gymId, clientId, semana }` (update)

**Notificaciones (Fase 6):**

- El mecanismo definitivo es **pop-up en dispositivos móviles** (trabajado en el front).
- El backend mantiene `INotificationProvider` (`NoOpNotificationProvider` actual) y expone `POST /internal/jobs/check-weekly-updates` para ser consumido por el front o por un cron que active la notificación.
- En esta pantalla (`seguimiento`), el front mostraría las actualizaciones pendientes y, si el mecanismo está activo, emitirá la notificación correspondiente al cliente o al entrenador.

---

## 8. Check-ins (`/checkins`)

**Endpoint:** `POST /checkins` (`clientId`, `fecha` opcional) → idempotente por día (zona del gym)  
**Botones:** `Registrar ingreso`
**Notificaciones:** ninguna directa. Si se activa el mecanismo definitivo, podría notificar al cliente o al operador que un socio llegó (aunque hoy no está implementado).

---

## 9. Onboarding (`/onboarding`)

**Endpoint:** `POST /onboarding/webhook` (`public`, header `x-webhook-secret`)  
**Botones:** no aplica directamente al front; es llamado por Google Apps Script. El front consume `GET /onboarding/status` para ver `submissions`, `procesadas`, `ultimaRecibidaEn`.
**Notificaciones:** ninguna.

---

## 10. Facturación (`/invoices`)

**Endpoints:**

- `GET /invoices` (paginado, filtros: `clientId?`, `estado?`, `tipoComprobante?`, `cae?`, `emitidaDesde?`/`emitidaHasta?`)
- `GET /invoices/revenue`
- `GET /invoices/:id`
- `POST /invoices/:id/retry` (solo si `estado === 'error'`)

**Botones:**

- `Ver factura`
- `Reintentar emisión`
  **Contratos:** ver `docs/API_ENDPOINTS.md` §10 para los tipos (`Factura A` — código 1, `Factura B` — código 6, `Factura C` — código 11). `monto` en PESOS, `neto`/`iva` opcionales.
  **Notificaciones:** ninguna en esta fase.

---

## 11. Uso de IA (`/ai-usage`)

**Endpoints:** `GET /ai-usage`, `GET /ai-usage/report`  
**Botones:** `Ver consumo`  
**Notificaciones:** ninguna.

---

## 12. Dashboard (`/dashboard`)

**Pantalla: Resumen (`GET /dashboard`)**

- Datos: `clientesActivos`, `clientesRecurrentes`, `rutinasPorVencer` (`en7Dias`, `en5Dias`, `en3Dias`), `rutinasSinEnviar`, `ingresos` (`mesActual`, `mesPrevio` en PESOS)
- Botón: `Ir a KPIs`

**Pantalla: KPIs (`GET /dashboard/kpis`)**

- Query: `gymId?` (admin), `desde`/`hasta` (`yyyy-MM-dd`, opcionales pero juntos)
- Datos: `socios` (`activos`, `enGracia`, `altasEnPeriodo`, `bajasEnPeriodo`, `crecimientoNeto`), `retencion` (`churnMensual`, `tasaRetencion`, `cohorte90Dias`), `financiero` (`ingresosPeriodo` en CENTAVOS, `mrr`, `arpu`, `ltv`), `engagement` (`visitasPorSocioPorSemana`, `enRiesgo`), `embudo`
- Botón: `Ver serie mensual` (`GET /dashboard/kpis/series?meses=12`)
- Botón: `Ver resumen global` (`GET /dashboard/summary` — cross-gym, `admin`)

**Notificaciones:** ninguna directa. El mecanismo definitivo (pop-up) podría notificar al operador del gym sobre métricas críticas (ej. `rutinasSinEnviar` > 0, `enRiesgo` > umbral), aunque hoy no está implementado.

---

## 13. Marketplace / Entrenadores (`/entrenadores`, `/users/:id/entrenador`)

**Endpoint:** `GET /entrenadores` (búsqueda pública, paginación, whitelist sin credenciales)  
**Botones:** `Seleccionar entrenador` (`PUT /users/:id/entrenador`)  
**Notificaciones:** ninguna hoy; con mecanismo definitivo, podría confirmarse la asignación con una notificación al cliente o al entrenador.

---

## 14. Notificaciones (Fase 6 — mecanismo definitivo)

**Estado actual:** `NoOpNotificationProvider` (log en consola).  
**Puerto (`INotificationProvider`):** `notificarSeguimiento(clientId, gymId, mensaje)`  
**Endpoint que expone la verificación:** `POST /internal/jobs/check-weekly-updates` (`internalAuthMiddleware`)

**Pantalla del front (mecanismo definitivo — pop-up mobile):**

- El front consume `POST /internal/jobs/check-weekly-updates` (o recibe una señal del cron externo) para saber qué clientes requieren notificación.
- Por cada cliente en `pendiente_revision` con más de 3 días (umbral de falsos positivos), el front muestra un **pop-up en el dispositivo móvil** del cliente (o del entrenador, según configuración) con el mensaje: `"Seguimiento pendiente de la semana X"`.
- El botón `Activar notificación` (o similar) en la pantalla del cliente o del entrenador dispara el flujo que consume el caso de uso (`CheckWeeklyUpdatesUseCase`) y luego activa la notificación mediante el adaptador real (aún no implementado; el puerto `INotificationProvider` deja la integración abierta).

**Botones asociados:**

- `Ver seguimientos pendientes` (`GET /routines/seguimiento`) → muestra los que requieren notificación
- `Notificar` (en el front, activa el mecanismo definitivo: pop-up) → consume `CheckWeeklyUpdatesUseCase` (o su resultado) para emitir la notificación al usuario
- `Confirmar recepción` (en el pop-up del cliente) → podría registrar que la notificación fue vista (no hay endpoint hoy; podría agregarse en futuras versiones)

**Contratos de notificación (propuestos para el mecanismo definitivo):**

```json
// Señal que el front recibe del backend (resultado del job)
{
  "status": "success",
  "data": {
    "notificados": 2,
    "clientes": ["clientId1", "clientId2"],
    "mensaje": "Seguimiento pendiente de la semana 3"
  }
}
```

**Nota:** El mecanismo definitivo (pop-up en mobile) es del front; el backend solo mantiene el puerto (`INotificationProvider`) y expone el caso de uso (`CheckWeeklyUpdatesUseCase`) para ser integrado. El archivo `README.md` y `SCREENS_FRONT.md` documentan esta separación.

---

## Apéndice A — Flujos de navegación (mapas entre pantallas)

### Flujo Entrenador independiente (autónomo)

```
Login (`POST /auth/login`) → Registro (`POST /auth/register/entrenador` /
`POST /users` con `role: entrenador`) → Perfil (`GET /users/me`, `PUT /users/me/perfil`)
→ Dashboard (`GET /dashboard` si es `gym`, o `GET /routines/seguimiento` si es entrenador)
→ Configuración del Gym personal (`PUT /gyms/settings/*` con `?gymId=`)
```

### Flujo Cliente autónomo (B2B2C)

```
Login (`POST /auth/login`) → Registro (`POST /users` `role: cliente`,
`entrenadorId: null`) → Encuesta (`PATCH /survey/pending`) →
Marketplace (`GET /entrenadores`) → Seleccionar (`PUT /users/:id/entrenador`)
→ Ficha cliente (`GET /clients/me`) → Rutinas (`GET /routines/me`)
```

### Flujo Rutina completa (entrenador)

```
Listado (`GET /routines`) → Generar (`POST /routines/generate/:clientId`)
→ Detalle (`GET /routines/:id`) → Editar (`PUT /routines/:id/contenido`)
→ Actualizaciones (`GET /routines/:id/updates`, `POST /routines/:id/updates`)
→ Comentarios (`GET /routines/:id/comments`, `POST /routines/:id/comments`)
→ Seguimiento (`GET /routines/seguimiento`)
```

### Flujo Cliente (consumo)

```
Rutinas (`GET /routines/me`) → Ver PDF (`GET /routines/:id/pdf`)
→ Enviar actualización (`POST /routines/:id/updates`)
→ Comentar (`POST /routines/:id/comments`)
```

---

## Apéndice B — Estados de carga / error por endpoint clave

| Pantalla / Endpoint                        | Estado carga                   | Estado error                                                                       | Mensaje / acción del front                                            |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `POST /auth/login`                         | Spinner en botón               | `401` (credenciales) / `500`                                                       | Mostrar mensaje; no redirigir                                         |
| `PUT /routines/:id/contenido`              | Spinner                        | `400` (`estadoGeneracion` no es `generado`) / `404` / `403`                        | Alertar: "La rutina debe estar en estado 'generado' para ser editada" |
| `POST /routines/:id/updates`               | Spinner                        | `404` (rutina no existe) / `400` (cliente no coincide) / `404` (cliente no existe) | Validar `clientId` del JWT antes de enviar                            |
| `POST /routines/:id/comments`              | Spinner                        | `400` (`texto` vacío o > 2000) / `403` (rol incorrecto)                            | Truncar/validar texto en input                                        |
| `GET /routines/seguimiento`                | Skeleton / loader              | `404` (no hay datos) / `403` (no es entrenador)                                    | Mostrar mensaje "No hay seguimientos pendientes"                      |
| `POST /clients/:id/renew`                  | Spinner                        | `400` (`tipoPlan` no configurado / `monto` negativo) / `404` / `403`               | Validar plan en catálogo del gym                                      |
| `POST /clients/:id/renewal-requests`       | Spinner                        | `503` (`mercadoPagoConfig` no cargado) / `400` (plan no configurado)               | Alertar que el gym debe configurar MP                                 |
| `POST /internal/jobs/check-weekly-updates` | Spinner (si expuesto al admin) | `401` (secreto) / `503` (secreto no configurado) / `429`                           | Solo llamado por cron o por admin con acceso a `x-internal-secret`    |

---

## Apéndice C — Pantallas de Servicios (Fase 4) — faltante en versión inicial

Aunque no estaban documentadas explícitamente en el archivo original, el sistema incluye servicios (`Gym.servicios`) que requieren pantalla en el front:

### Pantalla: Catálogo de Servicios (`PUT /gyms/settings/servicios`)

- **Endpoint:** `PUT /gyms/settings/servicios`
- **Botones:** `Agregar servicio`, `Editar servicio`, `Eliminar servicio`
- **Contratos:** `servicios: [{ id, nombre, descripcion, precio }]`
- **Notificaciones:** ninguna hoy

### Pantalla: Pago de Servicio (`POST /services/:servicioId/payment-links`)

- **Endpoint:** `POST /services/:servicioId/payment-links`
- **Botones:** `Generar link de pago`
- **Contratos:** `{ servicioId: "string", gymId: "string" }` → `{ initPoint, externalReference, estado: "pendiente" }`
- **Webhooks:** `POST /mercadopago/webhook` (mismo mecanismo que renovación; busca `ServicePaymentRequest` por `externalReference`)
- **Notificaciones:** ninguna hoy; con mecanismo definitivo, podría confirmarse el pago con pop-up

### Pantalla: Configuración de Servicios (`GET /gyms/settings` — bloque `servicios`)

- Ya cubierto por la pantalla `Gimnasios — Admin` (§5), pero se menciona explícitamente aquí para completar el panorama.

---

## Apéndice D — Notas del mecanismo definitivo (pop-up / mobile)

- **Responsabilidad del front:** implementar las pantallas que reciben la señal de `POST /internal/jobs/check-weekly-updates` y muestran el pop-up al usuario (entrenador o cliente).
- **Responsabilidad del backend (esta versión):** `NoOpNotificationProvider` (log), `CheckWeeklyUpdatesUseCase` (umbral 3 días), `INotificationProvider` (puerto), endpoint `POST /internal/jobs/check-weekly-updates` (`internalAuthMiddleware`).
- **Integración futura:** reemplazar `NoOpNotificationProvider` por el adaptador del canal elegido (WhatsApp, email, push nativo, etc.) sin modificar los casos de uso.
- **Evento de activación:** el front puede consumir `GET /routines/seguimiento` (pendientes de revisión) y, si el mecanismo está activo, disparar la notificación para cada cliente pendiente con más de 3 días.

| Entidad / Endpoint                         | Campos clave                                                                                  | Notas                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `RoutineComment`                           | `id`, `gymId`, `routineId`, `clientId`, `autorUserId`, `autorRol`, `texto`, `createdAt`       | Índice `{gymId, routineId, createdAt}`                                                     |
| `RoutineProgressUpdate`                    | `id`, `gymId`, `routineId`, `clientId`, `semana`, `datos`, `estado`, `createdAt`, `updatedAt` | Índice único `{gymId, clientId, semana}`                                                   |
| `PUT /routines/:id/contenido`              | `contenidoEditado`                                                                            | Solo si `estadoGeneracion === 'generado'`; guarda `contenidoOriginalIA` en primera edición |
| `GET /routines/:id/updates`                | Array de `RoutineProgressUpdate`                                                              | Sin paginación                                                                             |
| `POST /routines/:id/updates`               | `semana`, `datos`                                                                             | Upsert por `{gymId, clientId, semana}`                                                     |
| `GET /routines/:id/comments`               | Array de `RoutineComment` (cronológico)                                                       | ---                                                                                        |
| `POST /routines/:id/comments`              | `texto`                                                                                       | `texto` ≤ 2000 chars; `autorRol` del JWT                                                   |
| `GET /routines/me`                         | `Routine[]` del cliente autenticado                                                           | Usa `ownClientMiddleware`                                                                  |
| `GET /routines/seguimiento`                | `RoutineProgressUpdate[]` (`pendiente_revision`)                                              | `requireEntrenador`                                                                        |
| `POST /internal/jobs/check-weekly-updates` | `notificados`                                                                                 | `NoOpNotificationProvider`; evita falsos positivos con umbral 3 días                       |

---

## Notas de implementación del mecanismo definitivo (pop-up mobile)

- **Responsabilidad del front:** el mecanismo de notificación definitivo es una serie de notificaciones pop-up en los dispositivos móviles. Esto se implementa en la capa de presentación (front-end) y puede integrarse con servicios como Firebase Cloud Messaging, OneSignal, o notificaciones nativas.
- **Responsabilidad del backend (esta versión):** el backend expone:
  1. El puerto `INotificationProvider` (`domain/services`)
  2. El caso de uso `CheckWeeklyUpdatesUseCase`
  3. El endpoint `POST /internal/jobs/check-weekly-updates` (protegido por `internalAuthMiddleware`)
  4. El adaptador inicial `NoOpNotificationProvider` (log) para evitar falsos positivos y no depender de un canal concreto
- **Integración futura:** cuando el mecanismo definitivo (pop-up/mobile) esté implementado en el front, se reemplaza `NoOpNotificationProvider` por el adaptador real (por ejemplo, un proveedor que envíe la señal al servicio de notificaciones del dispositivo del cliente o del entrenador).
- **Verificación de falsos positivos:** `CheckWeeklyUpdatesUseCase` incluye un umbral de 3 días (`umbralFalsoPositivoMs`) para evitar notificar sobre `RoutineProgressUpdate` recién creados, protegiendo a clientes recién asignados.
