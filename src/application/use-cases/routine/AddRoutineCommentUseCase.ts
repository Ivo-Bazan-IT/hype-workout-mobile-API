import { ICommentRepository } from '../../../domain/repositories/ICommentRepository';
import { RoutineComment } from '../../../domain/entities/RoutineComment';
import { ValidationError } from '../../../shared/errors/AppError';

interface AddRoutineCommentDTO {
  routineId: string;
  gymId: string;
  autorUserId: string;
  autorRol: 'entrenador' | 'cliente';
  texto: string;
  clientId?: string;
}

export class AddRoutineCommentUseCase {
  constructor(private commentRepo: ICommentRepository) {}

  async execute(dto: AddRoutineCommentDTO): Promise<RoutineComment> {
    if (!dto.texto || dto.texto.trim().length === 0) {
      throw new ValidationError('Texto del comentario es obligatorio.');
    }
    if (dto.texto.length > 2000) {
      throw new ValidationError('Comentario excede 2000 caracteres.');
    }
    return this.commentRepo.create({
      gymId: dto.gymId,
      routineId: dto.routineId,
      clientId: dto.clientId ?? '',
      autorUserId: dto.autorUserId,
      autorRol: dto.autorRol,
      texto: dto.texto.trim(),
      createdAt: new Date(),
    });
  }
}
