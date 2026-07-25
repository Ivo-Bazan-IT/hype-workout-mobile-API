import { beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer;

// `dotenv` solo se carga en server.ts, que los tests no arrancan. Los tests e2e sí
// importan config/env (vía createApp), que valida con zod al importarse: sin estas
// variables el import explota antes de correr nada. Solo se setean si faltan, para
// no pisar un entorno real.
process.env.NODE_ENV ??= 'test';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/gym-crm-test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

beforeAll(async () => {
  // Mongo en memoria: los tests corren offline, sin depender de un MongoDB local.
  // La primera ejecución descarga el binario de mongod (puede tardar unos segundos).
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  // Limpiar todas las colecciones antes de cada test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
