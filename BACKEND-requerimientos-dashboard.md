# Requerimientos del backend — orden de trabajo

> Actualizado el **2026-08-11**: entró **P3-A**. De las siete tareas de la versión del
> 09/08 quedan **cero abiertas**; la única anotada es P3-B, que no está pedida.
>
> El contrato de la API dejó de vivir acá. Ahora está en
> **[`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)**, al día y verificado archivo por
> archivo. Este documento vuelve a ser lo que dice el título: qué falta hacer.

---

## 1. Tablero

| Id | Prioridad | Tarea | Toca | Rompe al front |
|---|---|---|---|---|
| [P3-B](#p3-b--embudo-en-la-serie-mensual) | P3 | Embudo en la serie mensual | `GetGymKpisSeriesUseCase` + `IMetricsRepository` | No — aditivo |

**No hay nada abierto.** P3-B está anotada, no pedida, y necesita una decisión de diseño
del puerto antes de tocar nada.

Lo que se cerró está en [§3 Hecho](#3-hecho-en-la-tanda-del-10-08), con la evidencia de
dónde quedó cada cosa, porque la mitad de esas correcciones son invisibles desde afuera y
conviene poder encontrarlas.

---

## 2. Lo que queda

### P3-B — Embudo en la serie mensual

**No está pedido y no está abierto.** Queda anotado con el porqué, para no volver a
pensarlo desde cero.

`/dashboard/kpis/series` hace una sola lectura para los doce meses. El embudo sale de
`getLeadCohort` y `countConversions` (`GetGymKpisUseCase.ts:164-165`), que hoy reciben
**un** rango (`IMetricsRepository.ts:115,127`): agregarlo a la serie serían doce
consultas más, o un rediseño del puerto para que devuelva la cohorte de doce meses y se
particione en memoria.

Si alguna vez se pide, **la forma correcta es la segunda** —una lectura, partición en
memoria— para no romper la regla de la lectura única. La primera es más fácil de escribir
y le saca al endpoint la única razón por la que existe.

---

## 2 bis. Hecho el 11-08 — P3-A, retención en la serie ✅

650 tests (eran 644), `tsc` limpio, lint con 0 errores.

`churnMensual` y `tasaRetencion` viajan ahora en cada punto de `/dashboard/kpis/series`,
como fracción `[0,1]`. Salen de `monthlyChurnRate` y `retentionRate` —las mismas
funciones de dominio que usa `/dashboard/kpis`— aplicadas sobre el historial **ya leído**:
la regla de la lectura única sigue intacta y hay un test propio que la vuelve a fijar para
estos dos campos.

**Un caso de `null` que no estaba en el pedido y apareció escribiéndolo:** además de los
meses anteriores a `datosCompletosDesde`, los dos campos van en `null` cuando el mes
**arranca con la base en cero**. `monthlyChurnRate` y `retentionRate` ya devolvían `null`
con `membersAtStart <= 0`, así que no hubo que decidir nada — pero es el caso de los
primeros meses de cualquier gimnasio, o sea el que el front va a ver primero. En el
fixture de test es enero: un mes con un alta real y las dos tasas en `null`. Un 0% de
churn ahí afirmaría que no se fue nadie de un padrón que todavía no existía.

`cohorte90Dias` **no entró y no es un olvido**: es móvil contra `now`, no del mes. Hay dos
tests —uno unitario y uno e2e— que fijan su ausencia, para que no entre después "por
simetría" con los otros dos.

El criterio de aceptación quedó fijado en `tests/e2e/dashboardKpis.test.ts`, en el test
que ya comparaba el punto del mes en curso contra `/dashboard/kpis`: se le sumaron las dos
tasas. Los dos endpoints resuelven el mismo período por default, así que la gráfica y la
tarjeta tienen que dar el mismo número.

**Qué hace el front:** nada obligatorio, es aditivo. Cuando quiera, agrega la tercera
gráfica al lado de `AltasBajasChart` y `EvolucionFinanciera` — con la advertencia de que
los meses fundacionales vienen en `null` por diseño y hay que dibujar el hueco, no un
cero.

---

## 3. Hecho en la tanda del 10-08

Cinco tareas, 644 tests (eran 642), `tsc` y lint limpios. Está acá y no borrado porque
tres de las cinco son correcciones silenciosas: nadie las ve mirando la API, y sin este
registro la próxima persona que toque esos archivos las deshace sin enterarse.

### P1-A — Los dos conteos de socios activos, unificados ✅

`GET /dashboard` decía `clientesActivos: 3` y `GET /dashboard/kpis` decía
`socios.activos: 2` **en la misma pantalla**, porque el primero contaba
`estado: 'activo'`, que es el flag del **borrado lógico** y no el estado de la membresía.

Se resolvió por la **opción 1: unificar el criterio**. `clientesActivos` y
`clientesRecurrentes` cuentan ahora membresías **vigentes o en gracia**
(`GetGymDashboardUseCase.ts:60-70`), con el límite calculado desde
`DIAS_DE_GRACIA_POR_DEFECTO` y no con un 5 escrito a mano (`:110`). El nombre del campo no
cambió y el front no tocó nada.

> ⚠️ **El documento anterior afirmaba algo falso, y es la trampa a recordar.** Decía:
> *"`MongoClientRepository` ya lo traduce. No hace falta tocar el repositorio."* **No lo
> traducía.** `vencimientoDesde` y `vencimientoHasta` estaban declarados en
> `ClientSearchFilters` desde antes y `buildQuery` los ignoraba por completo: pasarlos no
> filtraba nada, no fallaba y no avisaba. Siguiendo la instrucción al pie de la letra,
> `clientesActivos` habría quedado igual de mal con todos los tests en verde.
>
> Se implementó en `MongoClientRepository.ts:83-95`, semiabierto como el resto de los
> rangos. **Un filtro declarado en el puerto no está implementado hasta verlo en la
> query** — es la misma clase de bug que el `desde`/`hasta` de facturas que Zod descarta
> en silencio.

Tests: `tests/integration/client/MongoClientRepository.test.ts` (el filtro contra Mongo
real, que es donde vivía el hueco) y `tests/e2e/dashboardKpis.test.ts`, con la aserción
que fija el contrato: `dashboard.clientesActivos === kpis.socios.activos` sobre el mismo
fixture.

### P1-B — El promedio que extrapolaba desde horas de datos ✅

`visitasPorSocioPorSemana` devolvía `23.2` en un gimnasio con 2 socios y 2 check-ins: el
denominador eran ~7,2 horas. No era un promedio, era una proyección de siete horas a
siete días.

`avgVisitsPerMemberPerWeek` devuelve `null` por debajo de
`DIAS_MINIMOS_PARA_PROMEDIO_SEMANAL` (`domain/kpis/engagement.ts:22,48`), que es
exactamente una semana porque es la unidad en la que se expresa la métrica. El corte
aplica también cuando el **período pedido** es corto, no solo cuando el registro es nuevo.
`registroDesde` sigue viajando siempre, y `enRiesgo` conserva su umbral propio de 14 días
—es otra afirmación y necesita otra evidencia—.

El sitio de llamada no se tocó: ya pasaba el denominador correcto.

### P2-A — `enRiesgo.clientIds` eliminado ✅

El front confirmó que migró a `socios`. Salió de la interfaz (`GetGymKpisUseCase.ts:74`),
del objeto construido (`:375`) y del docstring que anunciaba la duplicación temporal.
`findAtRiskMembers` sigue devolviendo ids —es lo correcto para una función de dominio— y
el nombre lo resuelve el caso de uso.

### P2-B — `API_ENDPOINTS.md`, al día y mudado ✅

**Ahora vive en [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)**, escrito de cero contra
el código: el documento describe el backend y se desactualiza justo cuando cambia el
backend, así que conviene que viva al lado del código que lo invalida.

Cubre lo que faltaba —`kpis/series`, `heatmap`, `contacto`, `google-form`,
`rotate-secret`, el bloque `embudo`, `timezone`, `afipConfig`, `clientNombre`, la forma
real de `googleFormConfig` sin el secreto— y arranca con las **reglas transversales**: el
envelope anidado, los centavos, los dos formatos de fecha, el tenant y la regla del
`null`. Son lo que más caro sale descubrir tarde y no estaban escritas en ningún lado.

> 🧹 **Pendiente del lado del front:** la copia vieja quedó en `front/API_ENDPOINTS.md` y
> **no está trackeada en git**, así que no se borró desde acá —sería irrecuperable—.
> Conviene borrarla o dejar un puntero a este repo: mientras las dos existan, alguien va a
> tipar contra la equivocada.

### P3-C — Listado de rutinas por gimnasio ✅

`GET /api/routines`, paginado y filtrado en la base: `clientId`, `estadoEnvio`,
`estadoGeneracion`, `vencimientoDesde`/`vencimientoHasta`, `limit` con tope de 100 como
facturas.

- Puerto: `IRoutineRepository.search()` + `RoutineListItem` (`:40`).
- Adaptador: `MongoRoutineRepository.search()` (`:56`), con `$lookup` **después** de
  paginar para resolver los nombres de las 20 filas de la página y no los de todo el
  historial.
- Caso de uso: `SearchRoutinesUseCase`, mismo tope y mismo criterio de paginado que
  `SearchInvoicesUseCase`.
- Ruta: `routine.routes.ts:88`, antes de `/:id`. El `tenantMiddleware` ya lo aplicaba
  `routes/index.ts`.

Cada fila trae **`clientNombre` resuelto**, `null` si el socio fue borrado. Es la misma
lección de `/checkins`: sin el nombre, el front vuelve a cruzar contra el padrón cacheado
y ese cruce ya se borró una vez por buenas razones.

**Qué hace el front:** reemplaza el hook `useClientRoutineStatuses` —que disparaba una
consulta por socio visible— y **la tabla no cambia**. Se retira el `Callout` que avisa que
los filtros son parciales, porque dejaron de serlo.

---

## 4. Encontrado de paso — también cerrado

Tres cosas que no estaban en la lista y aparecieron trabajando.

### 4.1 `npm run typecheck` estaba en rojo

27 errores, todos en `tests/unit/dashboard/GetGymKpisSeriesUseCase.test.ts`, por un helper
tipado como `{ desde: Date }` que borraba el resto de los campos del punto. Se hizo
genérico (`:60`). Una línea. Vale anotarlo porque un `tsc` que ya está rojo deja de servir
como puerta de calidad: el error 28 pasa desapercibido.

### 4.2 El rojo conocido de `datosCompletosDesde`, resuelto

`dashboardKpis.test.ts > manda las fechas sin hora` fallaba desde antes de la tanda 4
porque el test exigía `yyyy-MM-dd` y el controller mandaba ISO completo.

**Ganó el controller**, y la decisión quedó cerrada: **las fechas se serializan por
significado, no por endpoint** (`DashboardController.ts:14-33`). Límite de período →
`yyyy-MM-dd`; instante → ISO completo. Es una regla mejor que la que se había acordado,
porque el criterio es el significado del campo y no dónde aparece.

Se sumó además un test que fija que los dos endpoints de KPIs manden `datosCompletosDesde`
**idéntico**: era el punto exacto donde el front tenía que ramificar por endpoint para
parsear un campo con un solo significado.

> 📌 **Nota para el front:** la memoria `huecos-api-conocidos` dice que el campo viaja en
> dos formatos. Está desactualizada.

### 4.3 Dos tests que afirmaban lo que P1-B corrige

`GetGymKpisUseCase.test.ts` y el e2e de engagement daban por bueno un promedio semanal
sobre 5,5 días y sobre horas. Eran justamente el bug, expresado como expectativa. Se
actualizaron y se agregó el caso de 8 días, que sí devuelve valor.

---

## 5. Cerrado — no reabrir sin motivo nuevo

- **Las fechas se serializan por significado, no por endpoint** (§4.2). Reemplaza al
  acuerdo anterior de unificar todo a `yyyy-MM-dd`.
- **Los dos cortes de zona horaria son distintos** —períodos de KPI en UTC, día calendario
  y franjas horarias en la zona del gimnasio—. No es incoherencia: son dos preguntas
  distintas. Detalle en `docs/API_ENDPOINTS.md` §1.6.
- **`clientesActivos` cuenta vigentes + en gracia**, y tiene que seguir coincidiendo con
  `socios.activos`. Hay un e2e que lo fija.
- **El promedio semanal tiene piso de 7 días y el riesgo de 14.** Son dos umbrales
  distintos a propósito, porque afirman cosas distintas.
- **El `limit` de `/checkins` queda en 500** como red de seguridad. El camino previsto es
  `/checkins/heatmap`.
- **El webhook no vuelve a crear clientes.** Un DNI desconocido es un tipeo, no un socio
  nuevo.
- **`POST /clients/:id/contacto` no actualiza la fecha.** Mide el *primer* contacto.
- **La serie sale de UNA sola lectura del historial.** Hay un test que cuenta invocaciones
  al puerto. Es la razón de existir del endpoint.
- **`cohorte90Dias` no va en la serie.** Es móvil contra *hoy*, no una métrica del mes.
  Dos tests fijan su ausencia. Si algún día se pide, es la cohorte *de cada mes*, que es
  otro cálculo y no este campo mudado de lugar.
- **`Client.estado: 'inactivo'` es borrado lógico**, no una baja del gimnasio.
- **Un socio vencido puede registrar ingreso** (es la señal de que volvió); uno `inactivo`
  da 400; uno de otro gimnasio da 404.
- **`/clients/:id/invoices` no se construye.** `GET /invoices?clientId=` ya hace
  exactamente eso, verificado de punta a punta. El 404 es del lado del front.
- **No hay ni va a haber** pantalla de clases, reservas, CAC, payback, margen bruto ni
  trials. `GET /dashboard/summary` es del panel de plataforma, no del CRM del gimnasio.

---

## 6. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Contrato de la API, endpoint por endpoint | [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md) |
| Reglas transversales (envelope, tenant, `null`, unidades, fechas, zona horaria) | `docs/API_ENDPOINTS.md` §1 |
| Semánticas que no se deducen del JSON (gracia, embudo, idempotencia, secreto) | `docs/API_ENDPOINTS.md`, en cada endpoint |
| Definición de los KPIs y sus fórmulas | `kpis-gimnasio-dominio.md` |
| Qué falta hacer | **este archivo** |
| Instalación del Apps Script del Form | `docs/google-forms/README.md` |

---

## 7. Deuda anotada, no abierta

Ninguna bloquea nada. Están acá para no redescubrirlas.

- **Los tests unitarios dependen de Mongo.** `tests/setup.ts` levanta
  `mongodb-memory-server` en un `beforeAll` **global**, así que los unit tests de casos de
  uso —que son mocks puros y no tocan la base— pagan el arranque igual. Funciona y corre
  offline; el costo es tiempo de suite, no falsos rojos.
- **Los fixtures de `dashboardKpis.test.ts` están anclados a 2026** y se comparan contra
  el reloj real. El escenario base tiene un socio que vence el 31/12/2026: a partir de
  enero de 2027 empieza a contar como de baja y varias aserciones se mueven. No es urgente
  y es un arreglo de una tarde —congelar el reloj o derivar las fechas de `now`—, pero es
  una bomba de tiempo literal.
- **134 warnings de ESLint**, todos de estilo (`no-explicit-any` y
  `explicit-function-return-type`) y consistentes con el resto del repo. 0 errores.
