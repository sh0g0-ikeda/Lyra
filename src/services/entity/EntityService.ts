import { NotFoundError } from '../../domain/errors/index.js';
import type {
  CreateEntityInput,
  Entity,
  EntityType,
  UpdateEntityInput,
} from '../../domain/types/entity.js';
import { parseStructuredFields } from '../../lib/validators/entity.schema.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { WorkReader } from '../../repositories/WorkRepository.js';

export type { Entity };

export interface CreateEntityRequest {
  entityType: EntityType;
  name: string;
  freeDescription: string | null;
  structuredFields: Record<string, unknown>;
  speechProfile: Record<string, unknown>;
}

export interface UpdateEntityRequest {
  entityType?: EntityType;
  name?: string;
  freeDescription?: string | null;
  structuredFields?: Record<string, unknown>;
  speechProfile?: Record<string, unknown>;
}

export interface EntityServicePort {
  createEntity(userId: string, workId: string, input: CreateEntityRequest): Promise<Entity>;
  listEntities(userId: string, workId: string): Promise<Entity[]>;
  getEntity(userId: string, entityId: string): Promise<Entity>;
  updateEntity(userId: string, entityId: string, input: UpdateEntityRequest): Promise<Entity>;
  deleteEntity(userId: string, entityId: string): Promise<void>;
}

export class EntityService implements EntityServicePort {
  public constructor(
    private readonly entityRepository: EntityRepository,
    private readonly workReader: WorkReader,
  ) {}

  public async createEntity(userId: string, workId: string, input: CreateEntityRequest): Promise<Entity> {
    await this.ensureWorkOwnedByUser(workId, userId);

    const createInput: CreateEntityInput = {
      workId,
      userId,
      entityType: input.entityType,
      name: input.name,
      freeDescription: input.freeDescription,
      structuredFields: parseStructuredFields(input.entityType, input.structuredFields),
      speechProfile: input.speechProfile,
    };

    return this.entityRepository.create(createInput);
  }

  public async listEntities(userId: string, workId: string): Promise<Entity[]> {
    await this.ensureWorkOwnedByUser(workId, userId);
    return this.entityRepository.findByWorkIdAndUserId(workId, userId);
  }

  public async getEntity(userId: string, entityId: string): Promise<Entity> {
    const entity = await this.entityRepository.findByIdAndUserId(entityId, userId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    return entity;
  }

  public async updateEntity(
    userId: string,
    entityId: string,
    input: UpdateEntityRequest,
  ): Promise<Entity> {
    const currentEntity = await this.getEntity(userId, entityId);
    const nextEntityType = input.entityType ?? currentEntity.entityType;
    const updateInput: UpdateEntityInput = {
      ...input,
      structuredFields:
        input.structuredFields === undefined
          ? undefined
          : parseStructuredFields(nextEntityType, input.structuredFields),
    };

    const entity = await this.entityRepository.update(entityId, userId, updateInput);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    return entity;
  }

  public async deleteEntity(userId: string, entityId: string): Promise<void> {
    const deleted = await this.entityRepository.delete(entityId, userId);
    if (!deleted) {
      throw new NotFoundError('Entity not found');
    }
  }

  private async ensureWorkOwnedByUser(workId: string, userId: string): Promise<void> {
    const work = await this.workReader.findByIdAndUserId(workId, userId);
    if (work === null) {
      throw new NotFoundError('Work not found');
    }
  }
}
