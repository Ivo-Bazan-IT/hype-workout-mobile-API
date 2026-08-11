import { Types } from 'mongoose';
import {
  IMembershipEventRepository,
  CreateMembershipEventInput,
} from '../../../../domain/repositories/IMembershipEventRepository';
import {
  MembershipEvent,
  MembershipEventMapper,
} from '../../../../domain/entities/MembershipEvent';
import { MembershipEventModel } from '../schemas/MembershipEventSchema';

export class MongoMembershipEventRepository implements IMembershipEventRepository {
  async create(event: CreateMembershipEventInput): Promise<MembershipEvent> {
    const doc = await MembershipEventModel.create(this.toDocument(event));
    return MembershipEventMapper.toDomain(doc);
  }

  async createMany(events: ReadonlyArray<CreateMembershipEventInput>): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    const docs = await MembershipEventModel.insertMany(events.map((e) => this.toDocument(e)));
    return docs.length;
  }

  async findByClientId(clientId: string, gymId: string): Promise<MembershipEvent[]> {
    const docs = await MembershipEventModel.find({ clientId, gymId }).sort({ fecha: 1 });
    return docs.map(MembershipEventMapper.toDomain);
  }

  async countByGym(gymId: string): Promise<number> {
    return MembershipEventModel.countDocuments({ gymId });
  }

  private toDocument(event: CreateMembershipEventInput): Record<string, unknown> {
    return {
      gymId: new Types.ObjectId(event.gymId),
      clientId: new Types.ObjectId(event.clientId),
      tipo: event.tipo,
      fecha: event.fecha,
      monto: event.monto,
      vencimientoAnterior: event.vencimientoAnterior,
      vencimientoNuevo: event.vencimientoNuevo,
      origen: event.origen,
    };
  }
}
