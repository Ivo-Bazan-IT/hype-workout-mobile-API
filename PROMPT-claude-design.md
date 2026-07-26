# Prompt para Claude Design — CRM Hype Workout

> Copiar desde la línea siguiente hacia abajo y pegarlo en Claude Design.
> Adjuntar también `API-documentacion.md` si la herramienta lo permite.

---

## Contexto del producto

Diseñá la interfaz de **Hype Workout**, un CRM SaaS multi-tenant para gimnasios en
Argentina. Su función distintiva: genera **rutinas de entrenamiento personalizadas con IA**
a partir de una encuesta que completa cada socio, las convierte en PDF y se las envía por
WhatsApp automáticamente.

Hay **dos productos dentro de la misma app**, con navegación y permisos separados:

- **CRM del gimnasio** (rol `gym`): lo usa el dueño para gestionar socios, rutinas,
  facturación y la configuración de su gimnasio.
- **Panel de super-admin** (rol `admin`): lo usa el operador de la plataforma para dar de
  alta gimnasios, gestionar sus usuarios y auditar cualquier tenant.

Más una **landing pública** de captación.

El backend ya está construido y documentado (44 endpoints REST). El diseño tiene que poder
cablearse a esa API tal como está — abajo van las restricciones que eso impone.

---

## Registro visual

Son dos registros distintos, no los unifiques:

- **Landing:** marketing. Puede respirar, tener imágenes grandes, jerarquía tipográfica
  fuerte, secciones de beneficios y precios.
- **Aplicación (ambos CRM):** herramienta de trabajo B2B, **densa en datos**. Tablas,
  filtros, KPIs, formularios. Prioridad: escaneabilidad y cantidad de información útil por
  pantalla, no espectacularidad. El dueño de gimnasio la usa todos los días desde una
  notebook, y a veces desde el celular en el piso del gimnasio.

**Idioma: español rioplatense (es-AR).** Toda la UI en español. Contexto local: CUIT, AFIP,
monotributo, importes en pesos argentinos, fechas `dd/mm/aaaa`.

Proponé el sistema de diseño (paleta, tipografía, escala de espaciado, componentes base).
No hay manual de marca previo. El nombre es "Hype Workout" — gimnasio, energía, pero el
producto es una herramienta de gestión: evitá que parezca una app de fitness para el
consumidor final.

**Responsive obligatorio.** Las tablas de datos deben tener una estrategia explícita en
mobile (cards apiladas o scroll horizontal contenido, decidilo y aplicalo consistente).

---

## Restricciones del backend que condicionan el diseño

Estas no son sugerencias: son cómo funciona la API. Diseñar contra ellas produce pantallas
que no se pueden implementar.

### 1. El super-admin necesita un selector de gimnasio persistente

Todas las rutas de datos de tenant (`/api/clients`, `/api/routines`, `/api/invoices`,
`/api/ai-usage`, `/api/gyms/settings`, `GET /api/dashboard`) exigen saber sobre qué
gimnasio se opera:

- El rol `gym` lo resuelve solo (sale de su sesión).
- El rol `admin` **debe indicarlo explícitamente**, y si no lo hace la API responde error.

Esto significa que el panel de admin necesita un **selector de gimnasio siempre visible y
persistente** (en el shell, no dentro de cada pantalla), y un estado claro de "todavía no
elegiste gimnasio" que bloquee o guíe. Cuando hay uno seleccionado, tiene que ser
**imposible de ignorar** que estás viendo datos de ese tenant y no globales — es la
principal fuente de error operativo del panel.

### 2. Los secretos nunca se muestran, ni una vez

Las credenciales de cada gimnasio (API key de IA, token de WhatsApp, API key de AFIP) se
guardan cifradas y **la API jamás las devuelve**. Solo informa un booleano: está cargada o
no.

Patrón de diseño obligatorio para los tres campos de credenciales:

- Estado "no configurada" → campo vacío + explicación de dónde conseguirla.
- Estado "configurada" → **nunca** un input con puntitos ni un valor enmascarado falso.
  Mostrá un indicador de configurada y una acción de **reemplazar**, que abre un campo
  vacío. No existe "ver la actual".

### 3. Generar una rutina es lento y puede fallar a mitad

Es el flujo central y el endpoint más lento de la API: llama al modelo de IA, arma el PDF y
lo manda por WhatsApp, todo en una sola petición sincrónica que puede tardar bastante.

Necesita una pantalla o modal de **progreso real con pasos visibles** (generando →
armando PDF → enviando), no un spinner genérico. Y estados de error diferenciados, porque
las causas son distintas y accionables:

- El socio no completó la encuesta → llevar a cargarla.
- El gimnasio no tiene API key de IA cargada → llevar a configuración.
- Falló el proveedor o el PDF → permitir reintentar.

### 4. Una rutina generada puede no haber sido enviada

