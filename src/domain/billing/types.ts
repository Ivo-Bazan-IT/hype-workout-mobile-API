export enum GymTaxCondition {
  MONOTRIBUTO = 'MONOTRIBUTO',
  RESPONSABLE_INSCRIPTO = 'RESPONSABLE_INSCRIPTO',
  EXENTO = 'EXENTO'
}

export interface TenantApiConfig {
  tenantId: string;
  cuit: number;
  puntoVenta: number;
  taxCondition: GymTaxCondition;
  afipSdkApiKey: string; // Token de acceso específico del tenant
}

export interface GymInvoicePayload {
  amount: number;
  clientDocument: number; // CUIT o DNI
  isConsumidorFinal: boolean;
  description: string; // Ej: "Cuota Mensual - Marzo"
}

// Interfaces de Respuesta de AFIP SDK (Mapeo Parcial)
export interface AfipSdkInvoiceResponse {
  cae: string;
  vencimiento_cae: string;
  numero_comprobante: number;
  punto_venta: number;
  tipo_comprobante: number;
}