# Plantillas de cada capa (verbatim del proyecto)

Estas plantillas están extraídas del feature `client`, el más completo del repo. Copia la forma,
adapta los nombres. Toma como fuente de verdad el código real de `src/**/client*` si difiere de esto.

Índice:
1. Entidad (`domain/entities/X.ts`)
2. Puerto de repositorio (`domain/repositories/IXRepository.ts`)
3. Puerto de servicio externo (`domain/services/IXProvider.ts`)
4. Caso de uso (`application/use-cases/<feature>/XUseCase.ts`)
5. Schema Mongoose (`infrastructure/database/mongoose/schemas/XSchema.ts`)
6. Repositorio Mongo (`infrastructure/database/mongoose/repositories/MongoXRepository.ts`)
7. Adaptador externo (`infrastructure/external/<vendor>/XProvider.ts`)
8. Controller (`interfaces/http/controllers/XController.ts`)
9. Validador Zod (`interfaces/http/validators/x.validator.ts`)
10. Ruta = composition root (`interfaces/http/routes/x.routes.ts`)

---

## 1. Entidad

Patrón triple: `interface` (contrato de datos) + `class XEntity implements X` (constructor con
defaults) + `class XMapper` (traduce entre documento de persistencia y dominio). Los tipos union
para estados van arriba. Los `_id` de Mongo se convierten a `string` en el dominio.

```typescript
import { Types } from 'mongoose';

export type MembershipStatus = 'activa' | 'vencida' | 'cancelada';

export interface Membership {
  id: string;
  gymId: string;
  clientId: string;
  plan: string;
  precio: number;
  estado: MembershipStatus;
  fechaInicio: Date;
  fechaFin: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class MembershipEntity implements Membership {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public plan: string,
    public precio: number,
    public estado: MembershipStatus = 'activa',
    public fechaInicio: Date = new Date(),
    public fechaFin: Date = new Date(),
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class MembershipMapper {
  static toDomain(doc: any): Membership {
    return new MembershipEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.plan,
      doc.precio,
      doc.estado,
      doc.fechaInicio,
      doc.fechaFin,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: MembershipEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      plan: entity.plan,
      precio: entity.precio,
      estado: entity.estado,
      fechaInicio: entity.fechaInicio,
      fechaFin: entity.fechaFin,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
```

---

## 2. Puerto de repositorio

Interfaz `IXRepository` en `domain/repositories/`. Métodos con `gymId` explícito para aislamiento
multi-tenant. Los tipos de apoyo (filtros de búsqueda, `PaginatedResult<T>`) se declaran aquí y se
reutilizan; `PaginatedResult<T>` ya existe en `IClientRepository.ts` — impórtalo de ahí en vez de
redefinirlo.

```typescript
import { Membership, MembershipStatus } from '../entities/Membership';

export interface MembershipSearchFilters {
  estado?: MembershipStatus;
  clientId?: string;
}

export interface IMembershipRepository {
  create(data: Omit<Membership, 'id' | 'createdAt' | 'updatedAt'>): Promise<Membership>;
  findById(id: string, gymId: string): Promise<Membership | null>;
  findByClient(clientId: string, gymId: string): Promise<Membership[]>;
  update(id: string, gymId: string, data: Partial<Membership>): Promise<Membership | null>;
  delete(id: string, gymId: string): Promise<boolean>;
}
```

`PaginatedResult<T>` reutilizable (ya definido en el repo):

```typescript
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## 3. Puerto de servicio externo

Para integraciones (IA, WhatsApp, PDF, forms, billing). La interfaz vive en `domain/services/` y
describe la capacidad de negocio en términos del dominio, **sin filtrar** tipos del vendor
(nada de `OpenAI.ChatCompletion` aquí). Documenta con JSDoc por qué existe la abstracción.

```typescript
/**
 * Puerto de notificaciones. Permite intercambiar el proveedor (WhatsApp, email, SMS)
 * sin tocar la lógica de negocio.
 */
export interface INotificationProvider {
  /**
   * Envía un recordatorio de vencimiento a un cliente.
   * @returns id del mensaje enviado por el proveedor
   */
  sendExpiryReminder(params: {
    telefono: string;
    nombre: string;
    fechaVencimiento: Date;
  }): Promise<{ messageId: string }>;
}
```

---

## 4. Caso de uso

Clase en `application/use-cases/<feature>/`. DTO declarado inline como `interface`. Puertos
inyectados por constructor (`private`). Un método público `execute(dto)`. Las invariantes de negocio
se validan aquí lanzando errores del dominio de `shared/errors/AppError`. **Nunca** importa nada de
`infrastructure/` ni de `express`/`mongoose` (salvo tipos).

```typescript
import { IMembershipRepository } from '../../../domain/repositories/IMembershipRepository';
import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { Membership } from '../../../domain/entities/Membership';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';