Una rutina tiene **dos estados independientes**: generación y envío. Si al gimnasio le
falta el número de WhatsApp o su token, o el socio no tiene teléfono, la rutina se genera
correctamente pero **queda sin enviar**.

El diseño tiene que hacer esa diferencia **visible de un vistazo** en listados y en la
ficha, y ofrecer reenviar. Una rutina generada-pero-no-enviada es un problema operativo:
el socio no recibió nada.

### 5. Distinguir "sin datos" de "no configurado"

Aparece en varios lugares y es la diferencia entre un vacío tranquilizador y uno alarmante:

- **Facturación:** solo cuentan como ingreso las facturas emitidas correctamente. Las que
  fallaron quedan registradas para auditoría pero **no suman**. Un listado con facturas en
  error tiene que verse distinto de uno vacío.
- **Consumo de IA:** el reporte informa cuántas generaciones quedaron **sin precio
  calculado**. Si ese número es mayor a cero, el costo total está subestimado y hay que
  advertirlo en la UI: si no, un costo bajo se lee como "gastamos poco" cuando en realidad
  es "faltan datos".

### 6. La encuesta del socio es el insumo crítico

Sin encuesta completada **no se puede generar la rutina**. Sus preguntas son de formato
libre (las define cada gimnasio en su Google Form), así que la UI tiene que renderizar
**pares clave-valor dinámicos**, no un formulario de campos fijos.

La encuesta se completa **en varias tandas** sin perder lo anterior. El diseño debe
reflejar que es incremental.

Consecuencia para los listados de socios: "tiene encuesta / no tiene encuesta" es un estado
tan importante como "activo / inactivo", porque determina si se le puede generar rutina.

### 7. Formularios con errores por campo

La API devuelve errores de validación **campo por campo**. Diseñá los formularios para
mostrar el error debajo del campo correspondiente, no como un cartel genérico arriba.

También hay límite de intentos de login: después de varios fallos seguidos se bloquea
temporalmente por IP. Necesita su propio estado, distinto de "contraseña incorrecta".

### 8. La sesión expira sola

El acceso dura poco y se renueva en segundo plano. Diseñá el estado de **sesión expirada**
(cuando la renovación falla) como una interrupción elegante que no pierda el trabajo en
curso del formulario abierto.

---

## Inventario de pantallas

### A. Público (sin sesión)

**A1. Landing page**
Presentación del producto. Secciones: hero con la propuesta de valor (rutinas con IA
enviadas por WhatsApp), cómo funciona en 3-4 pasos, beneficios para el dueño de gimnasio,
prueba social, planes y precios, CTA final, footer.
Acciones: solicitar cuenta, iniciar sesión.

**A2. Planes y precios**
Comparativa de planes: **prueba gratuita** y **plan pago**. Con toggle mensual/anual si lo
considerás apropiado.
⚠️ *Sin backend hoy — ver "Fuera de alcance".*

**A3. Solicitud de cuenta**
Formulario de alta de un gimnasio interesado: datos del negocio (nombre, razón social,
CUIT, email y teléfono de contacto) y datos de la persona responsable.
⚠️ *Sin backend hoy: no existe registro automático. Diseñala como **captación de lead**,
con una pantalla de confirmación honesta del tipo "recibimos tu solicitud, te contactamos
para activar la cuenta" — no como un alta instantánea que da acceso.*

**A4. Login**
Email y contraseña. Es la **puerta única para ambos roles**: el destino después de entrar
depende del tipo de cuenta, pero la pantalla es la misma.
Estados: credenciales incorrectas, cuenta desactivada, demasiados intentos (bloqueo
temporal).
⚠️ *No incluyas "olvidé mi contraseña": no existe recuperación autogestionada. Si querés
poner algo, que sea un enlace a contacto/soporte.*

---

### B. CRM del gimnasio (rol `gym`)

**Shell:** navegación lateral con las secciones de abajo, barra superior con el nombre del
gimnasio, menú de usuario y **cerrar sesión**.

**B1. Dashboard**
Pantalla de entrada. KPIs: socios activos, socios recurrentes, rutinas por vencer (en 7 / 5
/ 3 días) e ingresos del mes actual comparados con el mes anterior.
Sumale accesos rápidos a las acciones frecuentes (generar rutina, dar de alta socio) y
avisos accionables: socios por vencer, rutinas generadas sin enviar, credenciales sin
configurar.

**B2. Socios — listado**
Tabla paginada con búsqueda por nombre o documento y filtro por estado (activo, inactivo,
pendiente). Columnas: nombre, documento, contacto, estado, vencimiento, **si tiene encuesta
cargada**. Acciones por fila: ver ficha, editar, generar rutina, renovar.

**B3. Socio — ficha de detalle**
Vista completa de un socio: datos personales, estado y vencimiento de la membresía,
respuestas de la encuesta (pares clave-valor dinámicos), historial de rutinas, historial de
renovaciones y facturas.
Acciones: editar, cargar/completar encuesta, generar rutina, renovar, dar de baja.

