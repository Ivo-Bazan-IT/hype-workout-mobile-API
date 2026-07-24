# Roadmap — Gym CRM Backend

**Estrategia:** De lo general a lo específico (scaffolding → lógica de negocio → integraciones → IA)

---

## Fase 0: Setup Inicial y Scaffolding Base
*Puntos: 8 | Estimación: 2-3 días*

### Objetivo
Crear la base del proyecto con stack tecnológico definido y estructura de carpetas.

### Tareas
1. **Inicializar proyecto Node.js + TypeScript**
   - package.json con dependencias base
   - tsconfig.json configurado para Clean Architecture
   - .eslintrc.json y .prettierrc

2. **Configuración de entorno**
   - .env.example con todas las variables definidas
   - src/config/env.ts (validación con Zod)
   - src/config/database.ts (conexión Mongoose)
   - src/config/redis.ts (conexión BullMQ)

3. **Docker Compose para desarrollo local**
   - MongoDB 7.x service
   - Redis 7.x service
   - Volumen de persistencia para Mongo

4. **Scripts NPM iniciales**
   - dev, build, start, worker:dev, lint, test

5. **src/shared/errors/AppError.ts**
   - Clase base para errores de dominio

---

## Fase 1: Arquitectura Hexagonal — Capa Domain
*Puntos: 13 | Estimación: 3-4 días*

### Objetivo
Definir las entidades y contratos (interfaces) del dominio sin logicar de infraestructura.

### Tareas
1. **Dominio — Entities**
   - User.ts (rol, gymId opcional)
   - Gym.ts (tenant, configs)
   - Client.ts (datos del cliente)
   - Routine.ts (rutina, estados)

2. **Dominio — Repositories (Interfaces)**
   - IUserRepository.ts
   - IGymRepository.ts
   - IClientRepository.ts
   - IRoutineRepository.ts
   - IInvoiceRepository.ts (contrato con módulo Arca existente)

3. **Dominio — Services (Interfaces)**
   - IAIProvider.ts (el contrato más crítico para IA)
   - IWhatsappProvider.ts
   - IPdfGenerator.ts
   - IFormsProvider.ts

---

## Fase 2: Infraestructura de Datos (Mongoose)
*Puntos: 8 | Estimación: 2-3 días*

### Objetivo
Implementar las capas de persistencia siguiendo el contrato del domain.

### Tareas
1. **Schemas Mongoose**
   - UserSchema.ts (con índices)
   - GymSchema.ts (configs anidadas)
   - ClientSchema.ts (con todos los índices)
   - RoutineSchema.ts (con índices de dashboard)

2. **Implementaciones de repositorios**
   - MongoUserRepository.ts
   - MongoGymRepository.ts
   - MongoClientRepository.ts
   - MongoRoutineRepository.ts

3. **Seeds iniciales**
   - Script para crear superadmin
   - Script para crear gym de ejemplo

---

## Fase 3: Autenticación Multi-Tenant
*Puntos: 8 | Estimación: 2 días*

### Objetivo
Sistema de auth stateless con soporte completo multi-tenancy.

### Tareas
1. **Middlewares**
   - authMiddleware.ts (verificación JWT)
   - roleMiddleware.ts (verificación de roles)
   - tenantMiddleware.ts (inyección automática de gymId)
   - errorHandler.ts (manejo centralizado)

2. **Use Cases de Auth**
   - LoginUseCase.ts (con generación de access + refresh tokens)
   - RefreshTokenUseCase.ts
   - LogoutUseCase.ts

3. **Controller y Routes**
   - AuthController.ts
   - auth.routes.ts
   - Integración completa en src/interfaces/http/routes/index.ts

4. **Rate limiting y seguridad**
   - express-rate-limit en endpoints de auth
   - Helmet configurado

---

## Fase 4: CRUD Base — Clientes y Gyms
*Puntos: 13 | Estimación: 3-4 días*

### Objetivo
Operaciones básicas de gestión con aislamiento tenant garantizado.

### Tareas
1. **Use Cases de Clientes**
   - CreateClientUseCase.ts
   - SearchClientsUseCase.ts (nombre texto + documento regex)
   - RenewClientUseCase.ts
   - DeleteClientUseCase.ts (soft delete recomendado)

2. **Use Cases de Gyms (Admin)**
   - CreateGymUseCase.ts
   - UpdateGymUseCase.ts
   - DeleteGymUseCase.ts
   - ListGymsUseCase.ts

3. **Controllers y Routes**
   - ClientController.ts
   - GymController.ts
   - client.routes.ts
   - gym.routes.ts

4. **Validators con Zod**
   - client.validator.ts
   - gym.validator.ts

---

## Fase 5: Integración Onboarding (Google Forms)
*Puntos: 8 | Estimación: 2 días*

### Objetivo
Recibir y procesar respuestas de formularios automáticamente.

### Tareas
1. **GoogleFormsWebhookHandler.ts**
   - Validación de webhookSecret
   - Mapeo de respuestas a encuestaData

2. **ProcessFormSubmissionUseCase.ts**
   - Creación de Client en estado 'pendiente'
   - Guardado de respuestas en schema-less

3. **OnboardingController.ts y Routes**
   - Endpoint público /api/onboarding/webhook
   - /api/onboarding/status

4. **Documentación para Apps Script**
   - Template listo para instalar en Google Forms

---

## Fase 6: Sistema de Colas Asíncronas (BullMQ)
*Puntos: 8 | Estimación: 2 días*

