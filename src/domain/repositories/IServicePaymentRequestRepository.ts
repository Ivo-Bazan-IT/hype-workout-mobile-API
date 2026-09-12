import { ServicePaymentRequest } from '../entities/ServicePaymentRequest';

export interface IServicePaymentRequestRepository {
  create(data: Partial<ServicePaymentRequest>): Promise<ServicePaymentRequest>;
  findById(id: string, gymId: string): Promise<ServicePaymentRequest | null>;
  update(id: string, gymId: string, data: Partial<ServicePaymentRequest>): Promise<ServicePaymentRequest | null>;
  search(gymId: string, filters: { clientId?: string; estado?: string }, page?: number, limit?: number): Promise<any>;
}