**B4. Socio — alta / edición**
Formulario. **Solo nombre y documento son obligatorios** — el resto (teléfono, email,
fechas) es opcional y se completa después. El diseño debe hacer evidente que el alta rápida
es válida y no castigar al usuario por dejar campos vacíos.

**B5. Socio — encuesta**
Carga y edición de las respuestas que alimentan a la IA. Formato clave-valor libre,
incremental (se completa en tandas). Debe mostrar claramente qué ya está cargado y permitir
agregar sin pisar lo anterior.

**B6. Socio — renovación**
Modal o pantalla corta: importe de la renovación. Al confirmar, extiende la membresía y —si
el gimnasio tiene facturación activa— emite la factura.
Estado importante: **la renovación se aplica aunque la facturación falle**. Hay que
comunicar ese resultado parcial sin que parezca un error total.

**B7. Socios por vencer**
Listado de socios cuya membresía vence en N días (N configurable). Orientado a la acción:
contactar, renovar.

**B8. Onboarding / captación de socios**
Explica y configura el circuito por el que entran los socios: un Google Form cuyas
respuestas llegan solas al CRM.
Contenido: estado de la conexión, identificador del formulario configurado, instrucciones
de puesta en marcha y últimas respuestas recibidas.
*No es un wizard de configuración inicial del producto: es la pantalla del canal de
entrada de socios.*

**B9. Rutinas — listado**
Todas las rutinas del gimnasio, con filtro por socio y por estado. **Doble estado visible:
generación y envío.** Acción destacada sobre las generadas-sin-enviar: reenviar.

**B10. Rutina — generación (proceso)**
El flujo con pasos visibles descrito en la restricción 3. Incluí los estados de error
diferenciados y accionables.

**B11. Rutina — detalle**
La rutina generada: contenido del plan de entrenamiento, vista previa y descarga del PDF,
estado de generación y de envío, fecha, vencimiento.
Incluí una sección plegable de **auditoría**: el prompt exacto que recibió el modelo. Es
para cuando una rutina sale rara y hay que entender por qué. Que no compita visualmente con
el contenido.

**B12. Facturación — listado**
Facturas emitidas, con filtros por socio, estado, tipo de comprobante, número de CAE y
rango de fechas. Las **facturas con error** necesitan tratamiento visual propio: son un
cobro que no se pudo documentar.

**B13. Facturación — reporte de ingresos**
Ingresos de un período con desglose mensual (gráfico + tabla) y selector de rango. Es la
pantalla de "cuánto facturé".

**B14. Consumo de IA**
Cuánto está consumiendo el gimnasio en generación de rutinas: total de tokens, costo
estimado, cantidad de rutinas, desglose por mes y por modelo, y el detalle rutina por
rutina.
Incluí el aviso de "generaciones sin precio calculado" de la restricción 5.

**B15. Configuración — Inteligencia Artificial** ⭐
**La pantalla más importante y más difícil del producto.** Acá el dueño escribe, en texto
libre, la plantilla de instrucciones con la que la IA arma las rutinas: describe su
equipamiento, sus espacios, sus restricciones y su tono.

Necesita:
- Un **editor de texto amplio** con inserción de **variables** (`{{cliente_nombre}}`,
  `{{respuestas_encuesta}}`, `{{gym_nombre}}`, fechas, etc.) — hay 9 en total. Que se
  puedan insertar haciendo clic, no escribiéndolas de memoria.
- **Validación con explicación clara**: se rechaza una plantilla sin ninguna variable
  (produciría rutinas genéricas para todos) o con una variable mal escrita. El mensaje debe
  decir qué está mal y cuáles son las válidas.
- Selección de **proveedor de IA** y modelo.
- Carga de la **API key propia** (patrón de la restricción 2).
- Idealmente, una **vista previa** de cómo queda la plantilla con datos de ejemplo.

Un usuario no técnico tiene que poder usar esto sin miedo. Es el mayor riesgo de UX del
producto: si escribe mal la plantilla, todas sus rutinas salen mal.

**B16. Configuración — WhatsApp**
Número de teléfono del gimnasio y su token de acceso (patrón de la restricción 2).
Explicá que **las tres cosas** hacen falta para que el PDF se envíe: el número, el token y
el teléfono del socio.

**B17. Configuración — Facturación (AFIP)**
Punto de venta, condición fiscal (monotributo / responsable inscripto / exento), API key
(patrón de la restricción 2) y un interruptor de activación. Si está desactivada, las
renovaciones no emiten factura — decilo explícitamente en la pantalla.

**B18. Configuración — Datos del gimnasio**
Nombre, razón social, CUIT, email y teléfono de contacto. Mayormente lectura: aclarar qué
se edita desde acá y qué requiere pedirlo a soporte.

---

### C. Panel de super-admin (rol `admin`)