### Objetivo
Procesar operaciones lentas sin bloquear el API.

### Tareas
1. **Queues**
   - routineQueue.ts
   - whatsappQueue.ts

2. **Workers**
   - routineWorker.ts (escucha routine-generation)
   - whatsappWorker.ts (escucha send-routine)

3. **Script de workers separado**
   - src/infrastructure/queues/workers/index.ts
   - Compatibilidad con ts-node-dev

4. **Retry y dead letter handling**
   - Configuración de backoff exponencial
   - Manejo de fallos en workers

---

## Fase 7: Generación de PDF
*Puntos: 5 | Estimación: 1-2 días*

### Objetivo
Transformar rutinas generadas en PDFs compartibles.

### Tareas
1. **PdfLibGenerator.ts**
   - Overlay de texto sobre plantilla PDF
   - Manejo de múltiples páginas

2. **GeneratePdfUseCase.ts**
   - Lectura de contenidoGenerado
   - Guardado en storage/templates

3. **Storage handlers**
   - Multer para upload de plantillas
   - Rutas locales o preparado para S3

---

## Fase 8: Integración WhatsApp (Meta Cloud API)
*Puntos: 8 | Estimación: 2-3 días*

### Objetivo
Envío automático de rutinas por WhatsApp.

### Tareas
1. **MetaCloudApiProvider.ts**
   - Upload de media (PDF)
   - Envío de documento

2. **SendRoutineWhatsappUseCase.ts**
   - Obtención de configuración del gym
   - Manejo de errores y retry

3. **WhatsApp Queue Worker**
   - Integración en whatsappWorker.ts

4. **Setup de Meta API**
   - Documentación para obtener tokens
   - Webhook de status de Meta (opcional)

---

## Fase 9: Integración de IA (Más Específico)
*Puntos: 13 | Estimación: 3-5 días*

### Objetivo
Generar rutinas personalizadas usando IA con patrón adaptador.

### Tareas
1. **OpenAIProvider.ts**
   - Implementación del contrato IAIProvider
   - Prompt injection con {{respuestas_encuesta}}
   - Response format JSON

2. **AnthropicProvider.ts**
   - Implementación alternativa
   - Soporte Claude models

3. **IAIProviderFactory.ts**
   - Selección de proveedor por gym
   - Lectura de tokenSecretRef

4. **GenerateRoutineUseCase.ts**
   - Integración con repositorios
   - Encolado automático en routineQueue

5. **Endpoint REST**
   - POST /api/routines/generate/:clientId
   - Respuesta 202 Accepted inmediata

6. **Testing de prompts**
   - Mock de proveedores
   - Tests de inyección de variables

---

## Fase 10: Dashboard y Métricas
*Puntos: 8 | Estimación: 2 días*

### Objetivo
Panel de control con KPIs relevantes para negocio.

### Tareas
1. **GetGymDashboardUseCase.ts**
   - clientesActivos count
   - clientesRecurrentes count
   - rutinasPorVencer (agregación por días)
   - ingresos mensuales (integración con IInvoiceRepository)

2. **Endpoint /api/dashboard**
   - Auth + tenant isolation
   - Soporte ?gymId= para admin

3. **Aggregations de MongoDB**
   - Queries optimizadas con índices
   - Cache con Redis (opcional)

---

## Fase 11: Testing Unitario e Integración
*Puntos: 8 | Estimación: 2-3 días*

### Objetivo
Cobertura de pruebas para garantizar calidad.

### Tareas
1. **Unit Tests**
   - Use cases con mocks
   - Validadores Zod
   - Error scenarios

2. **Integration Tests**
   - Endpoints con supertest
   - mongodb-memory-server
   - JWT authentication flow

3. **Test Utilities**
   - Factory para entidades
   - Seed de test data

---

## Fase 12: Seguridad y Hardening
*Puntos: 5 | Estimación: 1-2 días*

### Objetivo
Capas adicionales de protección y best practices.

### Tareas
1. **validación de entrada**
   - Zod schemas exhaustivas
   - Sanitización de datos

2. **audit logging**
   - Pino configurado
   - Logs estructurados

3. **Secrets management**
   - Referencias seguras en Gym schema
   - Rotation de tokens

---

## Fase 13: Deployment y CI/CD
*Puntos: 5 | Estimación: 1-2 días*

### Objetivo
Listo para producción.

### Tareas
1. **Dockerfile para producción**
2. **PM2/ecosystem.config.js o equivalente**
3. **GitHub Actions (opcional)**
   - Test en cada push
   - Build automático

---

## Resumen de Prioridades

| Fase | Tema | Impacto | Dependencias |
|------|------|---------|--------------|
| 0-2 | Arquitectura base | Alto | - |
| 3-4 | Auth + CRUD | Alto | 0-2 |
| 9 | IA | Máximo | 6, 0-2 |
| 5-8 | Integraciones externas | Alto | 6, 0-2 |
| 10 | Dashboard | Medio | 4, 9 |
| 11-13 | QA y Deploy | Medio | todas |

---

## Próximos Pasos Inmediatos

1. **Confirmar**: ¿La plantilla de rutina es PDF con campos fijos o diseño gráfico (requiere Puppeteer)?
2. **Iniciar trámite**: WhatsApp Business API en Meta for Developers (proceso de verificación puede demorar días).
3. **Definir**: Contrato exacto de IInvoiceRepository contra el módulo Arca existente.
4. **Revisar**: ¿Soft delete o borrado físico para clientes? (afecta reportes).