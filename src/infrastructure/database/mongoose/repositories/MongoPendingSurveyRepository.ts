import { PendingSurveyModel } from '../schemas/PendingSurveySchema';

export class MongoPendingSurveyRepository {
  async createOrUpdate(userId: string, datos: Record<string, any>) {
    const doc = await PendingSurveyModel.findOneAndUpdate(
      { userId: require('mongoose').Types.ObjectId(userId) },
      { datos, actualizadoEn: new Date() },
      { upsert: true, new: true }
    );
    return doc ? { id: doc._id.toString(), userId: doc.userId.toString(), datos: doc.datos, creadoEn: doc.creadoEn, actualizadoEn: doc.actualizadoEn } : null;
  }

  async findByUserId(userId: string) {
    const doc = await PendingSurveyModel.findOne({ userId: require('mongoose').Types.ObjectId(userId) });
    return doc ? { id: doc._id.toString(), userId: doc.userId.toString(), datos: doc.datos, creadoEn: doc.creadoEn, actualizadoEn: doc.actualizadoEn } : null;
  }

  async delete(userId: string) {
    await PendingSurveyModel.deleteOne({ userId: require('mongoose').Types.ObjectId(userId) });
  }
}
