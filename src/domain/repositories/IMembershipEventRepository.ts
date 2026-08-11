import { MembershipEvent } from '../entities/MembershipEvent';

/**
 * Contrato de persistencia del stream de eventos de membresía.
 *
 * Es un log: se escribe y se lee, nunca se edita ni se borra. Un evento equivocado
 * se corrige con otro evento (`ajuste`), no reescribiendo el pasado — si no, los
 * números de un mes cerrado cambiarían solos y el dashboard dejaría de ser
 * confiable para tomar decisiones.
 *
 * Todos los métodos reciben `gymId` explícito: el historial de membresías de un gym
 * es su dato de negocio más sensible después de la facturación.
 */

export type CreateMembershipEventInput = Omit<
  MembershipEvent,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface IMembershipEventRepository {
  create(event: CreateMembershipEventInput): Promise<MembershipEvent>;

  /** Alta masiva, para la siembra inicial. Devuelve cuántos se insertaron. */
  createMany(events: ReadonlyArray<CreateMembershipEventInput>): Promise<number>;

  /** Historial completo de un socio, en orden cronológico. */
  findByClientId(clientId: string, gymId: string): Promise<MembershipEvent[]>;

  /** Cuántos eventos tiene el gym. Lo usa la siembra para no correr dos veces. */
  countByGym(gymId: string): Promise<number>;
}