**Shell:** navegación propia, visualmente distinguible del CRM de gimnasio para que nunca
haya duda de en qué panel estás. **Selector de gimnasio persistente** (restricción 1). Menú
de usuario y **cerrar sesión**.

**C1. Dashboard de plataforma**
Visión global: cantidad de gimnasios activos, altas recientes, salud general.
⚠️ *El endpoint que lo alimenta hoy es un placeholder sin datos reales. Diseñá la pantalla
completa igual, pero contemplá un estado "métricas no disponibles todavía".*

**C2. Gimnasios — listado**
Tabla de todos los gimnasios: nombre, razón social, CUIT, contacto, estado.
Acciones: ver, editar, desactivar, **y "entrar" al gimnasio** (que lo selecciona y habilita
las pantallas de C4).

**C3. Gimnasio — alta**
Formulario que crea el gimnasio **y su primer usuario dueño en un solo paso**: datos del
negocio + credenciales de acceso del dueño. Que quede claro que son dos cosas creándose
juntas.

**C4. Gimnasio — vista de tenant**
El admin, con un gimnasio seleccionado, accede a sus pantallas: dashboard, socios, rutinas,
facturación, consumo de IA y configuración.
**Reutilizá las pantallas de la sección B**, con un indicador permanente e inconfundible de
"estás viendo/operando el gimnasio X". El admin puede tanto leer como escribir.

**C5. Gimnasio — edición**
Edición de los datos del gimnasio.
⚠️ *Esta pantalla tiene una trampa real: guardar la configuración de IA o de WhatsApp desde
acá **borra las credenciales cargadas** del gimnasio. Diseñá una advertencia visible, o
directamente sacá esos bloques de este formulario y remitilos a las pantallas de
configuración del tenant.*

**C6. Usuarios — listado**
Usuarios dueños de gimnasio, con búsqueda por nombre o email y filtros por gimnasio y
estado. Columnas: nombre, email, gimnasio al que pertenece, estado.

**C7. Usuario — alta / edición**
Alta de un usuario dueño para un gimnasio existente, y edición de sus datos (nombre, email,
gimnasio asignado, activo/inactivo).
Nota: los usuarios administradores **no son editables** desde acá. Contemplá el estado
deshabilitado con su explicación.

**C8. Usuario — restablecer contraseña**
El admin define una contraseña nueva sin conocer la anterior. Contemplá cómo se le
comunica al dueño.

**C9. Consumo de IA por gimnasio**
Cuánto cuesta atender a cada tenant. Es la pantalla de negocio del operador de la
plataforma: permite ver qué gimnasio se dispara en consumo.

---

### D. Transversales

