import { Types } from 'mongoose';
import { MembershipPlanType } from './Gym';

/**
 * Ciclo de vida de un pedido de renovación por Mercado Pago:
 *
 *   pendiente ──MP aprueba el pago──> aprobado
 *       │  │
 *       │  └──MP rechaza/cancela el pago──> rechazado
 *       └──se pidió otro link, o se confirmó un cobro en efectivo──> cancelado
 *
 * `expirado` queda reservado para un futuro job que cierre links viejos que nunca
 * se pagaron; hoy no lo escribe nadie.
 */
export type RenewalRequestStatus = 'pendiente' | 'aprobado' | 'rechazado' | 'expirado' | 'cancelado';

/** Snapshot del plan al momento de crear el pedido: si el gym cambia precios
 *  después, no altera un link que ya se le mandó al socio. */
export interface RenewalRequestPlan {
  tipo: MembershipPlanType;
  duracionDias: number;
  monto: number;
}

export interface RenewalRequest {
  id: string;
  gymId: string;
  clientId: string;
  plan: RenewalRequestPlan;
  /** Único — es lo que ata el pago de Mercado Pago a este pedido. */
  externalReference: string;
  mercadoPagoPaymentLinkId?: string;
  /** URL que se le manda al socio por WhatsApp. */
  initPoint?: string;
  /** Se completa recién cuando Mercado Pago confirma el pago. */
  mercadoPagoPaymentId?: string;
  estado: RenewalRequestStatus;
  fechaVencimientoAnterior: Date;
  /** Ya calculada al crear el pedido; se aplica tal cual al aprobar. */
  fechaVencimientoNueva: Date;
  createdAt: Date;
  updatedAt: Date;
  resueltoEn?: Date;
}

export type CreateRenewalRequestInput = Omit<
  RenewalRequest,
  'id' | 'createdAt' | 'updatedAt' | 'estado' | 'resueltoEn'
> & { estado?: RenewalRequestStatus };

export class RenewalRequestEntity implements RenewalRequest {
  public id: string;
  public gymId: string;
  public clientId: string;
  public plan: RenewalRequestPlan;
  public externalReference: string;
  public mercadoPagoPaymentLinkId?: string;
  public initPoint?: string;
  public mercadoPagoPaymentId?: string;
  public estado: RenewalRequestStatus;
  public fechaVencimientoAnterior: Date;
  public fechaVencimientoNueva: Date;
  public createdAt: Date;
  public updatedAt: Date;
  public resueltoEn?: Date;

  constructor(props: RenewalRequest) {
    this.id = props.id;
    this.gymId = props.gymId;
    this.clientId = props.clientId;
    this.plan = props.plan;
    this.externalReference = props.externalReference;
    this.mercadoPagoPaymentLinkId = props.mercadoPagoPaymentLinkId;
    this.initPoint = props.initPoint;
    this.mercadoPagoPaymentId = props.mercadoPagoPaymentId;
    this.estado = props.estado;
    this.fechaVencimientoAnterior = props.fechaVencimientoAnterior;
    this.fechaVencimientoNueva = props.fechaVencimientoNueva;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.resueltoEn = props.resueltoEn;
  }
}

export class RenewalRequestMapper {
  static toDomain(doc: any): RenewalRequest {
    return new RenewalRequestEntity({
      id: doc._id.toString(),
      gymId: doc.gymId.toString(),
      clientId: doc.clientId.toString(),
      plan: doc.plan,
      externalReference: doc.externalReference,
      mercadoPagoPaymentLinkId: doc.mercadoPagoPaymentLinkId,
      initPoint: doc.initPoint,
      mercadoPagoPaymentId: doc.mercadoPagoPaymentId,
      estado: doc.estado,
      fechaVencimientoAnterior: doc.fechaVencimientoAnterior,
      fechaVencimientoNueva: doc.fechaVencimientoNueva,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      resueltoEn: doc.resueltoEn
    });
  }

  static toPersistence(entity: RenewalRequestEntity): any {
    return {
      _id: entity.id,
      gymId: new Types.ObjectId(entity.gymId),
      clientId: new Types.ObjectId(entity.clientId),
      plan: entity.plan,
      externalReference: entity.externalReference,
      mercadoPagoPaymentLinkId: entity.mercadoPagoPaymentLinkId,
      initPoint: entity.initPoint,
      mercadoPagoPaymentId: entity.mercadoPagoPaymentId,
      estado: entity.estado,
      fechaVencimientoAnterior: entity.fechaVencimientoAnterior,
      fechaVencimientoNueva: entity.fechaVencimientoNueva,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      resueltoEn: entity.resueltoEn
    };
  }
}
