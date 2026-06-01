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
import type { StyleReferenceCompilerPort } from '../style/StyleReferenceCompiler.js';
import { resolveStyleReferenceForPersistence } from '../style/styleReferencePersistence.js';

export type { Entity };

export interface CreateEntityRequest {
  entityType: EntityType;
  name: string;
  freeDescription: string | null;
  promptSupplement?: string | null;
  structuredFields: Record<string, unknown>;
  speechProfile: Record<string, unknown>;
}

export interface UpdateEntityRequest {
  entityType?: EntityType;
  name?: string;
  freeDescription?: string | null;
  promptSupplement?: string | null;
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
    private readonly styleReferenceCompiler?: StyleReferenceCompilerPort,
  ) {}

  public async createEntity(userId: string, workId: string, input: CreateEntityRequest): Promise<Entity> {
    await this.ensureWorkOwnedByUser(workId, userId);
    const parsedStructuredFields = parseStructuredFields(input.entityType, input.structuredFields);

    const createInput: CreateEntityInput = {
      workId,
      userId,
      entityType: input.entityType,
      name: input.name,
      freeDescription: input.freeDescription,
      promptSupplement: input.promptSupplement ?? null,
      structuredFields: await this.prepareStructuredFieldsForPersistence(
        input.entityType,
        parsedStructuredFields,
        undefined,
      ),
      speechProfile: normalizeSpeechProfile(input.entityType, input.speechProfile),
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
    const entityTypeChanged =
      input.entityType !== undefined && input.entityType !== currentEntity.entityType;
    const parsedStructuredFields =
      input.structuredFields === undefined
        ? undefined
        : parseStructuredFields(nextEntityType, input.structuredFields);
    const updateInput: UpdateEntityInput = {
      ...input,
      structuredFields:
        parsedStructuredFields === undefined
          ? entityTypeChanged
            ? await this.prepareStructuredFieldsForPersistence(nextEntityType, {}, undefined)
            : undefined
          : await this.prepareStructuredFieldsForPersistence(
              nextEntityType,
              parsedStructuredFields,
              currentEntity.structuredFields,
            ),
      speechProfile:
        input.speechProfile === undefined
          ? entityTypeChanged
            ? normalizeSpeechProfile(nextEntityType, {})
            : undefined
          : normalizeSpeechProfile(nextEntityType, input.speechProfile),
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

  private async prepareStructuredFieldsForPersistence(
    entityType: EntityType,
    structuredFields: Record<string, unknown>,
    currentStructuredFields?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (entityType !== 'character') {
      return structuredFields;
    }

    const nextStyleReference = toRecord(structuredFields.style_reference);
    const currentStyleReference = currentStructuredFields?.style_reference;
    const resolvedStyleReference = await resolveStyleReferenceForPersistence({
      nextStyleReference,
      currentStyleReference,
      target: 'character_reference',
      compiler: this.styleReferenceCompiler,
    });

    if (resolvedStyleReference === null) {
      const { style_reference: _omitted, ...rest } = structuredFields;
      return rest;
    }

    return {
      ...structuredFields,
      style_reference: resolvedStyleReference,
    };
  }
}

function normalizeSpeechProfile(
  entityType: EntityType,
  speechProfile: Record<string, unknown>,
): Record<string, unknown> {
  if (entityType === 'object') {
    return {};
  }

  return speechProfile;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