**D1. Estados de error de página completa:** sin permisos, recurso inexistente, error del
servidor.
**D2. Sesión expirada** (restricción 8).
**D3. Estados vacíos** de cada listado, con la acción que corresponda ("todavía no cargaste
socios" → dar de alta el primero).
**D4. Estados de carga:** esqueletos para tablas y KPIs.
**D5. Confirmaciones destructivas:** dar de baja socios, desactivar gimnasios y usuarios.
Todas las bajas del sistema son reversibles (desactivan, no borran) — que el texto lo
refleje y no asuste de más.

---

## Fuera de alcance (no lo diseñes como funcional)

- **Cobro de la suscripción a los gimnasios.** No existe integración de pagos. Las
  pantallas de planes y precios (A2) y de solicitud de cuenta (A3) son **presentación y
  captación**, sin checkout ni gestión de suscripción.
  ⚠️ *Cuidado con una confusión importante: el módulo de facturación del CRM (B12, B13) es
  el gimnasio facturándole a sus socios ante AFIP. No tiene nada que ver con la plataforma
  cobrándole al gimnasio. No los mezcles en la misma pantalla ni en la misma navegación.*
- **Recuperación de contraseña autogestionada.**
- **Anular o reintentar facturas.**
- **Registro público con acceso inmediato.**

---

## Entregable esperado

1. **Sistema de diseño**: paleta (con modo claro y oscuro si lo considerás), tipografía,
   espaciado, y los componentes base que se repiten (tabla de datos con filtros, tarjeta de
   KPI, formulario, modal, badges de estado, estados vacíos).
2. **Las pantallas del inventario**, en desktop, con las de mayor tráfico también en mobile
   (B1, B2, B3, B9).
3. **Los dos shells de navegación** (gimnasio y admin), mostrando la diferencia entre
   ambos.
4. Para las pantallas críticas (**B15**, B10, B3), los **estados**: vacío, cargando, con
   datos, con error.

Priorizá, si hay que recortar: **B15** (configuración de IA), **B10** (generación de
rutina), **B3** (ficha del socio), **B1** (dashboard) y **A4** (login). Son el corazón del
producto.

---

# Apéndice — Datos reales de la API

Usá **estos nombres de campo y estos valores** en los mockups. Están tomados del backend
real, no inventados. Que los textos de ejemplo sean verosímiles y en español rioplatense
(nombres argentinos, teléfonos `54911…`, importes en pesos).

## Envoltorio de respuesta

**Todo** viene envuelto. En los listados paginados eso produce un `data.data` anidado:

```json
{
  "status": "success",
  "data": { "data": [ /* … */ ], "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

Los listados paginados siempre traen `total`, `page`, `limit` y `totalPages` — diseñá el
paginador con esa información disponible (se puede mostrar "42 socios · página 1 de 3").

## Valores de estado (para los badges)

Son literales exactos. Traducilos para mostrar, pero no inventes estados que no existen.

| Entidad | Campo | Valores posibles |
|---|---|---|
| Socio | `estado` | `activo` · `inactivo` · `pendiente` |
| Rutina | `estadoGeneracion` | `pendiente` · `generando` · `generado` · `error` |
| Rutina | `estadoEnvio` | `pendiente` · `enviando` · `enviado` · `error` |
| Factura | `estado` | `emitida` · `anulada` · `error` · `pendiente` |
| Config IA | `provider` | `deepseek` · `openai` · `anthropic` |
| Config AFIP | `taxCondition` | `MONOTRIBUTO` · `RESPONSABLE_INSCRIPTO` · `EXENTO` |
| Usuario | `role` | `admin` · `gym` |

> **Cuáles aparecen de verdad hoy:** en rutinas, la generación recorre
> `pendiente → generando → generado` (o `error`), y el envío solo queda en `pendiente` o
> pasa a `enviado`. Los valores `enviando` y `estadoEnvio: error` están declarados pero hoy
> nunca se asignan. En facturas, `anulada` tampoco se usa (no hay anulación). Diseñá con
> foco en los que sí ocurren, pero que el componente de badge tolere cualquiera.

## Entidades

### Socio

```json
{
  "id": "66b1f2a4c8d3e01f5a846a1f",
  "gymId": "66a0e1b3c8d3e01f5a846a0e",
  "nombre": "Iván Bazán",
  "documento": "40123456",
  "telefono": "5491122334455",
  "email": "ivan@example.com",
  "estado": "activo",
  "fechaInicio": "2026-06-25T00:00:00.000Z",
  "fechaVencimiento": "2026-07-25T00:00:00.000Z",
  "esRecurrente": true,
  "historialRenovaciones": [
    { "fecha": "2026-05-25T14:30:00.000Z", "monto": 15000 },
    { "fecha": "2026-06-25T11:10:00.000Z", "monto": 18000 }
  ],
  "encuestaData": {
    "¿Cuál es tu objetivo?": ["Ganar masa muscular"],
    "¿Cuántos días podés entrenar?": "4",
    "¿Tenés lesiones?": "Hombro derecho",
    "Experiencia previa": "2 años"
  },
  "createdAt": "2026-05-25T14:30:00.000Z",
  "updatedAt": "2026-06-25T11:10:00.000Z"
}
```

Notas de diseño:

- `telefono`, `email` y `encuestaData` pueden **faltar por completo** (un socio se da de
  alta solo con nombre y documento). Diseñá la ficha con esos huecos, no asumas que están.
- **`encuestaData` tiene claves libres**: son las preguntas literales del Google Form de
  cada gimnasio, con signos de pregunta, tildes y espacios. Cada gimnasio tiene las suyas.
  Renderizá pares clave-valor dinámicos. Los valores pueden ser texto **o listas**.
- `esRecurrente` pasa a `true` a partir de la segunda renovación.
- Sin `encuestaData` (o vacía) **no se puede generar rutina**: es el estado que manda en el
  listado de socios.

### Rutina

```json
{
  "id": "66c1a3b5c8d3e01f5a846a2a",
  "gymId": "66a0e1b3c8d3e01f5a846a0e",
  "clientId": "66b1f2a4c8d3e01f5a846a1f",
  "estadoGeneracion": "generado",
  "estadoEnvio": "enviado",
  "fechaGeneracion": "2026-06-25T11:12:04.000Z",
  "fechaVencimiento": "2026-07-25T00:00:00.000Z",
  "pdfUrl": "storage/generated/66c1a3b5c8d3e01f5a846a2a.pdf",
  "whatsappMessageId": "wamid.HBgNNTQ5MTEyMjMzNDQ1NRUCABEYEjc…",
  "promptUsado": "Sos el entrenador de Hype Workout. EQUIPAMIENTO: 4 racks…",
  "contenidoGenerado": { "…": "estructura variable, ver abajo" },
  "createdAt": "2026-06-25T11:11:40.000Z",
  "updatedAt": "2026-06-25T11:12:31.000Z"
}
```

> ⚠️ **`contenidoGenerado` NO tiene una estructura fija.** Es el JSON que devolvió el
> modelo, y su forma depende de lo que cada gimnasio le haya pedido en su plantilla. Un
> gimnasio puede recibir `{ dias: [...] }`, otro `{ semana1: {...}, semana2: {...} }`, otro
> algo completamente distinto.
>
> **Consecuencia de diseño:** la pantalla de detalle de rutina (B11) **no puede** asumir
> columnas de "día / ejercicio / series / repeticiones". Necesita un renderizador genérico
> de JSON anidado que se vea bien: secciones plegables, listas, tablas cuando el contenido
> sea tabular. Diseñalo con **dos ejemplos de estructura distinta** para demostrar que
> aguanta.
>
> El PDF sí tiene formato fijo, así que la descarga es el camino "lindo" y la vista en
> pantalla es el camino "inspeccionable".

### Factura

```json
{
  "id": "66d1c4e6c8d3e01f5a846a3b",
  "gymId": "66a0e1b3c8d3e01f5a846a0e",
  "clientId": "66b1f2a4c8d3e01f5a846a1f",
  "tipoComprobante": "Factura C",
  "cae": "75123456789012",
  "monto": 18000,
  "fechaEmision": "2026-06-25T11:10:00.000Z",
  "estado": "emitida",
  "createdAt": "2026-06-25T11:10:00.000Z",
  "updatedAt": "2026-06-25T11:10:00.000Z"
}
```

Una factura **fallida** llega así — sin CAE y con el motivo:

```json
{
  "id": "66d1c4e6c8d3e01f5a846a3c",
  "clientId": "66b1f2a4c8d3e01f5a846a1f",
  "tipoComprobante": "Factura C",
  "cae": "",
  "monto": 18000,
  "estado": "error",
  "errorLog": "AFIP_API_VALIDATION_ERROR: {\"message\":\"Documento inválido\"}",
  "fechaEmision": "2026-06-25T11:10:00.000Z"
}
```

Notas de diseño:

- El listado devuelve `clientId`, **no el nombre del socio**. El front tiene que resolverlo
  aparte. Preveé el estado "cargando nombre" o diseñá la tabla para que el documento/ID sea
  aceptable como identificador secundario.
- `cae` vacío + `errorLog` con texto técnico es el caso de la factura fallida: **traducí ese
  mensaje a algo comprensible** y dejá el texto crudo disponible en un detalle expandible.
- `tipoComprobante` es texto libre del backend: hoy `"Factura C"` (monotributo) o
  `"Factura B"`.

### Registro de consumo de IA

```json
{
  "id": "66e1d5f7c8d3e01f5a846a4c",
  "gymId": "66a0e1b3c8d3e01f5a846a0e",
  "clientId": "66b1f2a4c8d3e01f5a846a1f",
  "routineId": "66c1a3b5c8d3e01f5a846a2a",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tokensPrompt": 1200,
  "tokensRespuesta": 2400,
  "tokensTotal": 3600,
  "costoEstimado": 0.002964,
  "createdAt": "2026-06-25T11:12:04.000Z"
}
```

> `costoEstimado` viene en **dólares** y con **6 decimales**: una rutina barata cuesta
> fracciones de centavo. Redondear a 2 decimales mostraría `$0.00` en casi todas.
> Decidí cómo presentarlo (por rutina puede convenir mostrar el acumulado, o un formato
> tipo `US$ 0,0030`). Puede venir en **`null`**: significa "modelo sin precio cargado", no
> "gratis". Mostralo como "sin tarifar", nunca como `$0`.

### Usuario (panel de admin)

```json
{
  "id": "66a1e2b4c8d3e01f5a846a10",
  "email": "dueno@hype.com",
  "name": "Iván Bazán",
  "role": "gym",
  "gymId": "66a0e1b3c8d3e01f5a846a0e",
  "isActive": true,
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-06-20T18:30:00.000Z"
}
```

La contraseña **nunca** viene en ninguna respuesta. `gymId` es `null` en los usuarios
`admin`.

---

## Respuesta por pantalla

### A4 · Login → `POST /api/auth/login`

```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "user": {
      "id": "66a1e2b4c8d3e01f5a846a10",
      "email": "dueno@hype.com",
      "name": "Iván Bazán",
      "role": "gym",
      "gymId": "66a0e1b3c8d3e01f5a846a0e"
    }
  }
}
```

**`user.role` decide a qué producto entra** (`gym` → CRM del gimnasio, `admin` → panel de
plataforma). Es el único dato de ruteo tras el login.

### B1 · Dashboard del gimnasio → `GET /api/dashboard`

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

Son **exactamente estos 4 bloques**: no hay serie temporal ni desglose acá. Un gráfico de
evolución en el dashboard necesitaría el reporte de ingresos (B13) como segunda llamada —
si lo diseñás, tenelo presente.

`rutinasPorVencer` son tres cortes **acumulativos y anidados** (los que vencen en 3 días
también están contados en los de 7): no los presentes como categorías excluyentes de una
torta.

### B2 · Socios → `GET /api/clients`

Paginado de **Socio**. Filtros disponibles: texto (nombre o documento), `estado`, `page`,
`limit`.

### B3 · Ficha del socio

Se arma con **tres llamadas**: el socio (`GET /api/clients/:id`), sus rutinas
(`GET /api/routines/client/:clientId`, devuelve un array plano sin paginar) y sus facturas
(`GET /api/invoices?clientId=…`). Diseñá la carga por secciones: el encabezado puede
mostrarse antes de que lleguen las otras dos.

### B6 · Renovación → `POST /api/clients/:id/renew`

Devuelve **el socio actualizado**, no la factura. La confirmación tiene que leer del socio
(nueva `fechaVencimiento`, `historialRenovaciones` con la entrada nueva). Para saber si la
factura salió hay que ir a facturación: por eso el mensaje de éxito debe ser honesto sobre
lo que confirma y lo que no.

### B9 · Rutinas → `GET /api/routines/client/:clientId`

Array plano de **Rutina**, sin paginación ni envoltorio de página:

```json
{ "status": "success", "data": [ /* Rutina, Rutina, … */ ] }
```

`GET /api/routines/expiring?days=7` devuelve solo un conteo:

```json
{ "status": "success", "data": { "count": 12, "days": 7 } }
```

### B10 · Generación de rutina → `POST /api/routines/generate/:clientId`

Éxito (llega **cuando todo el proceso terminó**, puede tardar):

```json
{ "status": "success", "message": "Routine generated successfully", "data": { "routineId": "66c1a3b5c8d3e01f5a846a2a" } }
```

La respuesta **no dice si se envió por WhatsApp**. Para saberlo hay que leer la rutina
(`estadoEnvio`). La pantalla de éxito debería hacer esa segunda consulta antes de afirmar
"enviada al socio".

Errores con mensaje literal, cada uno con su acción de salida:

```json
{ "status": "error", "message": "Client has no survey data. Complete the onboarding form first." }
{ "status": "error", "message": "No AI API key configured for provider \"deepseek\". Add it in the gym settings." }
```

### B12 · Facturación → `GET /api/invoices`

Paginado de **Factura**. Filtros: `clientId`, `estado`, `tipoComprobante`, `cae`,
`emitidaDesde`, `emitidaHasta`, `page`, `limit`.

### B13 · Reporte de ingresos → `GET /api/invoices/revenue`

```json
{
  "status": "success",
  "data": {
    "desde": "2026-01-01T00:00:00.000Z",
    "hasta": "2026-07-25T00:00:00.000Z",
    "total": 3500,
    "cantidad": 3,
    "porMes": [
      { "year": 2026, "month": 1, "total": 1500, "cantidad": 2 },
      { "year": 2026, "month": 2, "total": 2000, "cantidad": 1 }
    ]
  }
}
```

`porMes` **solo trae los meses con facturación**: los meses sin ventas no vienen como cero,
vienen ausentes. Un gráfico de barras tiene que rellenar los huecos o el eje temporal
mentiría.

### B14 / C9 · Consumo de IA → `GET /api/ai-usage/report`

```json
{
  "status": "success",
  "data": {
    "desde": "2026-01-01T00:00:00.000Z",
    "hasta": "2026-07-25T00:00:00.000Z",
    "tokensTotal": 6000,
    "costoEstimado": 0.035,
    "rutinas": 3,
    "rutinasSinPrecio": 1,
    "porMes": [
      { "year": 2026, "month": 7, "tokensTotal": 6000, "costoEstimado": 0.035, "rutinas": 3 }
    ],
    "porModelo": [
      { "provider": "openai", "model": "gpt-4o", "tokensTotal": 2000, "costoEstimado": 0.02, "rutinas": 1 },
      { "provider": "deepseek", "model": "deepseek-chat", "tokensTotal": 4000, "costoEstimado": 0.015, "rutinas": 2 }
    ]
  }
}
```

`rutinasSinPrecio: 1` es el caso a diseñar: hay que advertir que **`costoEstimado` está
subestimado**. `porModelo` viene ordenado por costo descendente.

El detalle rutina por rutina es `GET /api/ai-usage`, paginado de **Registro de consumo**.

### B15–B18 · Configuración → `GET /api/gyms/settings`

```json
{
  "status": "success",
  "data": {
    "id": "66a0e1b3c8d3e01f5a846a0e",
    "name": "Hype Workout",
    "businessName": "Hype Workout SRL",
    "cuit": "30712345678",
    "contactEmail": "info@hype.com",
    "contactPhone": "5491122334455",
    "isActive": true,
    "aiConfig": {
      "provider": "deepseek",
      "promptTemplate": "Sos el entrenador de {{gym_nombre}}. EQUIPAMIENTO: 4 racks…",
      "model": "deepseek-chat",
      "hasApiKey": true
    },
    "pdfTemplate": {},
    "whatsappConfig": { "phoneNumberId": "1234567890", "hasAccessToken": false },
    "googleFormConfig": { "formId": "1FAIpQLSc…" },
    "afipConfig": { "puntoVenta": 1, "taxCondition": "MONOTRIBUTO", "isActive": true },
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-06-20T18:30:00.000Z"
  }
}
```

Este ejemplo es a propósito el **caso mixto** que hay que diseñar bien: IA configurada
(`hasApiKey: true`), WhatsApp **a medias** (tiene número pero no token →
`hasAccessToken: false`, así que **las rutinas no se envían**) y AFIP activo.

- `hasApiKey` / `hasAccessToken` son los únicos indicadores de credencial. No hay valor que
  mostrar (restricción 2).
- `model` puede venir **ausente**: significa "modelo por defecto del proveedor".
- `afipConfig` completo puede venir ausente si nunca se configuró.
- `googleFormConfig.formId` puede venir ausente: es el estado "onboarding sin conectar" de
  la pantalla B8.

Las 9 variables de la plantilla, para los chips insertables de B15:

```
{{respuestas_encuesta}}   {{cliente_nombre}}       {{cliente_documento}}
{{cliente_email}}         {{cliente_telefono}}     {{cliente_fecha_inicio}}
{{cliente_fecha_vencimiento}}   {{gym_nombre}}     {{fecha_actual}}
```

### C2 · Gimnasios → `GET /api/admin/gyms`

Array plano, con **menos campos** que la configuración completa:

```json
{
  "status": "success",
  "data": [
    {
      "id": "66a0e1b3c8d3e01f5a846a0e",
      "name": "Hype Workout",
      "businessName": "Hype Workout SRL",
      "cuit": "30712345678",
      "contactEmail": "info@hype.com",
      "contactPhone": "5491122334455"
    }
  ]
}
```

Sin paginar y **solo gimnasios activos**: los desactivados no aparecen. Si el selector de
gimnasio (restricción 1) se alimenta de acá, no hay forma de volver a uno dado de baja
desde la UI — tenelo en cuenta al diseñar la desactivación en C2.
Tampoco trae `isActive`, ni cantidad de socios, ni fecha de alta: la tabla de gimnasios no
puede mostrar esas columnas.

### C3 · Alta de gimnasio → `POST /api/admin/gyms`

```json
{
  "status": "success",
  "data": {
    "gym": { "id": "66a0…", "name": "Hype Workout", "businessName": "Hype Workout SRL", "cuit": "30712345678" },
    "user": { "id": "66a1…", "email": "dueno@hype.com", "name": "Iván Bazán" }
  }
}
```

Devuelve **las dos cosas creadas**. La pantalla de éxito debería mostrarlas juntas y dejar
claro que ya se le puede pasar el acceso al dueño.

### C6 · Usuarios → `GET /api/admin/users`

Paginado de **Usuario**. Filtros: `q` (nombre o email), `role`, `gymId`, `isActive`,
`page`, `limit`.

Devuelve `gymId`, **no el nombre del gimnasio** — mismo problema que las facturas con el
socio. Si la tabla muestra "Gimnasio", hay que cruzarlo con el listado de C2.

### C1 · Dashboard de plataforma → `GET /api/dashboard/summary`

Hoy responde literalmente esto:

```json
{ "status": "success", "data": { "message": "Summary endpoint - implement aggregation across all gyms" } }
```

Diseñá la pantalla que **debería** existir (gimnasios activos, altas del mes, consumo
agregado) y además el estado "métricas todavía no disponibles".

---

## Formato de errores

Error simple:

```json
{ "status": "error", "message": "Client not found" }
```

Error de validación, **campo por campo** (restricción 7):

```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    { "path": "email", "message": "Email inválido" },
    { "path": "documento", "message": "Documento es requerido" }
  ]
}
```

`path` es el nombre del campo del formulario: mapealo directo al input correspondiente.

Casos con texto propio a contemplar en la UI:

| Situación | Mensaje | Dónde aparece |
|---|---|---|
| Credenciales incorrectas | `Invalid credentials` | A4 |
| Cuenta desactivada | `User account is deactivated` | A4 |
| Demasiados intentos | `Too many authentication attempts, please try again later` | A4 |
| Socio sin encuesta | `Client has no survey data. Complete the onboarding form first.` | B10 |
| Sin credencial de IA | `No AI API key configured for provider "…". Add it in the gym settings.` | B10 |
| Plantilla sin variables | `The prompt template must include at least one placeholder…` | B15 |
| Variable mal escrita | `Unknown placeholders in prompt template: {{…}}. Available: …` | B15 |
| Documento repetido | `A client with this documento already exists` | B4 |
| Admin sin gimnasio elegido | `gymId query parameter is required for admin users` | Todo el panel admin |

Los mensajes del backend están **en inglés**. La UI es en español: diseñá los textos
traducidos y tratá el mensaje crudo como dato técnico, no como copy.
