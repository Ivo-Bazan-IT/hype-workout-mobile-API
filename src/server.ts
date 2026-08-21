import 'dotenv/config'; // Load .env before env.ts
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { MongoInvoiceRepository } from './infrastructure/database/mongoose/repositories/MongoInvoiceRepository';
import { MongoGymRepository } from './infrastructure/database/mongoose/repositories/MongoGymRepository';
import { MongoGymSecretsRepository } from './infrastructure/database/mongoose/repositories/MongoGymSecretsRepository';
import { MongoClientRepository } from './infrastructure/database/mongoose/repositories/MongoClientRepository';
import { EncryptionService } from './infrastructure/encryption/EncryptionService';
import { AfipSdkAdapterFactory } from './infrastructure/external/billing/AfipSdkAdapterFactory';
import { AfipSdkOwnAccountAdapterFactory } from './infrastructure/external/billing/AfipSdkOwnAccountAdapterFactory';
import { EmitPendingInvoicesUseCase } from './application/use-cases/invoice/EmitPendingInvoicesUseCase';
import { InvoiceEmissionScheduler } from './infrastructure/queues/InvoiceEmissionScheduler';

/**
 * Composition root del worker de facturación.
 *
 * Vive acá y no en `createApp` a propósito: el worker es del PROCESO, no de la app
 * HTTP. Si lo armara la app, cada `createApp()` de un test e2e levantaría un
 * temporizador emitiendo facturas de verdad contra AFIP.
 */
const createInvoiceScheduler = (): InvoiceEmissionScheduler => {
  const invoiceRepository = new MongoInvoiceRepository();
  const gymRepository = new MongoGymRepository();
  const gymSecretsRepo = new MongoGymSecretsRepository(new EncryptionService());
  const clientRepository = new MongoClientRepository();
  const ownAccountProviderFactory = new AfipSdkOwnAccountAdapterFactory();
  const legacyProviderFactory = new AfipSdkAdapterFactory();

  const emitPendingInvoices = new EmitPendingInvoicesUseCase(
    invoiceRepository,
    gymRepository,
    gymSecretsRepo,
    clientRepository,
    ownAccountProviderFactory,
    legacyProviderFactory
  );

  return new InvoiceEmissionScheduler(emitPendingInvoices);
};

const startServer = async (): Promise<void> => {
  try {
    // Conectar a la base de datos
    await connectDatabase();

    const app = await createApp();

    // En modo `cron` no se arranca nada: el trabajo lo dispara un cron externo
    // contra POST /api/internal/jobs/emit-invoices. Levantar igual el scheduler
    // no rompería —el lease evita la doble emisión— pero serían dos cosas
    // haciendo el mismo trabajo y un solo lugar donde mirar cuando algo falle.
    const invoiceScheduler =
      env.INVOICE_WORKER_MODE === 'interno' ? createInvoiceScheduler() : null;
    invoiceScheduler?.start();

    if (!invoiceScheduler) {
      console.log('🧾 Worker de facturación en modo cron: lo dispara POST /api/internal/jobs/emit-invoices');
    }

    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
      console.log(`📚 Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown
    const gracefulShutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      // El worker se frena primero: no tiene sentido tomar una factura nueva cuando
      // la base está por cerrarse. La que esté a mitad de camino la recupera el
      // próximo arranque cuando le vence el lease.
      invoiceScheduler?.stop();
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
