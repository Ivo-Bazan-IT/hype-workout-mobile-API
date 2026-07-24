/**
 * Contrato para integración con módulo Arca/Facturación AFIP
 * Este repositorio permite emitir y gestionar facturas electrónicas
 */
export interface IInvoiceRepository {
  /**
   * Suma de ingresos por mes - usado en dashboard
   * @param gymId ID del gym (tenant)
   * @param year Año de consulta
   * @param month Mes de consulta (1-12)
   * @returns Suma total de montos emitidos en ese período
   */
  sumRevenueByMonth(gymId: string, year: number, month: number): Promise<number>;

  /**
   * Crear una nueva factura
   */
  create(invoice: Omit<InvoiceDocument, '_id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceDocument>;

  /**
   * Actualizar una factura existente
   */
  update(id: string, data: Partial<InvoiceDocument>): Promise<InvoiceDocument | null>;

  /**
   * Buscar una factura por ID
   */
  findById(id: string): Promise<InvoiceDocument | null>;
}

export interface InvoiceDocument {
  _id: string;
  gymId: string;
  clientId: string;
  tipoComprobante: string;
  cae: string;
  monto: number;
  fechaEmision: Date;
  estado: 'emitida' | 'anulada' | 'error' | 'pendiente';
  errorLog?: string;
  createdAt: Date;
  updatedAt: Date;
}