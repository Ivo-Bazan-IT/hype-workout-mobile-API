import { Types } from 'mongoose';

/**
 * Evento del ciclo de vida de la membresía de un socio.
 *
 * Es el stream crudo del que se derivan churn, retención, cohortes y MRR. Existe
 * porque `Client.historialRenovaciones` guarda `{ fecha, monto }` y **no** a qué
 * vencimiento llevó cada renovación: sin ese dato no se puede responder "¿cuántos
 * socios activos había el 1 de marzo?" hacia atrás.
 *
 * La baja NO es un evento de esta lista: nadie la dispara. Se deriva de las
 * ventanas que estos eventos dibujan, en `domain/kpis/membership.ts`.
 */

/**
 * - `alta`: el socio entra por primera vez.
 * - `renovacion`: pagó y se extendió el vencimiento.
 * - `ajuste`: alguien movió `fechaVencimiento` a mano desde el ABM, sin cobro de
 *   por medio. Se registra para que una corrección humana sea auditable en vez de
 *   desincronizar los KPIs en silencio.
 */
export type MembershipEventType = 'alta' | 'renovacion' | 'ajuste';

/**
 * - `operacion`: lo generó el sistema al ocurrir el hecho. Completo y confiable.
 * - `historico`: lo sembró el script de migración a partir de datos que ya estaban
 *   en la base. Fecha y monto son reales; el vencimiento resultante puede no
 *   constar, y en ese caso NO se inventa.
 */
export type MembershipEventOrigin = 'operacion' | 'historico';

export interface MembershipEvent {
  id: string;
  gymId: string;
  clientId: string;
  tipo: MembershipEventType;
  /** Cuándo ocurrió el hecho (no cuándo se registró: para eso está `createdAt`). */
  fecha: Date;
  /**
   * Monto cobrado, en PESOS — misma unidad que `Invoice.monto` y que
   * `historialRenovaciones[].monto`. La conversión a centavos para los KPIs la hace
   * el adaptador de métricas al leer, no esta entidad.
   *
   * Ausente en las altas (el alta no registra cobro) y en los ajustes.
   */
  monto?: number;
  vencimientoAnterior?: Date;
  /**
   * Vencimiento que dejó esta operación.
   *
   * **Ausente significa "no consta"**, y solo pasa en eventos `historico`: son las
   * renovaciones viejas de las que se conoce la fecha y el monto pero no hasta
   * cuándo extendieron la membresía. Un evento sin este dato no dibuja ventana, así
   * que no participa del churn — que es exactamente lo que queremos: dato real o
   * nada, nunca una estimación disfrazada de hecho.
   */
  vencimientoNuevo?: Date;
  origen: MembershipEventOrigin;
  createdAt: Date;
  updatedAt: Date;
}

export class MembershipEventEntity implements MembershipEvent {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public tipo: MembershipEventType,
    public fecha: Date,
    public origen: MembershipEventOrigin = 'operacion',
    public monto?: number,
    public vencimientoAnterior?: Date,
    public vencimientoNuevo?: Date,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class MembershipEventMapper {
  static toDomain(doc: any): MembershipEvent {
    return new MembershipEventEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.tipo,
      doc.fecha,
      doc.origen,
      doc.monto,
      doc.vencimientoAnterior,
      doc.vencimientoNuevo,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: MembershipEventEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      tipo: entity.tipo,
      fecha: entity.fecha,
      monto: entity.monto,
      vencimientoAnterior: entity.vencimientoAnterior,
      vencimientoNuevo: entity.vencimientoNuevo,
      origen: entity.origen,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
