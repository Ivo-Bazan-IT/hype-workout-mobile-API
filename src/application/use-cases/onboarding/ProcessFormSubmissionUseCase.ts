import { IClientRepository } from '../../../domain/repositories/IClientRepository';
import { IGymRepository } from '../../../domain/repositories/IGymRepository';
import { Client } from '../../../domain/entities/Client';

interface FormWebhookPayload {
  gymId: string;
  respuestas: Record<string, any>;
}

export class ProcessFormSubmissionUseCase {
  constructor(
    private clientRepository: IClientRepository,
    private gymRepository: IGymRepository
  ) {}

  async execute(payload: FormWebhookPayload): Promise<Client> {
    // Verificar que el gym existe y está activo
    const gym = await this.gymRepository.findById(payload.gymId);
    if (!gym || !gym.isActive) {
      throw new Error('Invalid or inactive gym');
    }

    // Extraer datos de las respuestas del formulario
    // El formato depende del Google Form configurado
    const respuestas = payload.respuestas;

    // Mapear respuestas a campos del cliente
    // Esto debe adaptarse según el formulario específico
    const nombre = this.extractField(respuestas, ['nombre', 'Nombre', 'name']);
    const documento = this.extractField(respuestas, ['dni', 'DNI', 'documento', 'Documento']);
    const telefono = this.extractField(respuestas, ['telefono', 'Teléfono', 'phone']);
    const email = this.extractField(respuestas, ['email', 'Email', 'correo']) || undefined;

    if (!nombre || !documento || !telefono) {
      throw new Error('Missing required fields in form submission');
    }

    // Verificar si ya existe el cliente
    const existingClient = await this.clientRepository.findByDocumento(documento, payload.gymId);

    if (existingClient) {
      // Unificar, no reemplazar: las respuestas nuevas se fusionan sobre las previas
      // para que un reenvío parcial del formulario no borre lo ya contestado.
      // Los datos de contacto se refrescan con lo último que envió el cliente.
      const encuestaData = {
        ...(existingClient.encuestaData || {}),
        ...respuestas
      };

      return this.clientRepository.update(existingClient.id, payload.gymId, {
        nombre,
        telefono,
        email,
        encuestaData
      }) as Promise<Client>;
    }

    // Crear cliente nuevo en estado pendiente
    const now = new Date();
    const fechaVencimiento = new Date(now);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 30); // 30 días por defecto

    const client = await this.clientRepository.create({
      gymId: payload.gymId,
      nombre,
      documento,
      telefono,
      email,
      estado: 'pendiente',
      fechaInicio: now,
      fechaVencimiento,
      encuestaData: respuestas,
    });

    return client;
  }

  private extractField(respuestas: Record<string, any>, fieldNames: string[]): string | null {
    for (const fieldName of fieldNames) {
      // Buscar por clave exacta o que contenga el nombre
      for (const [key, value] of Object.entries(respuestas)) {
        if (key.toLowerCase().includes(fieldName.toLowerCase())) {
          return Array.isArray(value) ? value[0] : String(value);
        }
      }
    }
    return null;
  }
}