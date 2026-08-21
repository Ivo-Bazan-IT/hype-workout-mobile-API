import 'dotenv/config'; // Load .env before env.ts (igual que server.ts)
import { connectDatabase, disconnectDatabase } from '../config/database';
import { RoutineModel } from '../infrastructure/database/mongoose/schemas/RoutineSchema';
import { calcularVencimientoRutina, VIGENCIA_RUTINA_DIAS } from '../domain/routine/vigencia';

/**
 * Recalcula el vencimiento de las rutinas ya generadas.
 *
 * Hasta ahora `routine.fechaVencimiento` guardaba el vencimiento de la MEMBRESÍA del
 * socio, que es otra fecha y otra pregunta. Las rutinas nuevas ya nacen con el
 * vencimiento correcto —30 días desde que se generaron—, pero las que están en la
 * base siguen con la fecha de la cuota: el listado de rutinas por vencer y el
 * contador de `/routines/expiring` muestran datos que no significan lo que dicen.
 *
 * La fecha base es `fechaGeneracion`. Cuando falta —rutinas que quedaron en `error`
 * antes de que la IA respondiera— se usa `createdAt`, que es cuándo se intentó: para
 * una rutina que nunca se generó, cualquier vencimiento es igual de convencional, y
 * `createdAt` al menos la deja donde corresponde en el orden cronológico.
 *
 * Es idempotente en el sentido que importa: calcula siempre desde el origen, así que
 * correrlo dos veces deja el mismo resultado. NO es reversible: la fecha vieja
 * (el vencimiento de la cuota) se pierde, y está bien — vive en el cliente, que es
 * su dueño.
 *
 * Uso: npm run backfill:vencimiento-rutinas
 */
const backfillVencimientoRutinas = async (): Promise<void> => {
  await connectDatabase();

  try {
    const rutinas = await RoutineModel.find({}, { fechaGeneracion: 1, createdAt: 1, fechaVencimiento: 1 });

    if (rutinas.length === 0) {
      console.log('ℹ️  No hay rutinas en la base. Nada que hacer.');
      return;
    }

    console.log(`🔎 ${rutinas.length} rutina(s) a revisar (vigencia de ${VIGENCIA_RUTINA_DIAS} días).`);

    let corregidas = 0;
    let sinFechaGeneracion = 0;

    for (const rutina of rutinas) {
      const base = rutina.fechaGeneracion ?? rutina.createdAt;
      if (!rutina.fechaGeneracion) sinFechaGeneracion++;

      const correcto = calcularVencimientoRutina(base);

      // Se compara antes de escribir para no tocar documentos que ya están bien:
      // así el resumen dice cuántas estaban mal de verdad, y no cuántas hay.
      if (rutina.fechaVencimiento?.getTime() === correcto.getTime()) continue;

      await RoutineModel.updateOne({ _id: rutina._id }, { $set: { fechaVencimiento: correcto } });
      corregidas++;
    }

    console.log(`✅ ${corregidas} rutina(s) con el vencimiento corregido.`);
    if (sinFechaGeneracion > 0) {
      console.log(
        `   ${sinFechaGeneracion} no tenían fechaGeneracion (quedaron en error): se usó createdAt.`
      );
    }
  } finally {
    // Se cierra la conexión pase lo que pase, así el proceso no queda colgado
    await disconnectDatabase();
  }
};

backfillVencimientoRutinas().catch((error) => {
  console.error('❌ Failed to backfill routine expiry dates:', error);
  process.exit(1);
});
