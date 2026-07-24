export type InvoiceStatus = 'emitida' | 'anulada' | 'error' | 'pendiente';

export interface Invoice {
  id: string;
  gymId: string;
  clientId: string;
  tipoComprobante: string;
  cae: string;
  monto: number;
  fechaEmision: Date;
  estado: InvoiceStatus;
  errorLog?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class InvoiceEntity implements Invoice {
  constructor(
    public id: string,
    public gymId: string,
    public clientId: string,
    public tipoComprobante: string,
    public cae: string,
    public monto: number,
    public estado: InvoiceStatus = 'pendiente',
    public fechaEmision: Date = new Date(),
    public errorLog?: string,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}
}

export class InvoiceMapper {
  static toDomain(doc: any): Invoice {
    return new InvoiceEntity(
      doc._id.toString(),
      doc.gymId.toString(),
      doc.clientId.toString(),
      doc.tipoComprobante,
      doc.cae,
      doc.monto,
      doc.estado,
      doc.fechaEmision,
      doc.errorLog,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static toPersistence(entity: InvoiceEntity, gymId: string, clientId: string): any {
    return {
      gymId: gymId,
      clientId: clientId,
      tipoComprobante: entity.tipoComprobante,
      cae: entity.cae,
      monto: entity.monto,
      estado: entity.estado,
      errorLog: entity.errorLog
    };
  }
}