interface CreateMembershipDTO {
  gymId: string;
  clientId: string;
  plan: string;
  precio: number;
  fechaInicio: Date;
  fechaFin: Date;
}

export class CreateMembershipUseCase {
  constructor(
    private membershipRepository: IMembershipRepository,
    private clientRepository: IClientRepository
  ) {}

  async execute(dto: CreateMembershipDTO): Promise<Membership> {
    const client = await this.clientRepository.findById(dto.clientId, dto.gymId);
    if (!client) {
      throw new NotFoundError('Client');
    }

    const existing = await this.membershipRepository.findByClient(dto.clientId, dto.gymId);
    if (existing.some((m) => m.estado === 'activa')) {
      throw new ConflictError('Client already has an active membership');
    }

    return this.membershipRepository.create({
      gymId: dto.gymId,
      clientId: dto.clientId,
      plan: dto.plan,
      precio: dto.precio,
      estado: 'activa',
      fechaInicio: dto.fechaInicio,
      fechaFin: dto.fechaFin,
    });
  }
}
```

---

## 5. Schema Mongoose

En `infrastructure/database/mongoose/schemas/`. Exporta el `XModel` y el tipo `XDocument`. El
`gymId` y las referencias son `ObjectId` con `ref`. Usa `timestamps: true` para `createdAt`/
`updatedAt`. Indexa por `gymId` (y campos de búsqueda frecuentes) — es multi-tenant.

```typescript
import { Schema, model, Document, Types } from 'mongoose';

export interface MembershipDocument extends Document {
  gymId: Types.ObjectId;
  clientId: Types.ObjectId;
  plan: string;
  precio: number;
  estado: 'activa' | 'vencida' | 'cancelada';
  fechaInicio: Date;
  fechaFin: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<MembershipDocument>(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    plan: { type: String, required: true },
    precio: { type: Number, required: true },
    estado: { type: String, enum: ['activa', 'vencida', 'cancelada'], default: 'activa' },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, required: true },
  },
  { timestamps: true }
);

export const MembershipModel = model<MembershipDocument>('Membership', MembershipSchema);
```

---

## 6. Repositorio Mongo

En `infrastructure/database/mongoose/repositories/`. Implementa el puerto, usa el `XMapper` para
traducir documentos ↔ dominio. Toda query filtra por `gymId`. Las actualizaciones parciales copian
campo por campo desde `Partial<X>` (ver `MongoClientRepository.update`).

```typescript
import { MembershipModel, MembershipDocument } from '../schemas/MembershipSchema';
import { IMembershipRepository } from '../../../../domain/repositories/IMembershipRepository';
import { Membership, MembershipMapper } from '../../../../domain/entities/Membership';

export class MongoMembershipRepository implements IMembershipRepository {
  async create(data: Omit<Membership, 'id' | 'createdAt' | 'updatedAt'>): Promise<Membership> {
    const doc = await MembershipModel.create({
      gymId: data.gymId,
      clientId: data.clientId,
      plan: data.plan,
      precio: data.precio,
      estado: data.estado,
      fechaInicio: data.fechaInicio,
      fechaFin: data.fechaFin,
    });
    return MembershipMapper.toDomain(doc);
  }

  async findById(id: string, gymId: string): Promise<Membership | null> {
    const doc = await MembershipModel.findOne({ _id: id, gymId });
    return doc ? MembershipMapper.toDomain(doc) : null;
  }

  async findByClient(clientId: string, gymId: string): Promise<Membership[]> {
    const docs = await MembershipModel.find({ clientId, gymId });
    return docs.map(MembershipMapper.toDomain);
  }

  async update(id: string, gymId: string, data: Partial<Membership>): Promise<Membership | null> {
    const updateData: Partial<MembershipDocument> = {};
    if (data.plan !== undefined) updateData.plan = data.plan;
    if (data.precio !== undefined) updateData.precio = data.precio;
    if (data.estado !== undefined) updateData.estado = data.estado;
    if (data.fechaFin !== undefined) updateData.fechaFin = data.fechaFin;

    const doc = await MembershipModel.findOneAndUpdate({ _id: id, gymId }, updateData, { new: true });
    return doc ? MembershipMapper.toDomain(doc) : null;
  }

