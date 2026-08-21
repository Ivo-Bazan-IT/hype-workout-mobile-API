import { Router } from 'express';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoInvoiceRepository } from '../../../infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoMembershipEventRepository } from '../../../infrastructure/database/mongoose/repositories/MongoMembershipEventRepository';
import { CreateClientUseCase } from '../../../application/use-cases/client/CreateClientUseCase';
import { SearchClientsUseCase } from '../../../application/use-cases/client/SearchClientsUseCase';
import { UpdateClientUseCase } from '../../../application/use-cases/client/UpdateClientUseCase';
import { DeleteClientUseCase } from '../../../application/use-cases/client/DeleteClientUseCase';
import { RenewClientUseCase } from '../../../application/use-cases/client/RenewClientUseCase';
import { UpdateClientSurveyUseCase } from '../../../application/use-cases/client/UpdateClientSurveyUseCase';
import { RegisterFirstContactUseCase } from '../../../application/use-cases/client/RegisterFirstContactUseCase';
import { RegisterFormSentUseCase } from '../../../application/use-cases/client/RegisterFormSentUseCase';
import { ClientController } from '../controllers/ClientController';
import { createClientSchema, updateClientSchema, updateClientSurveySchema } from '../validators/client.validator';
import { registerFirstContactSchema, renewClientSchema } from '../validators/client.validator';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

// Middleware para validar query params
function validateQuery(schema: z.ZodSchema<any>) {
  return (req: any, _res: any, next: any) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Middleware para validar body con Zod
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

export const createClientRoutes = () => {
  const router = Router();

  const clientRepository = new MongoClientRepository();
  const gymRepository = new MongoGymRepository();
  const invoiceRepository = new MongoInvoiceRepository();
  const membershipEventRepository = new MongoMembershipEventRepository();

  const createClientUseCase = new CreateClientUseCase(clientRepository, membershipEventRepository);
  const searchClientsUseCase = new SearchClientsUseCase(clientRepository);
  const updateClientUseCase = new UpdateClientUseCase(clientRepository, membershipEventRepository);
  const deleteClientUseCase = new DeleteClientUseCase(clientRepository);
  // Renovar ya no necesita las credenciales de AFIP ni el proveedor de facturación:
  // solo deja el comprobante encolado. Quien los usa es el worker de emisión.
  const renewClientUseCase = new RenewClientUseCase(
    clientRepository,
    gymRepository,
    invoiceRepository,
    membershipEventRepository
  );

  const updateClientSurveyUseCase = new UpdateClientSurveyUseCase(clientRepository);
  const registerFirstContactUseCase = new RegisterFirstContactUseCase(clientRepository);
  const registerFormSentUseCase = new RegisterFormSentUseCase(clientRepository);

  const clientController = new ClientController(
    createClientUseCase,
    searchClientsUseCase,
    updateClientUseCase,
    deleteClientUseCase,
    renewClientUseCase,
    updateClientSurveyUseCase,
    registerFirstContactUseCase,
    registerFormSentUseCase,
    clientRepository
  );

  // GET /api/clients - Listar clientes
  router.get('/', (req, res, next) =>
    clientController.list(req as AuthenticatedRequest, res, next)
  );

  // GET /api/clients/search - Búsqueda con filtros
  router.get('/search', validateQuery(z.object({
    q: z.string().optional(),
    estado: z.enum(['activo', 'inactivo', 'pendiente']).optional(),
    page: z.string().transform(Number).default('1'),
    limit: z.string().transform(Number).default('20'),
  })), (req, res, next) =>
    clientController.search(req as AuthenticatedRequest, res, next)
  );

  // GET /api/clients/expiring - Clientes próximos a vencer
  router.get('/expiring', (req, res, next) =>
    clientController.getExpiring(req as AuthenticatedRequest, res, next)
  );

  // GET /api/clients/:id - Obtener un cliente
  router.get('/:id', (req, res, next) =>
    clientController.get(req as AuthenticatedRequest, res, next)
  );

  // POST /api/clients - Crear cliente
  router.post('/', validateBody(createClientSchema), (req, res, next) =>
    clientController.create(req as AuthenticatedRequest, res, next)
  );

  // PUT /api/clients/:id - Actualizar cliente
  router.put('/:id', validateBody(updateClientSchema), (req, res, next) =>
    clientController.update(req as AuthenticatedRequest, res, next)
  );

  // PATCH /api/clients/:id/encuesta - Completar la encuesta (fusiona, no reemplaza)
  router.patch('/:id/encuesta', validateBody(updateClientSurveySchema), (req, res, next) =>
    clientController.updateSurvey(req as AuthenticatedRequest, res, next)
  );

  // POST /api/clients/:id/contacto - Marcar el primer contacto con un lead.
  // Idempotente: repetirlo NO corre la fecha original (ver el caso de uso).
  router.post('/:id/contacto', validateBody(registerFirstContactSchema), (req, res, next) =>
    clientController.registerFirstContact(req as AuthenticatedRequest, res, next)
  );

  // POST /api/clients/:id/formulario-enviado - Registrar que se le mandó el
  // formulario de ingreso por WhatsApp. Sin body: la fecha es siempre ahora, y a
  // diferencia del contacto se PISA en cada reenvío (ver el caso de uso).
  router.post('/:id/formulario-enviado', (req, res, next) =>
    clientController.registerFormSent(req as AuthenticatedRequest, res, next)
  );

  // DELETE /api/clients/:id - Eliminar cliente (soft delete)
  router.delete('/:id', (req, res, next) =>
    clientController.delete(req as AuthenticatedRequest, res, next)
  );

  // POST /api/clients/:id/renew - Renovar cliente
  router.post('/:id/renew', validateBody(renewClientSchema), (req, res, next) =>
    clientController.renew(req as AuthenticatedRequest, res, next)
  );

  return router;
};