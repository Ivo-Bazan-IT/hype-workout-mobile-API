// Tiene que ir ANTES que cualquier import que arrastre `config/env`, que valida con
// zod en el momento de importarse: `connectDatabase` lo arrastra. Cargar el .env más
// tarde (dentro del arranque) llega tarde — los imports de CommonJS ya se evaluaron.
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { ClientModel } from '../infrastructure/database/mongoose/schemas/ClientSchema';
import { MembershipEventModel } from '../infrastructure/database/mongoose/schemas/MembershipEventSchema';
import { CreateMembershipEventInput } from '../domain/repositories/IMembershipEventRepository';

/**
 * Siembra el stream de eventos de membresía a partir de los clientes ya cargados.
 *
 * **Qué siembra, y por qué solo eso.** De cada cliente se conocen tres cosas que son
 * hecho: su `fechaInicio`, su `fechaVencimiento` vigente, y la fecha y el monto de
 * cada renovación. Lo único que NO se guardó nunca es a qué vencimiento llevó cada
 * renovación pasada, así que:
 *
 *  - La ventana VIGENTE se siembra completa (inicio + vencimiento reales). Sin esto
 *    el dashboard marcaría 0 socios activos el día del deploy, y los socios irían
 *    apareciendo de a uno a medida que renovaran: un mes entero de números mal.
 *  - Las renovaciones pasadas se siembran con su fecha y su monto, pero SIN
 *    vencimiento. Habilitan la historia real de ingresos y no dibujan ventana, así
 *    que no inventan ni churn ni retención.
 *
 * El resultado es que los KPIs de plata tienen historia desde el día uno y los de
 * retención arrancan vacíos y se llenan solos con el uso. Nada estimado.
 *
 * Es idempotente por gym: si el gym ya tiene eventos, se lo saltea.
 */

interface RenovacionCruda {
  fecha: Date;
  monto: number;
}

interface ClienteCrudo {
  _id: unknown;
  gymId: unknown;
  fechaInicio: Date;
  fechaVencimiento: Date;
  historialRenovaciones?: RenovacionCruda[];
}

const porFecha = (a: RenovacionCruda, b: RenovacionCruda): number =>
  a.fecha.getTime() - b.fecha.getTime();

/** Eventos de un cliente: su alta, sus renovaciones pasadas y su ventana vigente. */
export const eventosDe = (cliente: ClienteCrudo): CreateMembershipEventInput[] => {
  const gymId = String(cliente.gymId);
  const clientId = String(cliente._id);

  const renovaciones = [...(cliente.historialRenovaciones ?? [])].sort(porFecha);
  const ultima = renovaciones[renovaciones.length - 1];

  // El alta abre la ventana original. Si el socio nunca renovó, esa misma ventana es
  // la vigente y su vencimiento es dato real.
  const eventos: CreateMembershipEventInput[] = [
    {
      gymId,
      clientId,
      tipo: 'alta',
      fecha: cliente.fechaInicio,
      vencimientoNuevo: ultima === undefined ? cliente.fechaVencimiento : undefined,
      origen: 'historico',
    },
  ];

  renovaciones.forEach((renovacion, indice) => {
    const esLaUltima = indice === renovaciones.length - 1;

    eventos.push({
      gymId,
      clientId,
      tipo: 'renovacion',
      fecha: renovacion.fecha,
      monto: renovacion.monto,
      // Solo de la última se sabe a qué vencimiento llevó: es el que el cliente
      // tiene hoy. De las anteriores no consta, y no se estima.
      vencimientoNuevo: esLaUltima ? cliente.fechaVencimiento : undefined,
      origen: 'historico',
    });
  });

  return eventos;
};

/**
 * Siembra todos los gyms sobre una conexión ya abierta.
 *
 * Va separada del arranque del proceso para que la lógica —que es donde vive el
 * criterio de qué es dato real— se pueda ejercitar contra Mongo en memoria. Sembrar
 * mal es caro: el stream es un log que no se reescribe, así que un evento inventado
 * queda para siempre en los números del gym.
 */
export const sembrarEventosDeMembresia = async (): Promise<void> => {
  const gymIds: unknown[] = await ClientModel.distinct('gymId');

  if (gymIds.length === 0) {
    console.log('ℹ️  No hay clientes cargados: nada que sembrar.');
    return;
  }

  for (const gymId of gymIds) {
    const yaTiene = await MembershipEventModel.countDocuments({ gymId });

    if (yaTiene > 0) {
      console.log(`ℹ️  Gym ${String(gymId)} ya tiene ${yaTiene} eventos - se saltea.`);
      continue;
    }

    // Los eliminados (soft delete) no se siembran: no son socios ni bajas.
    const clientes = await ClientModel.find({
      gymId,
      estado: { $ne: 'inactivo' },
    }).select('_id gymId fechaInicio fechaVencimiento historialRenovaciones').lean<ClienteCrudo[]>();

    const eventos = clientes.flatMap(eventosDe);

    if (eventos.length === 0) {
      console.log(`ℹ️  Gym ${String(gymId)} no tiene clientes vigentes.`);
      continue;
    }

    await MembershipEventModel.insertMany(eventos);

    console.log(
      `✅ Gym ${String(gymId)}: ${eventos.length} eventos sembrados para ${clientes.length} socios.`
    );
  }
};

const main = async (): Promise<void> => {
  await connectDatabase();

  try {
    await sembrarEventosDeMembresia();
  } finally {
    // Se cierra la conexión pase lo que pase, así el proceso no queda colgado
    await disconnectDatabase();
  }
};

// Solo cuando se ejecuta como script (`npm run seed:membership-events`).
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Failed to seed membership events:', error);
    process.exit(1);
  });
}