  async delete(id: string, gymId: string): Promise<boolean> {
    const doc = await MembershipModel.findOneAndUpdate(
      { _id: id, gymId },
      { estado: 'cancelada' }
    );
    return !!doc;
  }
}
```

---

## 7. Adaptador externo

En `infrastructure/external/<vendor>/`. Implementa un `IXProvider` del dominio y encapsula el SDK
del vendor. Toda la fuga potencial (tipos, errores, formatos del proveedor) se contiene aquí y se
traduce al contrato del puerto. Mira `OpenAIProvider`, `AnthropicProvider` y `AIProviderFactory`
como ejemplos reales; el factory selecciona el adaptador según config sin que la app lo sepa.

```typescript
import axios from 'axios';
import { INotificationProvider } from '../../../domain/services/INotificationProvider';

export class MetaWhatsappNotificationProvider implements INotificationProvider {
  constructor(private apiKey: string, private phoneNumberId: string) {}

  async sendExpiryReminder(params: {
    telefono: string;
    nombre: string;
    fechaVencimiento: Date;
  }): Promise<{ messageId: string }> {
    const res = await axios.post(
      `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: params.telefono,
        type: 'text',
        text: { body: `Hola ${params.nombre}, tu membresía vence el ${params.fechaVencimiento.toLocaleDateString()}.` },
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return { messageId: res.data.messages[0].id };
  }
}
```

---

## 8. Controller

En `interfaces/http/controllers/`. DI de casos de uso por constructor. Cada handler: saca `gymId`
del usuario autenticado (nunca del body), llama al caso de uso, responde con la forma fija, y
enruta cualquier error con `try/catch → next(error)`. No mete lógica de negocio.

```typescript
import { Response, NextFunction } from 'express';
import { CreateMembershipUseCase } from '../../../application/use-cases/membership/CreateMembershipUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class MembershipController {
  constructor(private createMembershipUseCase: CreateMembershipUseCase) {}

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user?.gymId) {
        res.status(403).json({ status: 'error', message: 'Gym access required' });
        return;
      }

      const result = await this.createMembershipUseCase.execute({
        ...req.body,
        gymId: user.gymId,
      });

      res.status(201).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }
}
```

---

## 9. Validador Zod

En `interfaces/http/validators/`. Un esquema por operación de escritura. Se aplica como middleware
en la ruta. Las fechas que llegan como string se transforman aquí.

```typescript
import { z } from 'zod';

export const createMembershipSchema = z.object({
  clientId: z.string().min(1),
  plan: z.string().min(1),
  precio: z.number().positive(),
  fechaInicio: z.coerce.date(),
  fechaFin: z.coerce.date(),
});

export const updateMembershipSchema = createMembershipSchema.partial();
```

---

## 10. Ruta = composition root

En `interfaces/http/routes/`. La factory `createXRoutes()` es el **único** lugar donde se instancian
adaptadores concretos y se cablean con los casos de uso y el controller. Se registra en
`interfaces/http/routes/index.ts`. Fíjate en `client.routes.ts` para los helpers `validateBody` /
`validateQuery` (que hoy están definidos inline en ese archivo — reúsalos o extráelos si repites).

```typescript
import { Router } from 'express';
import { MongoMembershipRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMembershipRepository';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { CreateMembershipUseCase } from '../../../application/use-cases/membership/CreateMembershipUseCase';
import { MembershipController } from '../controllers/MembershipController';
import { createMembershipSchema } from '../validators/membership.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

function validateBody(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const createMembershipRoutes = () => {
  const router = Router();

  // Adaptadores concretos: ÚNICO lugar donde se hace `new Mongo...`
  const membershipRepository = new MongoMembershipRepository();
  const clientRepository = new MongoClientRepository();

  // Casos de uso: reciben puertos
  const createMembershipUseCase = new CreateMembershipUseCase(membershipRepository, clientRepository);

  // Controller: recibe casos de uso
  const membershipController = new MembershipController(createMembershipUseCase);

  router.post('/', validateBody(createMembershipSchema), (req, res, next) =>
    membershipController.create(req as AuthenticatedRequest, res, next)
  );

  return router;
};
```

Y en `interfaces/http/routes/index.ts` registra:

```typescript
router.use('/memberships', createMembershipRoutes());
```
