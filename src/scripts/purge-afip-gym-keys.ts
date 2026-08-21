import 'dotenv/config'; // Load .env before env.ts (igual que server.ts)
import { connectDatabase, disconnectDatabase } from '../config/database';
import { GymModel } from '../infrastructure/database/mongoose/schemas/GymSchema';

/**
 * Borra de Mongo la credencial de AFIP SDK que antes se guardaba por gimnasio.
 *
 * La cuenta de AFIP SDK pasó a ser una sola, la de la plataforma, y los campos
 * `afipConfig.encryptedApiKey` / `afipConfig.apiKeySecretRef` salieron del schema.
 * Mongoose deja de leerlos y de escribirlos, pero los documentos ya guardados los
 * conservan: `encryptedApiKey` es una credencial cifrada de un tercero que no
 * tiene por qué seguir ahí, y `apiKeySecretRef` es ruido que confunde a quien
 * mire la colección.
 *
 * Es idempotente: correrlo dos veces no rompe nada, la segunda no toca ningún
 * documento. NO borra `puntoVenta`, `taxCondition` ni `isActive`, que son la
 * identidad fiscal del gym y siguen en uso.
 *
 * Uso: npm run purge:afip-keys
 */
const purgarCredencialesAfipPorGym = async (): Promise<void> => {
  await connectDatabase();

  try {
    const filtro = {
      $or: [
        { 'afipConfig.encryptedApiKey': { $exists: true } },
        { 'afipConfig.apiKeySecretRef': { $exists: true } },
      ],
    };

    const pendientes = await GymModel.countDocuments(filtro);

    if (pendientes === 0) {
      console.log('ℹ️  Ningún gimnasio tiene credencial de AFIP guardada. Nada que hacer.');
      return;
    }

    console.log(`🔎 ${pendientes} gimnasio(s) con credencial de AFIP guardada.`);

    // `strict: false` es necesario: los campos ya no están en el schema, y sin
    // esto Mongoose descarta el $unset por considerarlos desconocidos.
    const resultado = await GymModel.updateMany(
      filtro,
      { $unset: { 'afipConfig.encryptedApiKey': '', 'afipConfig.apiKeySecretRef': '' } },
      { strict: false }
    );

    console.log(`✅ Credenciales eliminadas de ${resultado.modifiedCount} gimnasio(s).`);
    console.log('   La facturación pasa a usar AFIP_SDK_API_KEY para todos.');
  } finally {
    // Se cierra la conexión pase lo que pase, así el proceso no queda colgado
    await disconnectDatabase();
  }
};

purgarCredencialesAfipPorGym().catch((error) => {
  console.error('❌ Failed to purge per-gym AFIP keys:', error);
  process.exit(1);
});
