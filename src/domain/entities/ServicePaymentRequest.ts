export interface ServicePaymentRequest {
  id: string;
  gymId: string;
  clientId: string;
  servicioId: string;
  tipo: 'servicio';
  referencia: { servicioId: string };
  monto: number;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'expirado' | 'cancelado';
  mercadoPagoPaymentLinkId?: string;
  initPoint?: string;
  creadoEn: Date;
  actualizadoEn: Date;
}
