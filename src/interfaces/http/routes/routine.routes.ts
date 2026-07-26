import { Router } from 'express';
import { RoutineController } from '../controllers/RoutineController';
import { GenerateRoutineUseCase } from '../../../application/use-cases/routine/GenerateRoutineUseCase';
import { MongoGymRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoGymSecretsRepository } from '../../../infrastructure/database/mongoose/repositories/MongoGymSecretsRepository';
import { EncryptionService } from '../../../infrastructure/encryption/EncryptionService';
import { MongoClientRepository } from '../../../infrastructure/database/mongoose/repositories/MongoClientRepository';
import { MongoRoutineRepository } from '../../../infrastructure/database/mongoose/repositories/MongoRoutineRepository';
import { MongoAiUsageRepository } from '../../../infrastructure/database/mongoose/repositories/MongoAiUsageRepository';
import { AIProviderFactory } from '../../../infrastructure/external/ai/AIProviderFactory';
import { PuppeteerPdfGenerator } from '../../../infrastructure/external/pdf/PdfGenerator';
import { FilePlantillaRutinaProvider } from '../../../infrastructure/external/pdf/FilePlantillaRutinaProvider';
import { MetaCloudApiProviderFactory } from '../../../infrastructure/external/whatsapp/MetaCloudApiProviderFactory';
import { LocalFileStorage } from '../../../infrastructure/storage/LocalFileStorage';

const createRoutineRouter = () => {
  const router = Router();

  // Adaptadores concretos: ÚNICO lugar donde se instancia infraestructura
  const routineRepository = new MongoRoutineRepository();
  const clientRepository = new MongoClientRepository();
  const gymRepository = new MongoGymRepository();
  const gymSecretsRepo = new MongoGymSecretsRepository(new EncryptionService());
  const aiProviderFactory = new AIProviderFactory();
  const pdfGenerator = new PuppeteerPdfGenerator();
  const whatsappProviderFactory = new MetaCloudApiProviderFactory();
  const fileStorage = new LocalFileStorage();
  const aiUsageRepository = new MongoAiUsageRepository();
  const plantillaProvider = new FilePlantillaRutinaProvider();

  // Caso de uso: recibe solo puertos
  const generateRoutineUseCase = new GenerateRoutineUseCase(
    routineRepository,
    clientRepository,
    gymRepository,
    gymSecretsRepo,
    aiProviderFactory,
    pdfGenerator,
    whatsappProviderFactory,
    fileStorage,
    aiUsageRepository,
    plantillaProvider
  );

  const routineController = new RoutineController(
    generateRoutineUseCase,
    routineRepository,
    gymRepository,
    gymSecretsRepo,
    clientRepository,
    whatsappProviderFactory,
    fileStorage
  );

  router.post('/generate/:clientId', (req, res, next) =>
    routineController.generate(req, res, next)
  );

  // Las rutas estáticas van ANTES de /:id: Express matchea en orden de registro,
  // así que /expiring caería en /:id con id="expiring" y devolvería 404.
  router.get('/expiring', (req, res, next) =>
    routineController.getExpiring(req, res, next)
  );

  router.get('/client/:clientId', (req, res, next) =>
    routineController.getByClient(req, res, next)
  );

  router.get('/:id', (req, res, next) =>
    routineController.get(req, res, next)
  );

  router.post('/:id/resend', (req, res, next) =>
    routineController.resend(req, res, next)
  );

  return router;
};

export const routineRoutes = createRoutineRouter();
